import { confirm, input, password, select } from "@inquirer/prompts";
import pc from "picocolors";
import {
  readConfig,
  removeAccount,
  setDefaultAccount,
  upsertAccount,
  type AccountConfig,
  type ImapAccountConfig,
  type OAuthAccountConfig,
} from "../config/store.js";
import {
  deleteAllForAccount,
  deleteSecret,
  getProviderSecret,
  setProviderSecret,
  setSecret,
} from "../auth/secrets.js";
import { runConsentFlow } from "../auth/oauth-google.js";
import {
  DEFAULT_CLIENT_ID,
  runConsentFlow as runMsConsentFlow,
} from "../auth/oauth-microsoft.js";
import { discoverMailServers, type DiscoverResult } from "../auth/autodiscover.js";
import {
  impliesImplicitTls,
  parseHostPort,
  validateEmail,
  validateHostPort,
  validateNonEmpty,
  validatePort,
} from "../auth/validate.js";
import { testImap, testSmtp, type ServerSpec } from "../auth/connection-test.js";

export interface ProviderPreset {
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
}

export const PRESETS: Record<string, ProviderPreset> = {
  fastmail: {
    imap: { host: "imap.fastmail.com", port: 993, secure: true },
    smtp: { host: "smtp.fastmail.com", port: 465, secure: true },
  },
  icloud: {
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
  },
  yahoo: {
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  },
};

export interface GoogleSetupStep {
  title: string;
  url?: string;
  detail?: string;
}

export const GOOGLE_SETUP_STEPS: GoogleSetupStep[] = [
  {
    title: "Create a Google Cloud project (or skip if you already have one)",
    url: "https://console.cloud.google.com/projectcreate",
    detail: "Name it (e.g. 'mmmail') and click Create.",
  },
  {
    title: "Enable the Gmail API",
    url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
    detail: "Click 'Enable' on the Gmail API page.",
  },
  {
    title: "Configure OAuth consent screen",
    url: "https://console.cloud.google.com/auth/overview",
    detail:
      "Choose a name and Audience: External. Add your Gmail address for support & contact.",
  },
  {
    title: "Add yourself as a test user",
    url: "https://console.cloud.google.com/auth/audience",
    detail:
      "Under the Audience tab, scroll to 'Test users' and add your Gmail address.",
  },
  {
    title: "Create OAuth credentials (Desktop app)",
    url: "https://console.cloud.google.com/auth/clients",
    detail:
      "Click '+ Create Client' → Application type: Desktop app. Name it and don't close the dialog!",
  },
  {
    title: "Copy the Client ID + Client secret from the dialog",
  },
];

export function printGoogleSetupSteps(): void {
  console.log(
    pc.bold("Google OAuth client setup") + pc.dim(" (~3 min, one-time)"),
  );
  console.log("");
  for (const [i, step] of GOOGLE_SETUP_STEPS.entries()) {
    console.log(pc.cyan(`  Step ${i + 1}: ${step.title}`));
    if (step.url) console.log(`          ${pc.underline(step.url)}`);
    if (step.detail) console.log(pc.dim(`          ${step.detail}`));
  }
}

export const MICROSOFT_SETUP_STEPS: GoogleSetupStep[] = [
  {
    title: "Register a new app",
    url: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/quickStartType~/null/isMSAApp~/false",
    detail:
      "Name it (e.g. 'mmmail'). Supported account types: 'Accounts in any organizational directory and personal Microsoft accounts'. Leave the Redirect URI blank — you'll set it next.",
  },
  {
    title: "Open the app's Authentication page",
    detail:
      "Entra admin center → App registrations → click your new app → left sidebar Manage → Authentication. (Not the directory-wide 'Authentication methods' page.)",
  },
  {
    title: "Add the redirect URI",
    detail:
      "On the 'Redirect URI configuration' tab, click '+ Add Redirect URI'. In the 'Select a platform' panel, pick the 'Mobile and desktop applications' card (Windows, UWP, Console, IoT…) → Select. Enter `http://localhost` as the URI → Configure.",
  },
  {
    title: "Allow public client flows",
    detail:
      "On the same Authentication page, click the 'Settings' tab → toggle 'Allow public client flows' to Yes → Save.",
  },
  {
    title: "Copy the Application (client) ID",
    detail:
      "Left sidebar of your app → Overview → copy 'Application (client) ID'. No client secret is needed — mmm uses PKCE.",
  },
  {
    title: "Work/school accounts only: confirm SMTP AUTH is enabled",
    url: "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission",
    detail:
      "Many M365 tenants disable SMTP AUTH by default. If `mmm send` fails with 'SmtpClientAuthentication is disabled', ask your admin to enable it for your mailbox.",
  },
];

