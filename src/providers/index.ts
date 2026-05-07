import type { AccountConfig } from "../config/store.js";

export interface MessageSummary {
  id: string;
  uid: number;
  from: string;
  to: string[];
  subject: string;
  date: Date;
  flags: { seen: boolean; flagged: boolean };
  snippet?: string;
}

export interface MessageBody {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: Date;
  text: string;
  html?: string;
  inReplyTo?: string;
  messageId?: string;
}

export interface ListOptions {
  folder?: string;
  limit?: number;
  unread?: boolean;
}

export interface SendInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
}

export interface Provider {
  list(opts: ListOptions): Promise<MessageSummary[]>;
  fetch(id: string): Promise<MessageBody>;
  send(input: SendInput): Promise<void>;
  search(query: string, opts?: { folder?: string; limit?: number }): Promise<MessageSummary[]>;
  close(): Promise<void>;
}

export async function getProvider(account: AccountConfig): Promise<Provider> {
  switch (account.kind) {
    case "imap": {
      const { ImapProvider } = await import("./imap.js");
      return ImapProvider.connect(account);
    }
    case "gmail": {
      const { GmailProvider } = await import("./gmail.js");
      return GmailProvider.connect(account);
    }
    case "outlook": {
      const { OutlookProvider } = await import("./outlook.js");
      return OutlookProvider.connect(account);
    }
  }
}
