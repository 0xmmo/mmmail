import { input, password, select } from "@inquirer/prompts";
import pc from "picocolors";
import {
  upsertAccount,
  type ImapAccountConfig,
} from "../config/store.js";
import { setSecret } from "../auth/secrets.js";

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
      { name: "Generic IMAP/SMTP (app password)", value: "imap" },
      { name: "Gmail (OAuth) — coming soon", value: "gmail", disabled: true },
      { name: "Outlook (OAuth) — coming soon", value: "outlook", disabled: true },
    ],
  });

  if (kind !== "imap") {
    console.error(pc.yellow("Only generic IMAP is supported in this release."));
    process.exit(1);
  }

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
  console.log(pc.dim(`  Try: cmail list`));
}
