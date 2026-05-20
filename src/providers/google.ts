import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { AccountConfig } from "../config/store.js";
import {
  getProviderSecret,
  getSecret,
} from "../auth/secrets.js";
import { refreshAccessToken } from "../auth/oauth-google.js";
import { MailboxBase, type ImapConnector } from "./_base.js";
import type { RuleInput } from "./index.js";
import {
  ReauthRequiredError,
  RulesNotSupportedError,
  type GmailFilterInput,
  type GmailFilterRaw,
  type NormalizedRule,
  type RuleEntry,
} from "./rules.js";

interface GoogleCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

type GmailLabel = { id: string; name: string };

export class GoogleProvider extends MailboxBase {
  private creds: GoogleCreds;
  private labelCache?: GmailLabel[];

  private constructor(
    fromAddress: string,
    client: ImapFlow,
    smtp: nodemailer.Transporter,
    connector: ImapConnector,
    creds: GoogleCreds,
  ) {
    super(fromAddress, client, smtp, connector);
    this.creds = creds;
  }

  static async connect(account: AccountConfig): Promise<GoogleProvider> {
    if (account.kind !== "google") {
      throw new Error(
        `GoogleProvider cannot handle account kind ${account.kind}`,
      );
    }
    const clientId = await getProviderSecret("google", "oauth-client-id");
    const clientSecret = await getProviderSecret("google", "oauth-client-secret");
    const refreshToken = await getSecret("oauth-refresh", account.email);
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        `Google credentials missing for ${account.email}. Run \`mmm init\` to authorize.`,
      );
    }
    const creds: GoogleCreds = { clientId, clientSecret, refreshToken };

    const { accessToken } = await refreshAccessToken(creds);

    const connector: ImapConnector = async () => {
      const { accessToken: token } = await refreshAccessToken(creds);
      const c = new ImapFlow({
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: account.email, accessToken: token },
        logger: false,
      });
      await c.connect();
      return c;
    };

    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: account.email, accessToken },
      logger: false,
    });
    await client.connect();

    const smtp = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        type: "OAuth2",
        user: account.email,
        clientId,
        clientSecret,
        refreshToken,
        accessToken,
      },
    });

    return new GoogleProvider(account.email, client, smtp, connector, creds);
  }

  private async gapi<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const { accessToken } = await refreshAccessToken(this.creds);
    const res = await fetch(`https://gmail.googleapis.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
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
      // leave as text for the error path
    }
    if (!res.ok) {
      throwGmailError(res.status, json, text, this.fromAddress);
    }
    return json as T;
  }

  private async loadLabels(): Promise<GmailLabel[]> {
    if (this.labelCache) return this.labelCache;
    const data = await this.gapi<{ labels?: GmailLabel[] }>(
      "GET",
      "/gmail/v1/users/me/labels",
    );
    this.labelCache = data.labels ?? [];
    return this.labelCache;
  }

  private async labelNameToId(name: string): Promise<string> {
    // System labels are uppercase string constants — pass through if it
    // looks like one and the API will validate.
    if (/^[A-Z_]+$/.test(name)) return name;
    const labels = await this.loadLabels();
    const hit = labels.find((l) => l.name === name || l.id === name);
    if (!hit) {
      throw new Error(`Gmail label not found: ${name}`);
    }
    return hit.id;
  }

  private async labelIdToName(id: string): Promise<string> {
    if (/^[A-Z_]+$/.test(id)) return id; // system label
    const labels = await this.loadLabels();
    return labels.find((l) => l.id === id)?.name ?? id;
  }

  override async listRules(): Promise<RuleEntry[]> {
    // Gmail returns 204 No Content (not 200 {}) when the user has no
    // filters — gapi yields undefined in that case.
    const data = await this.gapi<{ filter?: GmailFilterRaw[] } | undefined>(
      "GET",
      "/gmail/v1/users/me/settings/filters",
    );
    const out: RuleEntry[] = [];
    for (const f of data?.filter ?? []) {
      out.push(await this.toEntry(f));
    }
    return out;
  }

  override async getRule(id: string): Promise<RuleEntry> {
    const data = await this.gapi<GmailFilterRaw>(
      "GET",
      `/gmail/v1/users/me/settings/filters/${encodeURIComponent(id)}`,
    );
    return this.toEntry(data);
  }

  override async createRule(input: RuleInput): Promise<RuleEntry> {
    if (input.kind !== "gmail") {
      throw new Error(
        `Account ${this.fromAddress} is Gmail; pass a Gmail-shaped rule body (criteria/action).`,
      );
    }
    const body = await this.gmailInputToRaw(input.input);
    const created = await this.gapi<GmailFilterRaw>(
      "POST",
      "/gmail/v1/users/me/settings/filters",
      body,
    );
    return this.toEntry(created);
  }

  // Gmail filters cannot be PATCHed. Create-new + delete-old; report both
  // IDs if the delete fails so the user can clean up.
  override async updateRule(id: string, input: RuleInput): Promise<RuleEntry> {
    const created = await this.createRule(input);
    try {
      await this.deleteRule(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Created new filter ${created.id} but failed to delete old filter ${id}: ${msg}. ` +
          `You have two filters now; remove one with \`mmm rules delete <id>\`.`,
      );
    }
    return created;
  }

  override async deleteRule(id: string): Promise<void> {
    await this.gapi<void>(
      "DELETE",
      `/gmail/v1/users/me/settings/filters/${encodeURIComponent(id)}`,
    );
  }

  override setRuleEnabled(_id: string, _enabled: boolean): Promise<RuleEntry> {
    void _id;
    void _enabled;
    return Promise.reject(
      new RulesNotSupportedError(
        "Gmail filters don't have an enabled flag — delete the filter to disable it.",
      ),
    );
  }

  override setRulesOrder(_ids: string[]): Promise<void> {
    void _ids;
    return Promise.reject(
      new RulesNotSupportedError(
        "Gmail filters are unordered; reordering doesn't apply.",
      ),
    );
  }

  private async gmailInputToRaw(input: GmailFilterInput): Promise<GmailFilterRaw> {
    const action: GmailFilterRaw["action"] = {};
    if (input.action.addLabels?.length) {
      action.addLabelIds = await Promise.all(
        input.action.addLabels.map((n) => this.labelNameToId(n)),
      );
    }
    if (input.action.removeLabels?.length) {
      action.removeLabelIds = await Promise.all(
        input.action.removeLabels.map((n) => this.labelNameToId(n)),
      );
    }
    if (input.action.forward) action.forward = input.action.forward;
    return { criteria: input.criteria, action };
  }

  private async toEntry(raw: GmailFilterRaw): Promise<RuleEntry> {
    if (!raw.id) throw new Error("Gmail filter response missing id");
    const normalized = await this.normalizeGmail(raw);
    return { id: raw.id, normalized, raw };
  }

  private async normalizeGmail(raw: GmailFilterRaw): Promise<NormalizedRule> {
    const c = raw.criteria ?? {};
    const a = raw.action ?? {};
    const addNames = a.addLabelIds
      ? await Promise.all(a.addLabelIds.map((id) => this.labelIdToName(id)))
      : undefined;
    const removeNames = a.removeLabelIds
      ? await Promise.all(a.removeLabelIds.map((id) => this.labelIdToName(id)))
      : undefined;

    const matches: NormalizedRule["matches"] = {};
    if (c.from) matches.from = [c.from];
    if (c.to) matches.to = [c.to];
    if (c.subject) matches.subject = c.subject;
    if (c.hasAttachment !== undefined) matches.hasAttachment = c.hasAttachment;
    if (c.query) matches.query = c.query;

    const does: NormalizedRule["does"] = {};
    if (addNames?.length) does.addLabels = addNames;
    if (removeNames?.length) does.removeLabels = removeNames;
    if (removeNames?.includes("INBOX")) does.move = "[Gmail]/All Mail"; // archive
    if (addNames?.includes("TRASH")) does.delete = true;
    if (removeNames?.includes("UNREAD")) does.markRead = true;
    if (a.forward) does.forward = [a.forward];

    return {
      id: raw.id ?? "",
      displayName: filterDisplayName(raw),
      enabled: true,
      hasError: false,
      matches,
      does,
    };
  }
}

