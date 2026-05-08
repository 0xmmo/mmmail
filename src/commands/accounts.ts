import pc from "picocolors";
import {
  readConfig,
  removeAccount,
  setDefaultAccount,
} from "../config/store.js";
import { deleteAllForAccount } from "../auth/secrets.js";

interface AccountsOpts {
  json?: boolean;
}

export async function listAccounts(opts: AccountsOpts = {}): Promise<void> {
  const cfg = await readConfig();
  const entries = Object.values(cfg.accounts);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          defaultAccount: cfg.defaultAccount,
          accounts: entries.map((a) => ({ email: a.email, kind: a.kind })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (entries.length === 0) {
    console.log(pc.dim("No accounts. Run `mmm init`."));
    return;
  }

  for (const a of entries) {
    const isDefault = cfg.defaultAccount === a.email;
    const marker = isDefault ? pc.green("●") : pc.dim("○");
    const label = isDefault
      ? pc.bold(a.email) + pc.green(" (default)")
      : pc.bold(a.email);
    console.log(`  ${marker} ${label}  ${pc.dim(a.kind)}`);
  }
}

export async function deleteAccount(email: string): Promise<void> {
  const removed = await removeAccount(email);
  if (!removed) {
    console.error(pc.red(`No account ${email}`));
    process.exit(1);
  }
  await deleteAllForAccount(email);
  console.log(pc.green(`✓ Removed ${email}`));
}

export async function setDefault(email: string): Promise<void> {
  const ok = await setDefaultAccount(email);
  if (!ok) {
    console.error(pc.red(`No account ${email}`));
    process.exit(1);
  }
  console.log(pc.green(`✓ Default set to ${email}`));
}