export function printMicrosoftSetupSteps(): void {
  console.log(
    pc.bold("Microsoft Entra app setup") + pc.dim(" (~2 min, one-time)"),
  );
  console.log("");
  for (const [i, step] of MICROSOFT_SETUP_STEPS.entries()) {
    console.log(pc.cyan(`  Step ${i + 1}: ${step.title}`));
    if (step.url) console.log(`          ${pc.underline(step.url)}`);
    if (step.detail) console.log(pc.dim(`          ${step.detail}`));
  }
}

export async function addImapAccount(opts: {
  email: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
  password: string;
  smtpPassword?: string;
}): Promise<void> {
  const account: ImapAccountConfig = {
    kind: "imap",
    email: opts.email,
    imap: { ...opts.imap, user: opts.email },
    smtp: { ...opts.smtp, user: opts.email },
  };
  await setSecret("imap-password", opts.email, opts.password);
  if (opts.smtpPassword) {
    await setSecret("smtp-password", opts.email, opts.smtpPassword);
  }
  await upsertAccount(account);
}

export async function addGoogleAccount(opts: {
  clientId: string;
  clientSecret: string;
  email: string;
  onAuthUrl?: (url: string) => void;
}): Promise<void> {
  await setProviderSecret("google", "oauth-client-id", opts.clientId);
  await setProviderSecret("google", "oauth-client-secret", opts.clientSecret);
  const tokens = await runConsentFlow({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    loginHint: opts.email,
    onAuthUrl: opts.onAuthUrl,
  });
  await setSecret("oauth-refresh", opts.email, tokens.refreshToken);
  const account: OAuthAccountConfig = { kind: "google", email: opts.email };
  await upsertAccount(account);
}

export async function addMicrosoftAccount(opts: {
  clientId: string;
  email: string;
  onAuthUrl?: (url: string) => void;
}): Promise<void> {
  const tokens = await runMsConsentFlow({
    clientId: opts.clientId,
    loginHint: opts.email,
    onAuthUrl: opts.onAuthUrl,
  });
  // Pin the client_id per-account: refresh tokens are scoped to the client
  // that obtained them, so each account must remember which client_id
  // authorized it. The default (mmmail's built-in) is left unstored so
  // future bake-ins of DEFAULT_CLIENT_ID flow through to all accounts that
  // were authorized via it.
  if (opts.clientId !== DEFAULT_CLIENT_ID) {
    await setSecret("oauth-client-id", opts.email, opts.clientId);
  } else {
    await deleteSecret("oauth-client-id", opts.email);
  }
  await setSecret("oauth-refresh", opts.email, tokens.refreshToken);
  const account: OAuthAccountConfig = { kind: "microsoft", email: opts.email };
  await upsertAccount(account);
}

export async function runInit(): Promise<void> {
  if (!process.stdin.isTTY) {
    await printNonInteractiveHelp();
    return;
  }

  while (true) {
    const cfg = await readConfig();
    const accounts = Object.values(cfg.accounts);

    if (accounts.length === 0) {
      console.log(pc.dim("No accounts yet. Let's add one."));
      console.log("");
      const added = await runAdd();
      if (!added) return;
      continue;
    }

    printAccounts(accounts, cfg.defaultAccount);

    const choices: { name: string; value: string }[] = [
      { name: "Add an account", value: "add" },
    ];
    if (accounts.length > 1) {
      choices.push({ name: "Set default account", value: "set-default" });
    }
    choices.push({ name: "Remove an account", value: "remove" });
    choices.push({ name: "Exit", value: "exit" });

    const action = await select({
      message: "Options",
      choices,
      default: "exit",
    });

    if (action === "exit") return;
    if (action === "add") await runAdd();
    if (action === "set-default") await runSetDefault(accounts, cfg.defaultAccount);
    if (action === "remove") await runRemove(accounts);
    console.log("");
  }
}