function filterDisplayName(raw: GmailFilterRaw): string {
  const c = raw.criteria ?? {};
  const bits: string[] = [];
  if (c.from) bits.push(`from:${c.from}`);
  if (c.to) bits.push(`to:${c.to}`);
  if (c.subject) bits.push(`subject:"${c.subject}"`);
  if (c.query) bits.push(c.query);
  if (c.hasAttachment) bits.push("has:attachment");
  return bits.join(" ") || "(no criteria)";
}

interface GmailErrorBody {
  error?: {
    code?: number;
    message?: string;
    errors?: { reason?: string; message?: string }[];
    status?: string;
  };
}

function throwGmailError(
  status: number,
  body: unknown,
  raw: string,
  email: string,
): never {
  const b = (body ?? {}) as GmailErrorBody;
  const reason = b.error?.errors?.[0]?.reason ?? "";
  const message = b.error?.message ?? raw ?? `HTTP ${status}`;
  if (
    status === 403 &&
    (reason === "insufficientPermissions" ||
      /insufficient.*scope/i.test(message))
  ) {
    throw new ReauthRequiredError(
      email,
      `Gmail returned 403 — your account is missing the gmail.settings.basic scope. Run \`mmm reauth ${email}\`.`,
    );
  }
  if (status === 401) {
    throw new ReauthRequiredError(
      email,
      `Gmail returned 401 — refresh token rejected. Run \`mmm reauth ${email}\`.`,
    );
  }
  throw new Error(`Gmail ${status}: ${message}`);
}
