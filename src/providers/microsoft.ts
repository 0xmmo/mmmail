import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { AccountConfig } from "../config/store.js";
import { getSecret, setSecret } from "../auth/secrets.js";
import {
  DEFAULT_CLIENT_ID,
  refreshAccessToken,
} from "../auth/oauth-microsoft.js";
import { MailboxBase, type ImapConnector } from "./_base.js";

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
    const storedRefresh = await getSecret("oauth-refresh", account.email);
    if (!clientId || !storedRefresh) {
      throw new Error(
        `Microsoft credentials missing for ${account.email}. Run \`mmm init\` to authorize.`,
      );
    }
    let refreshToken: string = storedRefresh;

    const refreshed = await refreshAccessToken({ clientId, refreshToken });
    if (refreshed.refreshToken !== refreshToken) {
      await setSecret("oauth-refresh", account.email, refreshed.refreshToken);
      refreshToken = refreshed.refreshToken;
    }

    const connector: ImapConnector = async () => {
      const r = await refreshAccessToken({ clientId, refreshToken });
      if (r.refreshToken !== refreshToken) {
        await setSecret("oauth-refresh", account.email, r.refreshToken);
        refreshToken = r.refreshToken;
      }
      const c = new ImapFlow({
        host: "outlook.office365.com",
        port: 993,
        secure: true,
        auth: { user: account.email, accessToken: r.accessToken },
        logger: false,
      });
      await c.connect();
      return c;
    };

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

    return new MicrosoftProvider(account.email, client, smtp, connector);
  }
}
