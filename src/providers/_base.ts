import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type nodemailer from "nodemailer";
import type {
  ListOptions,
  MessageAttachment,
  MessageBody,
  MessageSummary,
  Provider,
  SearchOptions,
  SendInput,
  SendResult,
  SetFlagsInput,
} from "./index.js";

interface SearchObject {
  all?: boolean;
  seen?: boolean;
  since?: Date;
  before?: Date;
  uid?: string;
  or?: SearchObject[];
  subject?: string;
  body?: string;
  from?: string;
}

// Bound the size of any single FETCH command. Microsoft 365 IMAP resets the
// connection on huge sequence sets; chunking keeps each round-trip small.
const FETCH_CHUNK_SIZE = 200;

export type ImapConnector = () => Promise<ImapFlow>;

export abstract class MailboxBase implements Provider {
  protected client: ImapFlow;

  protected constructor(
    protected readonly fromAddress: string,
    client: ImapFlow,
    protected readonly smtp: nodemailer.Transporter,
    protected readonly connector?: ImapConnector,
  ) {
    this.client = client;
  }

  async list(opts: ListOptions): Promise<MessageSummary[]> {
    const folder = opts.folder ?? "INBOX";
    const limit = opts.limit ?? 20;
    return this.withMailbox(folder, "list", async () => {
      const search = buildBaseSearch(opts);
      const uids = (await this.client.search(search, { uid: true })) || [];
      const slice = uids.slice(-limit).reverse();
      if (slice.length === 0) return [];
      return await this.fetchSummaries(slice);
    });
  }

  async fetch(
    id: string,
    opts?: { folder?: string; withAttachmentData?: boolean },
  ): Promise<MessageBody> {
    const folder = opts?.folder ?? "INBOX";
    return this.withMailbox(folder, "fetch", async () => {
      const msg = await this.client.fetchOne(
        id,
        { source: true, envelope: true },
        { uid: true },
      );
      if (!msg || !msg.source) throw new Error(`Message ${id} not found`);
      const parsed = await simpleParser(msg.source);
      return buildMessageBody(id, parsed, opts?.withAttachmentData);
    });
  }

