import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";

interface FoldersOpts {
  account?: string;
  json?: boolean;
}

export async function runFolders(opts: FoldersOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }
  const provider = await getProvider(account);
  try {
    const folders = await provider.folders();
    if (opts.json) {
      console.log(JSON.stringify(folders, null, 2));
    } else {
      for (const f of folders) console.log(f);
    }
  } finally {
    await provider.close();
  }
}
