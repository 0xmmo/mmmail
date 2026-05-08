import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";
import { renderMessageTable } from "../ui/table.js";

interface ListOpts {
  folder?: string;
  limit?: string;
  unread?: boolean;
  since?: string;
  before?: string;
  uidAfter?: string;
  account?: string;
  json?: boolean;
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
      since: parseDate(opts.since, "--since"),
      before: parseDate(opts.before, "--before"),
      uidAfter: opts.uidAfter ? Number(opts.uidAfter) : undefined,
    });
    if (opts.json) {
      console.log(JSON.stringify(messages, null, 2));
    } else {
      console.log(renderMessageTable(messages));
    }
  } finally {
    await provider.close();
  }
}

function parseDate(raw: string | undefined, flag: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    console.error(pc.red(`${flag}: '${raw}' is not a valid date (try YYYY-MM-DD or ISO)`));
    process.exit(1);
  }
  return d;
}
