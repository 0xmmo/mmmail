import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type nodemailer from "nodemailer";
import type {
  ListOptions,
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

export abstract class MailboxBase implements Provider {
  protected constructor(
    protected readonly fromAddress: string,
    protected readonly client: ImapFlow,
    protected readonly smtp: nodemailer.Transporter,
  ) {}

  async list(opts: ListOptions): Promise<MessageSummary[]> {
    const folder = opts.folder ?? "INBOX";
    const limit = opts.limit ?? 20;
    const lock = await this.client.getMailboxLock(folder);
    try {
      const search = buildBaseSearch(opts);
      const uids = (await this.client.search(search, { uid: true })) || [];
      const slice = uids.slice(-limit).reverse();
      if (slice.length === 0) return [];
      return await this.fetchSummaries(slice);
    } finally {
      lock.release();
    }
  }

  async fetch(id: string, opts?: { folder?: string }): Promise<MessageBody> {
    const folder = opts?.folder ?? "INBOX";
    const lock = await this.client.getMailboxLock(folder);
    try {
      const msg = await this.client.fetchOne(
        id,
        { source: true, envelope: true },
        { uid: true },
      );
      if (!msg || !msg.source) throw new Error(`Message ${id} not found`);
      const parsed = await simpleParser(msg.source);
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
      };
    } finally {
      lock.release();
    }
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
    });
    return {
      messageId: info.messageId,
      accepted: toStringList(info.accepted),
      rejected: toStringList(info.rejected),
    };
  }

  async folders(): Promise<string[]> {
    const list = await this.client.list();
    return list
      .map((m) => m.path)
      .filter((p): p is string => typeof p === "string");
  }

  async search(query: string, opts?: SearchOptions): Promise<MessageSummary[]> {
    const folder = opts?.folder ?? "INBOX";
    const limit = opts?.limit ?? 50;
    const lock = await this.client.getMailboxLock(folder);
    try {
      const search: SearchObject = {
        or: [{ subject: query }, { body: query }, { from: query }],
      };
      Object.assign(search, paginationFilters(opts));
      const uids = (await this.client.search(search, { uid: true })) || [];
      const slice = uids.slice(-limit).reverse();
      if (slice.length === 0) return [];
      return await this.fetchSummaries(slice);
    } finally {
      lock.release();
    }
  }

  async setFlags(
    id: string,
    flags: SetFlagsInput,
    opts?: { folder?: string },
  ): Promise<void> {
    const folder = opts?.folder ?? "INBOX";
    const lock = await this.client.getMailboxLock(folder);
    try {
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
    } finally {
      lock.release();
    }
  }

  async move(
    id: string,
    dest: string,
    opts?: { folder?: string },
  ): Promise<void> {
    const folder = opts?.folder ?? "INBOX";
    const lock = await this.client.getMailboxLock(folder);
    try {
      await this.client.messageMove(id, dest, { uid: true });
    } finally {
      lock.release();
    }
  }

  async del(id: string, opts?: { folder?: string }): Promise<void> {
    const folder = opts?.folder ?? "INBOX";
    const lock = await this.client.getMailboxLock(folder);
    try {
      await this.client.messageDelete(id, { uid: true });
    } finally {
      lock.release();
    }
  }

  async close(): Promise<void> {
    this.smtp.close();
    await this.client.logout();
  }

  private async fetchSummaries(uids: number[]): Promise<MessageSummary[]> {
    const out: MessageSummary[] = [];
    for await (const msg of this.client.fetch(
      uids.map(String).join(","),
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

function toAddressList(addr: unknown): string[] {
  if (!addr) return [];
  if (Array.isArray(addr)) return addr.flatMap((a) => toAddressList(a));
  const value = addr as { value?: { address?: string }[]; text?: string };
  if (value.value) return value.value.map((v) => v.address ?? "").filter(Boolean);
  return value.text ? [value.text] : [];
}
