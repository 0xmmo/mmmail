import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";
import { renderMessageTable } from "../ui/table.js";

interface SearchOpts {
  folder?: string;
  limit?: string;
  account?: string;
}

export async function runSearch(query: string, opts: SearchOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }
  const provider = await getProvider(account);
  try {
    const messages = await provider.search(query, {
      folder: opts.folder,
      limit: opts.limit ? Number(opts.limit) : undefined,
    });
    console.log(renderMessageTable(messages));
  } finally {
    await provider.close();
  }
}