  async fetchMany(
    ids: string[],
    opts?: { folder?: string; withAttachmentData?: boolean },
  ): Promise<MessageBody[]> {
    if (ids.length === 0) return [];
    const folder = opts?.folder ?? "INBOX";
    return this.withMailbox(folder, "fetchMany", async () => {
      const byId = new Map<string, MessageBody>();
      for (let i = 0; i < ids.length; i += FETCH_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + FETCH_CHUNK_SIZE);
        for await (const msg of this.client.fetch(
          chunk.join(","),
          { source: true, envelope: true, uid: true },
          { uid: true },
        )) {
          if (!msg.source || msg.uid === undefined) continue;
          const id = String(msg.uid);
          const parsed = await simpleParser(msg.source);
          byId.set(id, buildMessageBody(id, parsed, opts?.withAttachmentData));
        }
      }
      // Preserve the caller's requested order; drop any UIDs the server didn't return.
      return ids.map((id) => byId.get(id)).filter((m): m is MessageBody => Boolean(m));
    });
  }

  async send(input: SendInput): Promise<SendResult> {
    const info = await this.smtp.sendMail({
      from: this.fromAddress,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      inReplyTo: input.inReplyTo,
      references: input.references,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        path: a.path,
        contentType: a.contentType,
      })),
    });
    return {
      messageId: info.messageId,
      accepted: toStringList(info.accepted),
      rejected: toStringList(info.rejected),
    };
  }

  async folders(): Promise<string[]> {
    try {
      const list = await this.client.list();
      return list
        .map((m) => m.path)
        .filter((p): p is string => typeof p === "string");
    } catch (err) {
      throw enrichImapError(err, "folders");
    }
  }

  async search(query: string, opts?: SearchOptions): Promise<MessageSummary[]> {
    const folder = opts?.folder ?? "INBOX";
    const limit = opts?.limit ?? 50;
    return this.withMailbox(folder, "search", async () => {
      const search: SearchObject = {
        or: [{ subject: query }, { body: query }, { from: query }],
      };
      Object.assign(search, paginationFilters(opts));
      const uids = (await this.client.search(search, { uid: true })) || [];
      const slice = uids.slice(-limit).reverse();
      if (slice.length === 0) return [];
      return await this.fetchSummaries(slice);
    });
  }

  async setFlags(
    id: string,
    flags: SetFlagsInput,
    opts?: { folder?: string },
  ): Promise<void> {
    const folder = opts?.folder ?? "INBOX";
    return this.withMailbox(folder, "setFlags", async () => {
      const add: string[] = [];
      const remove: string[] = [];
      if (flags.seen === true) add.push("\\Seen");
      if (flags.seen === false) remove.push("\\Seen");
      if (flags.flagged === true) add.push("\\Flagged");
      if (flags.flagged === false) remove.push("\\Flagged");
      if (add.length) {
        await this.client.messageFlagsAdd(id, add, { uid: true });
      }
      if (remove.length) {
        await this.client.messageFlagsRemove(id, remove, { uid: true });
      }
    });
  }

  async move(
    id: string,
    dest: string,
    opts?: { folder?: string },
  ): Promise<void> {
    const folder = opts?.folder ?? "INBOX";
    return this.withMailbox(folder, "move", async () => {
      await this.client.messageMove(id, dest, { uid: true });
    });
  }

  async del(id: string, opts?: { folder?: string }): Promise<void> {
    const folder = opts?.folder ?? "INBOX";
    return this.withMailbox(folder, "delete", async () => {
      await this.client.messageDelete(id, { uid: true });
    });
  }

  async close(): Promise<void> {
    this.smtp.close();
    try {
      await this.client.logout();
    } catch {
      // best-effort; connection may already be dead
    }
  }

  // Run `op` under a mailbox lock; on a transient socket/IMAP error, reconnect
  // once and retry. All errors are rethrown with upstream IMAP detail attached.
  protected async withMailbox<T>(
    folder: string,
    label: string,
    op: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.runLocked(folder, op);
    } catch (err) {
      if (isTransientError(err) && this.connector) {
        await this.reconnect();
        try {
          return await this.runLocked(folder, op);
        } catch (err2) {
          throw enrichImapError(err2, label);
        }
      }
      throw enrichImapError(err, label);
    }
  }

  private async runLocked<T>(folder: string, op: () => Promise<T>): Promise<T> {
    const lock = await this.client.getMailboxLock(folder);
    try {
      return await op();
    } finally {
      try {
        lock.release();
      } catch {
        // lock release on a dead client throws; we don't care.
      }
    }
  }

  private async reconnect(): Promise<void> {
    if (!this.connector) return;
    try {
      await this.client.logout();
    } catch {
      // ignore — already dead
    }
    this.client = await this.connector();
  }

  private async fetchSummaries(uids: number[]): Promise<MessageSummary[]> {
    const out: MessageSummary[] = [];
    for (let i = 0; i < uids.length; i += FETCH_CHUNK_SIZE) {
      const chunk = uids.slice(i, i + FETCH_CHUNK_SIZE);
      for await (const msg of this.client.fetch(
        chunk.map(String).join(","),
        { envelope: true, flags: true, uid: true },
        { uid: true },
      )) {
        const env = msg.envelope;
        out.push({
          id: String(msg.uid),
          uid: msg.uid ?? 0,
          from: env?.from?.[0]?.address ?? "(unknown)",
          to: (env?.to ?? []).map((a) => a.address ?? "").filter(Boolean),
          subject: env?.subject ?? "(no subject)",
          date: env?.date ?? new Date(0),
          flags: {
            seen: msg.flags?.has("\\Seen") ?? false,
            flagged: msg.flags?.has("\\Flagged") ?? false,
          },
        });
      }
    }
    return out;
  }
}

function buildBaseSearch(opts: ListOptions): SearchObject {
  const search: SearchObject = opts.unread ? { seen: false } : { all: true };
  Object.assign(search, paginationFilters(opts));
  return search;
}

function paginationFilters(
  opts?: { since?: Date; before?: Date; uidAfter?: number },
): Partial<SearchObject> {
  const out: Partial<SearchObject> = {};
  if (opts?.since) out.since = opts.since;
  if (opts?.before) out.before = opts.before;
  if (opts?.uidAfter !== undefined) out.uid = `${opts.uidAfter + 1}:*`;
  return out;
}

