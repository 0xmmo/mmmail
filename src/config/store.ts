import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ProviderKind = "gmail" | "outlook" | "imap";

export interface ImapAccountConfig {
  kind: "imap";
  email: string;
  imap: { host: string; port: number; secure: boolean; user: string };
  smtp: { host: string; port: number; secure: boolean; user: string };
}

export interface OAuthAccountConfig {
  kind: "gmail" | "outlook";
  email: string;
}

export type AccountConfig = ImapAccountConfig | OAuthAccountConfig;

export interface CmailConfig {
  defaultAccount?: string;
  accounts: Record<string, AccountConfig>;
}

const CONFIG_DIR =
  process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "cmail")
    : join(homedir(), ".config", "cmail");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const EMPTY: CmailConfig = { accounts: {} };

export async function readConfig(): Promise<CmailConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as CmailConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY };
    throw err;
  }
}

export async function writeConfig(cfg: CmailConfig): Promise<void> {
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", {
    mode: 0o600,
  });
}

export async function upsertAccount(account: AccountConfig): Promise<void> {
  const cfg = await readConfig();
  cfg.accounts[account.email] = account;
  if (!cfg.defaultAccount) cfg.defaultAccount = account.email;
  await writeConfig(cfg);
}

export async function removeAccount(email: string): Promise<boolean> {
  const cfg = await readConfig();
  if (!(email in cfg.accounts)) return false;
  delete cfg.accounts[email];
  if (cfg.defaultAccount === email) {
    const remaining = Object.keys(cfg.accounts);
    cfg.defaultAccount = remaining[0];
  }
  await writeConfig(cfg);
  return true;
}

export async function resolveAccount(
  email?: string,
): Promise<AccountConfig | undefined> {
  const cfg = await readConfig();
  const target = email ?? cfg.defaultAccount;
  if (!target) return undefined;
  return cfg.accounts[target];
}

export const CONFIG_PATH_FOR_DISPLAY = CONFIG_PATH;
