import { confirm, input, password, select } from "@inquirer/prompts";
import pc from "picocolors";
import {
  upsertAccount,
  type ImapAccountConfig,
  type OAuthAccountConfig,
} from "../config/store.js";
import {
  getProviderSecret,
  setProviderSecret,
  setSecret,
} from "../auth/secrets.js";
import { runConsentFlow } from "../auth/oauth-google.js";

interface ProviderPreset {
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
}

const PRESETS: Record<string, ProviderPreset> = {
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

export async function runInit(): Promise<void> {
  const kind = await select({
    message: "Provider",
    choices: [
      { name: "Google (OAuth)", value: "google" },
      { name: "Microsoft (OAuth) — coming soon", value: "microsoft", disabled: true },
      { name: "Generic IMAP/SMTP (app password)", value: "imap" },
    ],
  });

  if (kind === "google") {
    await runGoogleInit();
    return;
  }

  if (kind !== "imap") {
    console.error(pc.yellow("Only Google and generic IMAP are supported."));
    process.exit(1);
  }

  await runImapInit();
}

async function runImapInit(): Promise<void> {
  const email = await input({
    message: "Email address",
    validate: (v) => /.+@.+\..+/.test(v) || "Enter a valid email",
  });

  const presetKey = await select({
    message: "Server preset",
    choices: [
      { name: "Fastmail", value: "fastmail" },
      { name: "iCloud", value: "icloud" },
      { name: "Yahoo", value: "yahoo" },
      { name: "Custom", value: "custom" },
    ],
  });

  let preset: ProviderPreset;
  if (presetKey === "custom") {
    const imapHost = await input({ message: "IMAP host (e.g. imap.example.com)" });
    const imapPort = Number(
      await input({ message: "IMAP port", default: "993" }),
    );
    const imapSecure =
      (await select({
        message: "IMAP TLS",
        choices: [
          { name: "Implicit TLS (port 993)", value: "true" },
          { name: "STARTTLS / plain", value: "false" },
        ],
      })) === "true";
    const smtpHost = await input({ message: "SMTP host" });
    const smtpPort = Number(
      await input({ message: "SMTP port", default: "465" }),
    );
    const smtpSecure =
      (await select({
        message: "SMTP TLS",
        choices: [
          { name: "Implicit TLS (port 465)", value: "true" },
          { name: "STARTTLS (port 587)", value: "false" },
        ],
      })) === "true";
    preset = {
      imap: { host: imapHost, port: imapPort, secure: imapSecure },
      smtp: { host: smtpHost, port: smtpPort, secure: smtpSecure },
    };
  } else {
    preset = PRESETS[presetKey]!;
  }

  const pw = await password({
    message: "App password (stored in OS keychain)",
    mask: "•",
  });

  const account: ImapAccountConfig = {
    kind: "imap",
    email,
    imap: { ...preset.imap, user: email },
    smtp: { ...preset.smtp, user: email },
  };

  await setSecret("imap-password", email, pw);
  await upsertAccount(account);

  console.log(pc.green(`✓ Saved account ${email}`));
  console.log(pc.dim(`  Try: mmm list`));
}

async function runGoogleInit(): Promise<void> {
  let clientId = await getProviderSecret("google", "oauth-client-id");
  let clientSecret = await getProviderSecret("google", "oauth-client-secret");

  if (!clientId || !clientSecret) {
    await walkGoogleCloudSetup();
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
    await setProviderSecret("google", "oauth-client-id", clientId);
    await setProviderSecret("google", "oauth-client-secret", clientSecret);
    console.log(pc.dim("  Saved Google OAuth client credentials. They can be reused for additional future Gmail accounts."));
  } else {
    console.log(
      pc.dim(
        "  Reusing saved Google OAuth client credentials. (Run `mmm init --reset-google` if you need to change them.)",
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
  const tokens = await runConsentFlow({
    clientId,
    clientSecret,
    loginHint: email,
    onAuthUrl: (url) => {
      console.log(pc.dim(`  If the browser doesn't open, visit:\n  ${url}`));
    },
  });

  await setSecret("oauth-refresh", email, tokens.refreshToken);
  const account: OAuthAccountConfig = { kind: "google", email };
  await upsertAccount(account);

  console.log(pc.green(`✓ Authorized ${email}`));
  console.log(pc.dim(`  Try: mmm list`));
}

async function walkGoogleCloudSetup(): Promise<void> {
  console.log("");
  console.log(
    pc.bold("  mmmail will setup your own private local Google OAuth client (~3 min)"),
  );
  console.log("");
  const steps: { title: string; url?: string; detail?: string }[] = [
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

  for (const [i, step] of steps.entries()) {
    console.log(pc.cyan(`  Step ${i + 1}: ${step.title}`));
    if (step.url) console.log(`          ${pc.underline(step.url)}`);
    if (step.detail) console.log(pc.dim(`          ${step.detail}`));
  }
  console.log("");

  await confirm({
    message: "Press enter when you have your Client ID and secret ready",
    default: true,
  });
}
