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
  references: string[];
  messageId?: string;
}

export interface ListOptions {
  folder?: string;
  limit?: number;
  unread?: boolean;
  since?: Date;
  before?: Date;
  uidAfter?: number;
}

export interface SearchOptions {
  folder?: string;
  limit?: number;
  since?: Date;
  before?: Date;
  uidAfter?: number;
}

export interface SetFlagsInput {
  seen?: boolean;
  flagged?: boolean;
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

export interface SendResult {
  messageId?: string;
  accepted: string[];
  rejected: string[];
}

export interface Provider {
  list(opts: ListOptions): Promise<MessageSummary[]>;
  fetch(id: string, opts?: { folder?: string }): Promise<MessageBody>;
  send(input: SendInput): Promise<SendResult>;
  search(query: string, opts?: SearchOptions): Promise<MessageSummary[]>;
  folders(): Promise<string[]>;
  setFlags(id: string, flags: SetFlagsInput, opts?: { folder?: string }): Promise<void>;
  move(id: string, dest: string, opts?: { folder?: string }): Promise<void>;
  del(id: string, opts?: { folder?: string }): Promise<void>;
  close(): Promise<void>;
}

export async function getProvider(account: AccountConfig): Promise<Provider> {
  switch (account.kind) {
    case "imap": {
      const { ImapProvider } = await import("./imap.js");
      return ImapProvider.connect(account);
    }
    case "google": {
      const { GoogleProvider } = await import("./google.js");
      return GoogleProvider.connect(account);
    }
    case "microsoft": {
      const { MicrosoftProvider } = await import("./microsoft.js");
      return MicrosoftProvider.connect(account);
    }
  }
}
