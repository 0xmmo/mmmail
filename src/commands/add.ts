import { readFileSync } from "node:fs";
import pc from "picocolors";
import {
  addGoogleAccount,
  addImapAccount,
  PRESETS,
  type ProviderPreset,
} from "./init.js";
import { getProviderSecret } from "../auth/secrets.js";

interface AddGoogleOpts {
  clientId?: string;
  clientSecret?: string;
  clientSecretStdin?: boolean;
  credentialsFile?: string;
  email: string;
  json?: boolean;
}

export async function runAddGoogle(opts: AddGoogleOpts): Promise<void> {
  const fromFile = opts.credentialsFile
    ? loadCredentialsFile(opts.credentialsFile)
    : undefined;

  const clientId =
    opts.clientId ??
    fromFile?.clientId ??
    (await getProviderSecret("google", "oauth-client-id")) ??
    undefined;

  let clientSecret =
    opts.clientSecret ??
    fromFile?.clientSecret ??
    (await getProviderSecret("google", "oauth-client-secret")) ??
    undefined;

  if (opts.clientSecretStdin) {
    clientSecret = (await readStdin()).trim();
  }

  if (!clientId || !clientSecret) {
    console.error(pc.red("Missing Google OAuth client credentials."));
    console.error(
      pc.dim(
        "  Run `mmm setup google` for setup instructions, then provide credentials via\n" +
          "  --credentials-file <path>, --client-id + --client-secret, or --client-secret-stdin.",
      ),
    );
    process.exit(1);
  }

  if (!/.+@.+\..+/.test(opts.email)) {
    console.error(pc.red(`Invalid email: ${opts.email}`));
    process.exit(1);
  }

  if (!opts.json) console.log(pc.dim(`Authorizing ${opts.email}...`));
  await addGoogleAccount({
    clientId,
    clientSecret,
    email: opts.email,
    onAuthUrl: (url) => {
      if (opts.json) {
        // print machine-readable hint to stderr so JSON on stdout stays clean
        console.error(JSON.stringify({ authUrl: url }));
      } else {
        console.log(pc.bold("Open this URL in your browser to authorize:"));
        console.log(`  ${pc.underline(url)}`);
      }
    },
  });
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, email: opts.email }, null, 2));
  } else {
    console.log(pc.green(`✓ Authorized ${opts.email}`));
  }
}

function loadCredentialsFile(path: string): { clientId: string; clientSecret: string } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    console.error(
      pc.red(
        `Could not read credentials file ${path}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(pc.red(`Credentials file ${path} is not valid JSON`));
    process.exit(1);
  }
  const obj = parsed as { installed?: unknown; web?: unknown };
  const inner = (obj.installed ?? obj.web) as
    | { client_id?: string; client_secret?: string }
    | undefined;
  if (!inner?.client_id || !inner?.client_secret) {
    console.error(
      pc.red(
        `Credentials file ${path} is missing 'installed' (or 'web') with client_id/client_secret.\n` +
          "  Use the JSON downloaded from Google Cloud Console after creating an OAuth client.",
      ),
    );
    process.exit(1);
  }
  return { clientId: inner.client_id, clientSecret: inner.client_secret };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer | string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface AddImapOpts {
  email: string;
  preset?: string;
  imapHost?: string;
  imapPort?: string;
  imapTls?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpTls?: string;
  passwordStdin?: boolean;
  passwordEnv?: string;
  smtpPasswordStdin?: boolean;
  smtpPasswordEnv?: string;
  json?: boolean;
}

export async function runAddImap(opts: AddImapOpts): Promise<void> {
  if (!/.+@.+\..+/.test(opts.email)) {
    console.error(pc.red(`Invalid email: ${opts.email}`));
    process.exit(1);
  }

  const preset = resolveImapPreset(opts);
  if (!preset) {
    console.error(
      pc.red(
        "Need either --preset (fastmail|icloud|yahoo) or all of --imap-host/--imap-port/--smtp-host/--smtp-port.",
      ),
    );
    process.exit(1);
  }

  const password = await readPasswordFromOpts(
    opts.passwordStdin,
    opts.passwordEnv,
  );
  if (!password) {
    console.error(
      pc.red(
        "No password provided. Use --password-stdin (pipe in) or --password-env <VAR>.",
      ),
    );
    process.exit(1);
  }

  const smtpPassword = await readPasswordFromOpts(
    opts.smtpPasswordStdin,
    opts.smtpPasswordEnv,
  );

  await addImapAccount({
    email: opts.email,
    imap: preset.imap,
    smtp: preset.smtp,
    password,
    smtpPassword,
  });
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, email: opts.email }, null, 2));
  } else {
    console.log(pc.green(`✓ Saved account ${opts.email}`));
  }
}

async function readPasswordFromOpts(
  fromStdin: boolean | undefined,
  fromEnv: string | undefined,
): Promise<string | undefined> {
  if (fromEnv) return process.env[fromEnv];
  if (fromStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk as Buffer | string));
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  }
  return undefined;
}

function resolveImapPreset(opts: AddImapOpts): ProviderPreset | undefined {
  if (opts.preset) {
    return PRESETS[opts.preset];
  }
  if (opts.imapHost && opts.imapPort && opts.smtpHost && opts.smtpPort) {
    return {
      imap: {
        host: opts.imapHost,
        port: Number(opts.imapPort),
        secure: parseTls(opts.imapTls, true),
      },
      smtp: {
        host: opts.smtpHost,
        port: Number(opts.smtpPort),
        secure: parseTls(opts.smtpTls, true),
      },
    };
  }
  return undefined;
}

function parseTls(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "true" || v === "1" || v === "yes";
}

