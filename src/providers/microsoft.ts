import type { AccountConfig } from "../config/store.js";
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

export class MicrosoftProvider implements Provider {
  static async connect(_account: AccountConfig): Promise<MicrosoftProvider> {
    throw new Error(
      "Microsoft provider is not yet implemented in this build. Use generic IMAP for now.",
    );
  }
  list(_opts: ListOptions): Promise<MessageSummary[]> {
    throw new Error("not implemented");
  }
  fetch(_id: string, _opts?: { folder?: string }): Promise<MessageBody> {
    throw new Error("not implemented");
  }
  send(_input: SendInput): Promise<SendResult> {
    throw new Error("not implemented");
  }
  search(_query: string, _opts?: SearchOptions): Promise<MessageSummary[]> {
    throw new Error("not implemented");
  }
  folders(): Promise<string[]> {
    throw new Error("not implemented");
  }
  setFlags(
    _id: string,
    _flags: SetFlagsInput,
    _opts?: { folder?: string },
  ): Promise<void> {
    throw new Error("not implemented");
  }
  move(
    _id: string,
    _dest: string,
    _opts?: { folder?: string },
  ): Promise<void> {
    throw new Error("not implemented");
  }
  del(_id: string, _opts?: { folder?: string }): Promise<void> {
    throw new Error("not implemented");
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
