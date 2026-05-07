import type { AccountConfig } from "../config/store.js";
import type {
  ListOptions,
  MessageBody,
  MessageSummary,
  Provider,
  SendInput,
} from "./index.js";

export class GmailProvider implements Provider {
  static async connect(_account: AccountConfig): Promise<GmailProvider> {
    throw new Error(
      "Gmail provider is not yet implemented in this build. Use --kind imap with an app password for now.",
    );
  }
  list(_opts: ListOptions): Promise<MessageSummary[]> {
    throw new Error("not implemented");
  }
  fetch(_id: string): Promise<MessageBody> {
    throw new Error("not implemented");
  }
  send(_input: SendInput): Promise<void> {
    throw new Error("not implemented");
  }
  search(
    _query: string,
    _opts?: { folder?: string; limit?: number },
  ): Promise<MessageSummary[]> {
    throw new Error("not implemented");
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
