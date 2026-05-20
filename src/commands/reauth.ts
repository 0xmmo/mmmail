import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProviderSecret, getSecret } from "../auth/secrets.js";
import { DEFAULT_CLIENT_ID } from "../auth/oauth-microsoft.js";
import { addGoogleAccount, addMicrosoftAccount } from "./init.js";

interface ReauthOpts {
  json?: boolean;
}

export async function runReauth(email: string, opts: ReauthOpts): Promise<void> {
  const account = await resolveAccount(email);
  if (!account) {
    console.error(pc.red(`No account ${email} configured.`));
    process.exit(1);
  }
  if (account.kind === "imap") {
    console.error(
      pc.red(
        `${email} is an IMAP account — re-run \`mmm add imap --email ${email}\` if you need to change the password.`,
      ),
    );
    process.exit(1);
  }

  const onAuthUrl = (url: string): void => {
    if (opts.json) {
      console.error(JSON.stringify({ authUrl: url }));
    } else {
      console.log(pc.bold("Open this URL in your browser to re-authorize:"));
      console.log(`  ${pc.underline(url)}`);
    }
  };

  if (account.kind === "google") {
    const clientId = await getProviderSecret("google", "oauth-client-id");
    const clientSecret = await getProviderSecret("google", "oauth-client-secret");
    if (!clientId || !clientSecret) {
      console.error(
        pc.red(
          `No stored Google OAuth client credentials. Re-run \`mmm add google --email ${email}\` with --client-id / --client-secret instead.`,
        ),
      );
      process.exit(1);
    }
    if (!opts.json) console.log(pc.dim(`Re-authorizing ${email}…`));
    await addGoogleAccount({ clientId, clientSecret, email, onAuthUrl });
  } else {
    const stored = await getSecret("oauth-client-id", email);
    const clientId = stored || DEFAULT_CLIENT_ID;
    if (!opts.json) console.log(pc.dim(`Re-authorizing ${email}…`));
    await addMicrosoftAccount({ clientId, email, onAuthUrl });
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, email }, null, 2));
  } else {
    console.log(pc.green(`✓ Re-authorized ${email}`));
  }
}