async function printNonInteractiveHelp(): Promise<void> {
  const cfg = await readConfig();
  const accounts = Object.values(cfg.accounts);

  console.log(pc.bold("mmmail") + pc.dim(" — running in non-interactive mode"));
  console.log(
    pc.dim(
      `  Run ${pc.cyan("`mmm`")}${pc.dim(" interactively from a terminal, or use the commands below.")}`,
    ),
  );
  console.log("");

  if (accounts.length > 0) {
    printAccounts(accounts, cfg.defaultAccount);
  } else {
    console.log(pc.dim("No accounts configured yet."));
    console.log("");
  }

  console.log(pc.bold("Add an account (non-interactive)"));
  console.log(`  ${pc.cyan("mmm setup google")}                                ${pc.dim("# print Google OAuth setup steps")}`);
  console.log(`  ${pc.cyan("mmm add google --email <you@gmail.com> \\")}`);
  console.log(`    ${pc.cyan("--client-id <id> --client-secret <secret>")}    ${pc.dim("# authorize via loopback URL")}`);
  console.log(`  ${pc.cyan("mmm add microsoft --email <you@outlook.com>")}     ${pc.dim("# uses mmmail's built-in Entra app")}`);
  console.log(`  ${pc.cyan("mmm add microsoft --email <addr> --client-id <id>")} ${pc.dim("# bring your own Entra app")}`);
  console.log(`  ${pc.cyan("mmm add imap --email <addr> \\")}`);
  console.log(`    ${pc.cyan("--password-env IMAP_PW")}                       ${pc.dim("# auto-detects IMAP/SMTP from the email domain")}`);
  console.log("");

  console.log(pc.bold("Manage accounts"));
  console.log(`  ${pc.cyan("mmm accounts")}              ${pc.dim("# list configured accounts")}`);
  if (accounts.length > 1) {
    console.log(`  ${pc.cyan("mmm default <email>")}       ${pc.dim("# switch the default account")}`);
  }
  if (accounts.length > 0) {
    console.log(`  ${pc.cyan("mmm remove <email>")}        ${pc.dim("# remove an account + its keychain entries")}`);
  }
  console.log("");

  console.log(pc.bold("Use mmmail"));
  console.log(`  ${pc.cyan("mmm list [-n N] [-u]")}                   ${pc.dim("# list INBOX messages")}`);
  console.log(`  ${pc.cyan("mmm read <uid>")}                         ${pc.dim("# read one message")}`);
  console.log(`  ${pc.cyan("mmm send -t <to> -s <subj> -b <body>")}   ${pc.dim("# send")}`);
  console.log(`  ${pc.cyan("mmm reply <uid> -b <body>")}              ${pc.dim("# reply")}`);
  console.log(`  ${pc.cyan("mmm search <query>")}                     ${pc.dim("# search")}`);
  console.log(pc.dim("  Add `-a <email>` to any of these to override the default account."));
}

function printAccounts(accounts: AccountConfig[], defaultEmail?: string): void {
  console.log(pc.bold("Accounts"));
  for (const a of accounts) {
    const isDefault = a.email === defaultEmail;
    const marker = isDefault ? pc.green("●") : pc.dim("○");
    const label = isDefault
      ? pc.bold(a.email) + pc.green(" (default)")
      : pc.bold(a.email);
    console.log(`  ${marker} ${label}  ${pc.dim(a.kind)}`);
  }
  console.log("");
}

async function runAdd(): Promise<boolean> {
  const kind = await select({
    message: "Provider",
    choices: [
      { name: "Google (OAuth)", value: "google" },
      { name: "Microsoft (OAuth)", value: "microsoft" },
      { name: "Generic IMAP/SMTP (app password)", value: "imap" },
    ],
  });

  if (kind === "google") {
    await runGoogleInit();
    return true;
  }
  if (kind === "microsoft") {
    await runMicrosoftInit();
    return true;
  }
  if (kind === "imap") {
    await runImapInit();
    return true;
  }
  return false;
}

