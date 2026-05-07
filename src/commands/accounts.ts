import pc from "picocolors";
import { readConfig, removeAccount } from "../config/store.js";
import { deleteAllForAccount } from "../auth/secrets.js";

export async function listAccounts(): Promise<void> {
  const cfg = await readConfig();
  const entries = Object.values(cfg.accounts);
  if (entries.length === 0) {
    console.log(pc.dim("No accounts. Run `mmm init`."));
    return;
  }
  for (const a of entries) {
    const def = cfg.defaultAccount === a.email ? pc.green(" (default)") : "";
    console.log(`${pc.bold(a.email)}  ${pc.dim(a.kind)}${def}`);
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
