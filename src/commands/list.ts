import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";
import { renderMessageTable } from "../ui/table.js";

interface ListOpts {
  folder?: string;
  limit?: string;
  unread?: boolean;
  account?: string;
}

export async function runList(opts: ListOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }
  const provider = await getProvider(account);
  try {
    const messages = await provider.list({
      folder: opts.folder,
      limit: opts.limit ? Number(opts.limit) : undefined,
      unread: opts.unread,
    });
    console.log(renderMessageTable(messages));
  } finally {
    await provider.close();
  }
}