async function runSetDefault(
  accounts: AccountConfig[],
  currentDefault?: string,
): Promise<void> {
  const pick = await select({
    message: "Set default account",
    choices: [
      { name: "Cancel", value: "" },
      ...accounts
        .filter((a) => a.email !== currentDefault)
        .map((a) => ({ name: a.email, value: a.email })),
    ],
    default: "",
  });
  if (!pick) return;
  await setDefaultAccount(pick);
  console.log(pc.green(`✓ Default set to ${pick}`));
}

async function runRemove(accounts: AccountConfig[]): Promise<void> {
  const pick = await select({
    message: "Remove which account?",
    choices: [
      { name: "Cancel", value: "" },
      ...accounts.map((a) => ({ name: a.email, value: a.email })),
    ],
    default: "",
  });
  if (!pick) return;
  const sure = await confirm({
    message: `Remove ${pick}? This deletes its keychain entries too.`,
    default: false,
  });
  if (!sure) return;
  const removed = await removeAccount(pick);
  if (!removed) {
    console.error(pc.red(`No account ${pick}`));
    return;
  }
  await deleteAllForAccount(pick);
  console.log(pc.green(`✓ Removed ${pick}`));
}

async function runImapInit(): Promise<void> {
  const email = (
    await input({
      message: "Email address",
      validate: validateEmail,
    })
  ).trim();

  let preset = await resolveImapPresetInteractive(email);
  if (!preset) return;

  console.log(
    pc.dim("  Tip: most providers want an app password, not your account password."),
  );
  let pw = await password({
    message: "App password (stored in OS keychain)",
    mask: "•",
    validate: validateNonEmpty("a password"),
  });

  let smtpPassword: string | undefined;

  while (true) {
    const result = await verifyConnection(email, preset, pw, smtpPassword);
    if (result === "save") break;
    if (result === "cancel") return;
    if (result.action === "edit") {
      const next = await promptCustomServers(preset);
      if (!next) return;
      preset = next;
    } else if (result.action === "smtp-password") {
      smtpPassword = await password({
        message: "SMTP password (separate from IMAP)",
        mask: "•",
        validate: validateNonEmpty("a password"),
      });
    } else if (result.action === "imap-password") {
      pw = await password({
        message: "IMAP/app password",
        mask: "•",
        validate: validateNonEmpty("a password"),
      });
      smtpPassword = undefined;
    }
  }

  await addImapAccount({
    email,
    imap: preset.imap,
    smtp: preset.smtp,
    password: pw,
    smtpPassword,
  });

  console.log(pc.green(`✓ Saved account ${email}`));
  console.log(pc.dim(`  Try: mmm list`));
}

type VerifyResult =
  | "save"
  | "cancel"
  | { action: "edit" | "imap-password" | "smtp-password" };

async function verifyConnection(
  email: string,
  preset: ProviderPreset,
  pw: string,
  smtpPassword?: string,
): Promise<VerifyResult> {
  console.log(pc.dim(`  Testing IMAP ${preset.imap.host}:${preset.imap.port}…`));
  const imapResult = await testImap(preset.imap as ServerSpec, email, pw);
  if (!imapResult.ok) {
    console.log(pc.red(`  ✗ IMAP failed: ${imapResult.error}`));
    return promptOnFailure({
      side: "IMAP",
      authFailed: imapResult.authFailed === true,
    });
  }
  console.log(pc.green("  ✓ IMAP OK"));

  console.log(pc.dim(`  Testing SMTP ${preset.smtp.host}:${preset.smtp.port}…`));
  const smtpPw = smtpPassword ?? pw;
  const smtpResult = await testSmtp(preset.smtp as ServerSpec, email, smtpPw);
  if (!smtpResult.ok) {
    console.log(pc.red(`  ✗ SMTP failed: ${smtpResult.error}`));
    return promptOnFailure({
      side: "SMTP",
      authFailed: smtpResult.authFailed === true,
      hasSeparateSmtpPw: smtpPassword !== undefined,
    });
  }
  console.log(pc.green("  ✓ SMTP OK"));
  return "save";
}

