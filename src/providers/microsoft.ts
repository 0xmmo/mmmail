import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { AccountConfig } from "../config/store.js";
import { getSecret, setSecret } from "../auth/secrets.js";
import {
  DEFAULT_CLIENT_ID,
  refreshAccessToken,
} from "../auth/oauth-microsoft.js";
import { MailboxBase } from "./_base.js";

export class MicrosoftProvider extends MailboxBase {
  static async connect(account: AccountConfig): Promise<MicrosoftProvider> {
    if (account.kind !== "microsoft") {
      throw new Error(
        `MicrosoftProvider cannot handle account kind ${account.kind}`,
      );
    }
    const clientId =
      (await getSecret("oauth-client-id", account.email)) ||
      DEFAULT_CLIENT_ID;
    const refreshToken = await getSecret("oauth-refresh", account.email);
    if (!clientId || !refreshToken) {
      throw new Error(
        `Microsoft credentials missing for ${account.email}. Run \`mmm init\` to authorize.`,
      );
    }

    const refreshed = await refreshAccessToken({ clientId, refreshToken });
    // Microsoft rotates the refresh token on every refresh — persist it.
    if (refreshed.refreshToken !== refreshToken) {
      await setSecret("oauth-refresh", account.email, refreshed.refreshToken);
    }

    const client = new ImapFlow({
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: { user: account.email, accessToken: refreshed.accessToken },
      logger: false,
    });
    await client.connect();

    const smtp = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        type: "OAuth2",
        user: account.email,
        accessToken: refreshed.accessToken,
      },
    });

    return new MicrosoftProvider(account.email, client, smtp);
  }
}
