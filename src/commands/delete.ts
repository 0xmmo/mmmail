import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";

interface DeleteOpts {
  folder?: string;
  account?: string;
  json?: boolean;
}

export async function runDelete(id: string, opts: DeleteOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }
  const provider = await getProvider(account);
  try {
    await provider.del(id, { folder: opts.folder });
    if (opts.json) {
      console.log(
        JSON.stringify({ ok: true, id, folder: opts.folder ?? "INBOX" }, null, 2),
      );
    } else {
      console.log(pc.green(`✓ Deleted ${id}`));
    }
  } finally {
    await provider.close();
  }
}
