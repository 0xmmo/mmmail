import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { AccountConfig } from "../config/store.js";
import {
  getProviderSecret,
  getSecret,
} from "../auth/secrets.js";
import { refreshAccessToken } from "../auth/oauth-google.js";
import { MailboxBase } from "./_base.js";

export class GoogleProvider extends MailboxBase {
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

    const { accessToken } = await refreshAccessToken({
      clientId,
      clientSecret,
      refreshToken,
    });

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

    return new GoogleProvider(account.email, client, smtp);
  }
}
