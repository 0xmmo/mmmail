import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type {
  AccountConfig,
} from "../config/store.js";
import { getSecret } from "../auth/secrets.js";
import { MailboxBase } from "./_base.js";

export class ImapProvider extends MailboxBase {
  static async connect(account: AccountConfig): Promise<ImapProvider> {
    if (account.kind !== "imap") {
      throw new Error(`ImapProvider cannot handle account kind ${account.kind}`);
    }
    const imapPassword = await getSecret("imap-password", account.email);
    if (!imapPassword) {
      throw new Error(
        `No IMAP password stored for ${account.email}. Run \`mmm init\` again.`,
      );
    }
    const client = new ImapFlow({
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.secure,
      auth: { user: account.imap.user, pass: imapPassword },
      logger: false,
    });
    await client.connect();

    const smtpPassword =
      (await getSecret("smtp-password", account.email)) ?? imapPassword;
    const smtp = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.smtp.user, pass: smtpPassword },
    });
    return new ImapProvider(account.email, client, smtp);
  }
}
