import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type nodemailer from "nodemailer";
import type {
  ListOptions,
  MessageBody,
  MessageSummary,
  Provider,
  SendInput,
} from "./index.js";

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
      const search = opts.unread ? { seen: false } : { all: true };
      const uids = (await this.client.search(search, { uid: true })) || [];
      const slice = uids.slice(-limit).reverse();
      if (slice.length === 0) return [];
      return await this.fetchSummaries(slice);
    } finally {
      lock.release();
    }
  }

  async fetch(id: string): Promise<MessageBody> {
    const folder = "INBOX";
    const lock = await this.client.getMailboxLock(folder);
    try {
      const msg = await this.client.fetchOne(
        id,
        { source: true, envelope: true },
        { uid: true },
      );
      if (!msg || !msg.source) throw new Error(`Message ${id} not found`);
      const parsed = await simpleParser(msg.source);
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
      };
    } finally {
      lock.release();
    }
  }

  async send(input: SendInput): Promise<void> {
    await this.smtp.sendMail({
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
  }

  async search(
    query: string,
    opts?: { folder?: string; limit?: number },
  ): Promise<MessageSummary[]> {
    const folder = opts?.folder ?? "INBOX";
    const limit = opts?.limit ?? 50;
    const lock = await this.client.getMailboxLock(folder);
    try {
      const uids = (await this.client.search(
        { or: [{ subject: query }, { body: query }, { from: query }] },
        { uid: true },
      )) || [];
      const slice = uids.slice(-limit).reverse();
      if (slice.length === 0) return [];
      return await this.fetchSummaries(slice);
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

function toAddressList(addr: unknown): string[] {
  if (!addr) return [];
  if (Array.isArray(addr)) return addr.flatMap((a) => toAddressList(a));
  const value = addr as { value?: { address?: string }[]; text?: string };
  if (value.value) return value.value.map((v) => v.address ?? "").filter(Boolean);
  return value.text ? [value.text] : [];
}
