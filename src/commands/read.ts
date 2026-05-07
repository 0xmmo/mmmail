import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";
import { renderMessage } from "../ui/pager.js";

interface ReadOpts {
  account?: string;
}

export async function runRead(id: string, opts: ReadOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `cmail init`."));
    process.exit(1);
  }
  const provider = await getProvider(account);
  try {
    const msg = await provider.fetch(id);
    console.log(renderMessage(msg));
  } finally {
    await provider.close();
  }
}
