import pc from "picocolors";
import { readConfig, type AccountConfig } from "../config/store.js";
import { getProvider } from "../providers/index.js";

interface DoctorOpts {
  json?: boolean;
}

interface AccountReport {
  email: string;
  kind: string;
  ok: boolean;
  error?: string;
  inboxCount?: number;
}

export async function runDoctor(opts: DoctorOpts): Promise<void> {
  const cfg = await readConfig();
  const accounts = Object.values(cfg.accounts);
  if (accounts.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ accounts: [] }, null, 2));
    } else {
      console.log(pc.dim("No accounts configured. Run `mmm init`."));
    }
    return;
  }

  const reports: AccountReport[] = [];
  for (const a of accounts) {
    reports.push(await checkAccount(a));
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        { defaultAccount: cfg.defaultAccount, accounts: reports },
        null,
        2,
      ),
    );
    if (reports.some((r) => !r.ok)) process.exitCode = 1;
    return;
  }

  for (const r of reports) {
    const isDefault = r.email === cfg.defaultAccount ? pc.green(" (default)") : "";
    if (r.ok) {
      console.log(
        `  ${pc.green("●")} ${pc.bold(r.email)}  ${pc.dim(r.kind)}${isDefault}  ${pc.dim(`INBOX: ${r.inboxCount} msgs`)}`,
      );
    } else {
      console.log(
        `  ${pc.red("✗")} ${pc.bold(r.email)}  ${pc.dim(r.kind)}${isDefault}`,
      );
      console.log(pc.red(`    ${r.error}`));
    }
  }
  if (reports.some((r) => !r.ok)) process.exitCode = 1;
}

async function checkAccount(account: AccountConfig): Promise<AccountReport> {
  const base: AccountReport = {
    email: account.email,
    kind: account.kind,
    ok: false,
  };
  let provider;
  try {
    provider = await getProvider(account);
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
    return base;
  }
  try {
    const messages = await provider.list({ limit: 1 });
    return { ...base, ok: true, inboxCount: messages.length };
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
    return base;
  } finally {
    try {
      await provider.close();
    } catch {
      /* ignore close errors */
    }
  }
}
