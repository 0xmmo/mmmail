import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { AccountConfig } from "../config/store.js";
import { getSecret, setSecret } from "../auth/secrets.js";
import {
  DEFAULT_CLIENT_ID,
  refreshAccessToken,
} from "../auth/oauth-microsoft.js";
import { MailboxBase, type ImapConnector } from "./_base.js";
import type { RuleInput } from "./index.js";
import {
  ReauthRequiredError,
  type GraphMessageRuleInput,
  type GraphMessageRuleRaw,
  type NormalizedRule,
  type RuleEntry,
} from "./rules.js";

interface MicrosoftCreds {
  clientId: string;
  refreshToken: string;
  email: string;
}

interface GraphFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount?: number;
}

export class MicrosoftProvider extends MailboxBase {
  private creds: MicrosoftCreds;
  private folderPathCache?: Map<string, string>;

  private constructor(
    fromAddress: string,
    client: ImapFlow,
    smtp: nodemailer.Transporter,
    connector: ImapConnector,
    creds: MicrosoftCreds,
  ) {
    super(fromAddress, client, smtp, connector);
    this.creds = creds;
  }

  static async connect(account: AccountConfig): Promise<MicrosoftProvider> {
    if (account.kind !== "microsoft") {
      throw new Error(
        `MicrosoftProvider cannot handle account kind ${account.kind}`,
      );
    }
    const clientId =
      (await getSecret("oauth-client-id", account.email)) ||
      DEFAULT_CLIENT_ID;
    const storedRefresh = await getSecret("oauth-refresh", account.email);
    if (!clientId || !storedRefresh) {
      throw new Error(
        `Microsoft credentials missing for ${account.email}. Run \`mmm init\` to authorize.`,
      );
    }
    let refreshToken: string = storedRefresh;

    const refreshed = await refreshAccessToken({
      clientId,
      refreshToken,
      resource: "exchange",
    });
    if (refreshed.refreshToken !== refreshToken) {
      await setSecret("oauth-refresh", account.email, refreshed.refreshToken);
      refreshToken = refreshed.refreshToken;
    }

    const creds: MicrosoftCreds = {
      clientId,
      refreshToken,
      email: account.email,
    };

    const connector: ImapConnector = async () => {
      const r = await refreshAccessToken({
        clientId: creds.clientId,
        refreshToken: creds.refreshToken,
        resource: "exchange",
      });
      if (r.refreshToken !== creds.refreshToken) {
        await setSecret("oauth-refresh", creds.email, r.refreshToken);
        creds.refreshToken = r.refreshToken;
      }
      const c = new ImapFlow({
        host: "outlook.office365.com",
        port: 993,
        secure: true,
        auth: { user: creds.email, accessToken: r.accessToken },
        logger: false,
      });
      await c.connect();
      return c;
    };

    const client = new ImapFlow({
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: { user: account.email, accessToken: refreshed.accessToken },
      logger: false,
    });
    await client.connect();

    const smtp = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        type: "OAuth2",
        user: account.email,
        accessToken: refreshed.accessToken,
      },
    });

    return new MicrosoftProvider(
      account.email,
      client,
      smtp,
      connector,
      creds,
    );
  }

  private async graphToken(): Promise<string> {
    try {
      const r = await refreshAccessToken({
        clientId: this.creds.clientId,
        refreshToken: this.creds.refreshToken,
        resource: "graph",
      });
      if (r.refreshToken !== this.creds.refreshToken) {
        await setSecret("oauth-refresh", this.creds.email, r.refreshToken);
        this.creds.refreshToken = r.refreshToken;
      }
      return r.accessToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/invalid_grant|invalid_scope|AADSTS6500[0-9]/.test(msg)) {
        throw new ReauthRequiredError(
          this.creds.email,
          `Microsoft refresh failed for Graph scope — your account was authorized before mmm needed Graph access. Run \`mmm reauth ${this.creds.email}\`.`,
        );
      }
      throw err;
    }
  }

  private async graph<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.graphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // empty
    }
    if (!res.ok) {
      throwGraphError(res.status, json, text, this.creds.email);
    }
    return json as T;
  }

  // ---------- folders ----------

  private async loadFolderPaths(): Promise<Map<string, string>> {
    if (this.folderPathCache) return this.folderPathCache;
    const all = await this.fetchAllFolders();
    const byId = new Map(all.map((f) => [f.id, f] as const));
    const pathOf = (f: GraphFolder): string => {
      const parts: string[] = [f.displayName];
      let cur = f;
      while (cur.parentFolderId) {
        const parent = byId.get(cur.parentFolderId);
        if (!parent || parent.parentFolderId === undefined) break;
        parts.unshift(parent.displayName);
        cur = parent;
      }
      return parts.join("/");
    };
    const out = new Map<string, string>();
    for (const f of all) out.set(pathOf(f), f.id);
    this.folderPathCache = out;
    return out;
  }

  private async fetchAllFolders(): Promise<GraphFolder[]> {
    const result: GraphFolder[] = [];
    const walk = async (path: string): Promise<void> => {
      let next: string | undefined = path;
      while (next) {
        const page: { value: GraphFolder[]; "@odata.nextLink"?: string } =
          await this.graph(
            "GET",
            next.replace("https://graph.microsoft.com/v1.0", ""),
          );
        result.push(...(page.value ?? []));
        next = page["@odata.nextLink"];
      }
    };
    await walk("/me/mailFolders?$top=100");
    // Walk one level deep — most users only have shallow nesting.
    const seeds = [...result];
    for (const f of seeds) {
      if ((f.childFolderCount ?? 0) > 0) {
        await walk(`/me/mailFolders/${f.id}/childFolders?$top=100`);
      }
    }
    return result;
  }

  private async resolveFolder(pathOrId: string): Promise<string> {
    // A folder ID is an opaque base64-ish string (typically very long with
    // `=` or `-` chars). Folder paths look like "Inbox" or "Inbox/Receipts".
    if (pathOrId.length > 40 && !/^[A-Za-z][A-Za-z0-9_/ ]+$/.test(pathOrId)) {
      return pathOrId;
    }
    const paths = await this.loadFolderPaths();
    const hit = paths.get(pathOrId);
    if (hit) return hit;
    // Try case-insensitive
    for (const [p, id] of paths) {
      if (p.toLowerCase() === pathOrId.toLowerCase()) return id;
    }
    throw new Error(
      `Outlook folder not found: "${pathOrId}". Known: ${[...paths.keys()].slice(0, 20).join(", ")}${paths.size > 20 ? "..." : ""}`,
    );
  }

  // ---------- rules ----------

  override async listRules(): Promise<RuleEntry[]> {
    const data = await this.graph<{ value: GraphMessageRuleRaw[] }>(
      "GET",
      "/me/mailFolders/inbox/messageRules",
    );
    return Promise.all((data.value ?? []).map((r) => this.toEntry(r)));
  }

  override async getRule(id: string): Promise<RuleEntry> {
    const raw = await this.graph<GraphMessageRuleRaw>(
      "GET",
      `/me/mailFolders/inbox/messageRules/${encodeURIComponent(id)}`,
    );
    return this.toEntry(raw);
  }

  override async createRule(input: RuleInput): Promise<RuleEntry> {
    if (input.kind !== "microsoft") {
      throw new Error(
        `Account ${this.creds.email} is Microsoft; pass a Graph-shaped rule body (displayName/conditions/actions).`,
      );
    }
    const sequence = input.input.sequence ?? (await this.nextSequence());
    const body = await this.inputToRaw({ ...input.input, sequence });
    const raw = await this.graph<GraphMessageRuleRaw>(
      "POST",
      "/me/mailFolders/inbox/messageRules",
      body,
    );
    return this.toEntry(raw);
  }

  override async updateRule(id: string, input: RuleInput): Promise<RuleEntry> {
    if (input.kind !== "microsoft") {
      throw new Error(
        `Account ${this.creds.email} is Microsoft; pass a Graph-shaped rule body.`,
      );
    }
    const existing = await this.graph<GraphMessageRuleRaw>(
      "GET",
      `/me/mailFolders/inbox/messageRules/${encodeURIComponent(id)}`,
    );
    if (existing.isReadOnly) {
      throw new Error(
        `Rule ${id} is read-only (likely org-deployed) and cannot be modified.`,
      );
    }
    // Graph PATCH replaces sub-objects in full — merge user input over the
    // existing rule so callers don't have to re-state everything.
    const merged: GraphMessageRuleInput = {
      displayName: input.input.displayName ?? existing.displayName,
      sequence: input.input.sequence ?? existing.sequence,
      isEnabled: input.input.isEnabled ?? existing.isEnabled,
      conditions: { ...existing.conditions, ...input.input.conditions },
      exceptions: { ...existing.exceptions, ...input.input.exceptions },
      actions: { ...existing.actions, ...input.input.actions },
    };
    const body = await this.inputToRaw(merged);
    const raw = await this.graph<GraphMessageRuleRaw>(
      "PATCH",
      `/me/mailFolders/inbox/messageRules/${encodeURIComponent(id)}`,
      body,
    );
    return this.toEntry(raw);
  }

  override async deleteRule(id: string): Promise<void> {
    await this.graph<void>(
      "DELETE",
      `/me/mailFolders/inbox/messageRules/${encodeURIComponent(id)}`,
    );
  }

  override async setRuleEnabled(id: string, enabled: boolean): Promise<RuleEntry> {
    const raw = await this.graph<GraphMessageRuleRaw>(
      "PATCH",
      `/me/mailFolders/inbox/messageRules/${encodeURIComponent(id)}`,
      { isEnabled: enabled },
    );
    return this.toEntry(raw);
  }

  override async setRulesOrder(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await this.graph<GraphMessageRuleRaw>(
        "PATCH",
        `/me/mailFolders/inbox/messageRules/${encodeURIComponent(ids[i] ?? "")}`,
        { sequence: i + 1 },
      );
    }
  }

  private async nextSequence(): Promise<number> {
    const data = await this.graph<{ value: GraphMessageRuleRaw[] }>(
      "GET",
      "/me/mailFolders/inbox/messageRules",
    );
    const seqs = (data.value ?? []).map((r) => r.sequence ?? 0);
    return seqs.length ? Math.max(...seqs) + 1 : 1;
  }

  private async inputToRaw(
    input: GraphMessageRuleInput,
  ): Promise<Omit<GraphMessageRuleRaw, "id" | "isReadOnly" | "hasError">> {
    const actions = { ...input.actions };
    const out: Omit<GraphMessageRuleRaw, "id" | "isReadOnly" | "hasError"> = {
      displayName: input.displayName,
      sequence: input.sequence ?? 1,
      isEnabled: input.isEnabled ?? true,
      conditions: input.conditions,
      exceptions: input.exceptions,
      actions: {},
    };
    const a = out.actions;
    if (actions.assignCategories) a.assignCategories = actions.assignCategories;
    if (actions.copyToFolder) {
      a.copyToFolder = await this.resolveFolder(actions.copyToFolder);
    }
    if (actions.moveToFolder) {
      a.moveToFolder = await this.resolveFolder(actions.moveToFolder);
    }
    if (actions.delete !== undefined) a.delete = actions.delete;
    if (actions.permanentDelete !== undefined)
      a.permanentDelete = actions.permanentDelete;
    if (actions.forwardTo) a.forwardTo = actions.forwardTo;
    if (actions.forwardAsAttachmentTo)
      a.forwardAsAttachmentTo = actions.forwardAsAttachmentTo;
    if (actions.redirectTo) a.redirectTo = actions.redirectTo;
    if (actions.markAsRead !== undefined) a.markAsRead = actions.markAsRead;
    if (actions.markImportance) a.markImportance = actions.markImportance;
    if (actions.stopProcessingRules !== undefined)
      a.stopProcessingRules = actions.stopProcessingRules;
    return out;
  }

  private async toEntry(raw: GraphMessageRuleRaw): Promise<RuleEntry> {
    if (!raw.id) throw new Error("Graph messageRule response missing id");
    const normalized = await this.normalize(raw);
    return { id: raw.id, normalized, raw };
  }

  private async normalize(raw: GraphMessageRuleRaw): Promise<NormalizedRule> {
    const cond = raw.conditions ?? {};
    const act = raw.actions;
    const matches: NormalizedRule["matches"] = {};
    if (cond.fromAddresses?.length) {
      matches.from = cond.fromAddresses.map((r) => r.emailAddress.address);
    }
    if (cond.sentToAddresses?.length) {
      matches.to = cond.sentToAddresses.map((r) => r.emailAddress.address);
    }
    if (cond.subjectContains?.length) {
      matches.subject = cond.subjectContains.join(" || ");
    }
    if (cond.bodyContains?.length) {
      matches.body = cond.bodyContains.join(" || ");
    }
    if (cond.hasAttachments !== undefined) {
      matches.hasAttachment = cond.hasAttachments;
    }

    const does: NormalizedRule["does"] = {};
    if (act.moveToFolder) {
      does.move = await this.folderName(act.moveToFolder);
    }
    if (act.copyToFolder) {
      does.copy = await this.folderName(act.copyToFolder);
    }
    if (act.delete) does.delete = true;
    if (act.permanentDelete) does.permanentDelete = true;
    if (act.markAsRead) does.markRead = true;
    if (act.assignCategories?.length)
      does.assignCategories = act.assignCategories;
    if (act.forwardTo?.length) {
      does.forward = act.forwardTo.map((r) => r.emailAddress.address);
    }
    if (act.redirectTo?.length) {
      does.redirect = act.redirectTo.map((r) => r.emailAddress.address);
    }
    if (act.forwardAsAttachmentTo?.length) {
      does.forwardAsAttachment = act.forwardAsAttachmentTo.map(
        (r) => r.emailAddress.address,
      );
    }
    if (act.markImportance) does.markImportance = act.markImportance;
    if (act.stopProcessingRules) does.stopProcessing = true;

    return {
      id: raw.id ?? "",
      displayName: raw.displayName,
      enabled: raw.isEnabled,
      hasError: raw.hasError ?? false,
      sequence: raw.sequence,
      matches,
      does,
    };
  }

  private async folderName(id: string): Promise<string> {
    try {
      const paths = await this.loadFolderPaths();
      for (const [p, fid] of paths) if (fid === id) return p;
    } catch {
      // best-effort — fall back to id
    }
    return id;
  }
}

interface GraphErrorBody {
  error?: { code?: string; message?: string };
}

function throwGraphError(
  status: number,
  body: unknown,
  raw: string,
  email: string,
): never {
  const b = (body ?? {}) as GraphErrorBody;
  const code = b.error?.code ?? "";
  const message = b.error?.message ?? raw ?? `HTTP ${status}`;
  if (status === 401 || code === "InvalidAuthenticationToken") {
    throw new ReauthRequiredError(
      email,
      `Microsoft Graph returned 401 — token rejected. Run \`mmm reauth ${email}\`.`,
    );
  }
  if (
    status === 403 &&
    (code === "ErrorAccessDenied" || /scope/i.test(message))
  ) {
    throw new ReauthRequiredError(
      email,
      `Microsoft Graph returned 403 — missing MailboxSettings.ReadWrite scope. Run \`mmm reauth ${email}\`.`,
    );
  }
  if (code === "ErrorRulesOverQuota") {
    throw new Error(
      `Outlook rules quota exceeded (256 KB total rule size). Delete or shrink existing rules and try again.`,
    );
  }
  throw new Error(`Graph ${status}${code ? ` (${code})` : ""}: ${message}`);
}