async function promptOnFailure(opts: {
  side: "IMAP" | "SMTP";
  authFailed: boolean;
  hasSeparateSmtpPw?: boolean;
}): Promise<VerifyResult> {
  const choices: { name: string; value: string }[] = [];
  if (opts.authFailed) {
    if (opts.side === "IMAP") {
      choices.push({ name: "Re-enter password", value: "imap-password" });
    } else {
      choices.push({
        name: opts.hasSeparateSmtpPw
          ? "Re-enter SMTP password"
          : "Use a separate SMTP password",
        value: "smtp-password",
      });
    }
  } else {
    choices.push({ name: "Retry", value: "retry" });
  }
  choices.push({ name: "Edit settings", value: "edit" });
  choices.push({ name: "Save anyway (skip the test)", value: "save" });
  choices.push({ name: "Cancel", value: "cancel" });

  const action = await select({
    message: `${opts.side} test failed — what now?`,
    choices,
    default: choices[0]!.value,
  });
  if (action === "save") return "save";
  if (action === "cancel") return "cancel";
  if (action === "retry") return { action: "edit" };
  return { action: action as "edit" | "imap-password" | "smtp-password" };
}

async function resolveImapPresetInteractive(
  email: string,
): Promise<ProviderPreset | undefined> {
  const domain = email.split("@")[1] ?? "";

  console.log(pc.dim(`  Looking up mail servers for ${domain}…`));
  const discovered = await discoverMailServers(email).catch(() => null);

  if (discovered) {
    printDetectedServers(discovered);
    const choice = await select({
      message: "Use these settings?",
      choices: [
        { name: "Continue", value: "use" },
        { name: "Edit settings", value: "custom" },
        { name: "Cancel", value: "cancel" },
      ],
      default: "use",
    });
    if (choice === "cancel") return undefined;
    if (choice === "use") return discovered.preset;
    return promptCustomServers(discovered.preset);
  }

  console.log(
    pc.yellow("  Couldn't auto-detect IMAP/SMTP servers — enter them manually."),
  );
  return promptCustomServers();
}

function printDetectedServers(d: DiscoverResult): void {
  const sourceLabel =
    d.source === "ispdb"
      ? "Mozilla autoconfig"
      : d.source === "autoconfig"
        ? "domain autoconfig"
        : d.source === "mx"
          ? "MX record"
          : "DNS SRV records";
  const provider = d.displayName ? ` — ${d.displayName}` : "";
  console.log(pc.green(`  ✓ Detected via ${sourceLabel}${provider}`));
  console.log(pc.dim(`    IMAP  ${formatServer(d.preset.imap)}`));
  console.log(pc.dim(`    SMTP  ${formatServer(d.preset.smtp)}`));
}

function formatServer(s: { host: string; port: number; secure: boolean }): string {
  return `${s.host}:${s.port} (${s.secure ? "SSL/TLS" : "STARTTLS"})`;
}

async function promptCustomServers(
  defaults?: ProviderPreset,
): Promise<ProviderPreset | undefined> {
  const imap = await promptServer("IMAP", defaults?.imap);
  if (!imap) return undefined;
  const smtp = await promptServer("SMTP", defaults?.smtp);
  if (!smtp) return undefined;
  return { imap, smtp };
}

async function promptServer(
  protocol: "IMAP" | "SMTP",
  defaults?: { host: string; port: number; secure: boolean },
): Promise<{ host: string; port: number; secure: boolean } | undefined> {
  const proto = protocol.toLowerCase() as "imap" | "smtp";
  const defaultPort = defaults?.port ?? (proto === "imap" ? 993 : 465);
  const defaultStr = defaults
    ? `${defaults.host}:${defaults.port}`
    : protocol === "IMAP"
      ? "imap.example.com:993"
      : "smtp.example.com:465";

  const raw = (
    await input({
      message: `${protocol} server (host or host:port)`,
      default: defaultStr,
      validate: (v) => validateHostPort(v, defaultPort),
    })
  ).trim();
  const parsed = parseHostPort(raw)!;
  const port = parsed.port ?? defaultPort;
  const portValidation = validatePort(port);
  if (portValidation !== true) {
    console.log(pc.red(`  ${portValidation}`));
    return undefined;
  }

  let secure = impliesImplicitTls(proto, port);
  if (secure === undefined) {
    secure =
      (await select({
        message: `${protocol} TLS for port ${port}`,
        choices: [
          { name: "Implicit TLS (SSL)", value: "true" },
          { name: "STARTTLS", value: "false" },
        ],
        default: defaults ? String(defaults.secure) : "true",
      })) === "true";
  }

  return { host: parsed.host, port, secure };
}

