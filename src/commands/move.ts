import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";

interface MoveOpts {
  folder?: string;
  account?: string;
  json?: boolean;
}

export async function runMove(
  id: string,
  dest: string,
  opts: MoveOpts,
): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }
  const provider = await getProvider(account);
  try {
    await provider.move(id, dest, { folder: opts.folder });
    if (opts.json) {
      console.log(
        JSON.stringify({ ok: true, id, dest, from: opts.folder ?? "INBOX" }, null, 2),
      );
    } else {
      console.log(pc.green(`✓ Moved ${id} → ${dest}`));
    }
  } finally {
    await provider.close();
  }
}