function toStringList(addr: unknown): string[] {
  if (!addr) return [];
  if (Array.isArray(addr)) return addr.map((a) => String(a));
  return [String(addr)];
}

type ParsedAttachment = {
  filename?: string;
  contentType?: string;
  size?: number;
  cid?: string;
  contentDisposition?: string;
  content?: Buffer;
};

type ParsedMessage = {
  from?: { text?: string };
  to?: unknown;
  cc?: unknown;
  subject?: string;
  date?: Date;
  text?: string;
  html?: string | false;
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
  attachments?: ParsedAttachment[];
};

function buildMessageBody(
  id: string,
  parsed: ParsedMessage,
  withAttachmentData: boolean | undefined,
): MessageBody {
  const refs = parsed.references;
  const references = Array.isArray(refs) ? refs : refs ? [refs] : [];
  return {
    id,
    from: parsed.from?.text ?? "(unknown)",
    to: parsed.to ? toAddressList(parsed.to) : [],
    cc: parsed.cc ? toAddressList(parsed.cc) : [],
    subject: parsed.subject ?? "(no subject)",
    date: parsed.date ?? new Date(0),
    text: parsed.text ?? "",
    html: typeof parsed.html === "string" ? parsed.html : undefined,
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    references,
    attachments: mapAttachments(parsed.attachments, withAttachmentData),
  };
}

function mapAttachments(
  parsed: ParsedAttachment[] | undefined,
  withData: boolean | undefined,
): MessageAttachment[] {
  if (!parsed || parsed.length === 0) return [];
  return parsed.map((a, i) => {
    const meta: MessageAttachment = {
      filename: a.filename || `attachment-${i + 1}`,
      contentType: a.contentType ?? "application/octet-stream",
      size: a.size ?? (a.content ? a.content.length : 0),
      contentId: a.cid,
      inline: a.contentDisposition === "inline",
    };
    if (withData && a.content) meta.content = a.content;
    return meta;
  });
}

function toAddressList(addr: unknown): string[] {
  if (!addr) return [];
  if (Array.isArray(addr)) return addr.flatMap((a) => toAddressList(a));
  const value = addr as { value?: { address?: string }[]; text?: string };
  if (value.value) return value.value.map((v) => v.address ?? "").filter(Boolean);
  return value.text ? [value.text] : [];
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ETIMEOUT",
  "EPIPE",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTCONN",
  "NoConnection",
  "ConnectionClosed",
  "ClosedAfterConnectTLS",
  "ClosedAfterConnectText",
]);

const TRANSIENT_MSG = /ECONNRESET|ETIMEDOUT|socket hang up|Connection closed|connection.*(reset|lost|closed)|not connected|read ECONN/i;

export function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code && TRANSIENT_CODES.has(e.code)) return true;
  return TRANSIENT_MSG.test(e.message ?? "");
}

// Rewrite imapflow errors so the message includes the server response, status,
// and code. By default imapflow throws `new Error('Command failed')` with the
// useful detail tucked onto the error object — invisible in normal stack traces.
export function enrichImapError(err: unknown, label: string): Error {
  if (!(err instanceof Error)) {
    return new Error(`${label}: ${String(err)}`);
  }
  const e = err as Error & {
    code?: string;
    responseText?: string;
    responseStatus?: string;
    serverResponseCode?: string;
    response?: unknown;
  };
  const detail =
    e.responseText ??
    (typeof e.response === "string" ? e.response : undefined);
  const tags: string[] = [];
  if (e.responseStatus) tags.push(e.responseStatus);
  if (e.serverResponseCode) tags.push(e.serverResponseCode);
  if (e.code) tags.push(e.code);

  let msg = `${label}: ${e.message}`;
  if (detail && !e.message.includes(detail)) msg += `: ${detail}`;
  const tagStr = tags.filter((t) => !msg.includes(t)).join(" ");
  if (tagStr) msg += ` [${tagStr}]`;

  const out = new Error(msg);
  (out as Error & { cause?: unknown }).cause = err;
  return out;
}