async function runGoogleInit(): Promise<void> {
  let clientId = await getProviderSecret("google", "oauth-client-id");
  let clientSecret = await getProviderSecret("google", "oauth-client-secret");

  if (!clientId || !clientSecret) {
    console.log("");
    console.log(
      pc.bold("  mmmail will setup your own private local Google OAuth client (~3 min)"),
    );
    console.log("");
    printGoogleSetupSteps();
    console.log("");
    await confirm({
      message: "Press enter when you have your Client ID and secret ready",
      default: true,
    });
    clientId = await input({
      message: "Client ID (from the OAuth client dialog)",
      validate: (v) =>
        v.endsWith(".apps.googleusercontent.com") ||
        "Should end with .apps.googleusercontent.com",
    });
    clientSecret = await password({
      message: "Client secret (stored in OS keychain)",
      mask: "•",
    });
    console.log(pc.dim("  Saved Google OAuth client credentials. They can be reused for additional future Gmail accounts."));
  } else {
    console.log(
      pc.dim(
        "  Reusing saved Google OAuth client credentials. (Run `mmm reset-google` if you need to change them.)",
      ),
    );
  }

  console.log("");
  console.log(pc.green("  ✓ Google OAuth client setup"));
  console.log("");

  const email = await input({
    message: "What is your Gmail address?",
    validate: (v) => /.+@.+\..+/.test(v) || "Enter a valid email",
  });

  console.log(pc.dim("  Opening browser to authorize..."));
  await addGoogleAccount({
    clientId,
    clientSecret,
    email,
    onAuthUrl: (url) => {
      console.log(pc.dim(`  If the browser doesn't open, visit:\n  ${url}`));
    },
  });

  console.log(pc.green(`✓ Authorized ${email}`));
  console.log(pc.dim(`  Try: mmm list`));
}

async function runMicrosoftInit(): Promise<void> {
  const clientId = await resolveMicrosoftClientIdInteractive();
  if (!clientId) return;

  const email = await input({
    message: "What is your Microsoft email address?",
    validate: (v) => /.+@.+\..+/.test(v) || "Enter a valid email",
  });

  console.log(pc.dim("  Opening browser to authorize..."));
  await addMicrosoftAccount({
    clientId,
    email,
    onAuthUrl: (url) => {
      console.log(pc.dim(`  If the browser doesn't open, visit:\n  ${url}`));
    },
  });

  console.log(pc.green(`✓ Authorized ${email}`));
  console.log(pc.dim(`  Try: mmm list`));
}

async function resolveMicrosoftClientIdInteractive(): Promise<string | undefined> {
  // No built-in client baked into this build — only the own-app path is viable.
  if (!DEFAULT_CLIENT_ID) {
    return await promptForOwnMicrosoftClientId();
  }

  const which = await select({
    message: "OAuth client",
    choices: [
      {
        name: "Use mmmail's built-in client (recommended — no Azure setup)",
        value: "default",
      },
      {
        name: "Register your own Microsoft Entra app (advanced)",
        value: "own",
      },
    ],
  });
  if (which === "default") return DEFAULT_CLIENT_ID;
  return await promptForOwnMicrosoftClientId();
}

async function promptForOwnMicrosoftClientId(): Promise<string> {
  console.log("");
  console.log(
    pc.bold("  Register your own Microsoft Entra app (~2 min, one-time)"),
  );
  console.log("");
  printMicrosoftSetupSteps();
  console.log("");
  await confirm({
    message: "Press enter when you have your Application (client) ID ready",
    default: true,
  });
  return await input({
    message: "Application (client) ID",
    validate: (v) => v.trim().length > 0 || "Enter a non-empty client ID",
  });
}
