import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";
import type { SetFlagsInput } from "../providers/index.js";

interface MarkOpts {
  read?: boolean;
  unread?: boolean;
  flagged?: boolean;
  unflagged?: boolean;
  folder?: string;
  account?: string;
  json?: boolean;
}

export async function runMark(id: string, opts: MarkOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }

  const flags: SetFlagsInput = {};
  if (opts.read) flags.seen = true;
  if (opts.unread) flags.seen = false;
  if (opts.flagged) flags.flagged = true;
  if (opts.unflagged) flags.flagged = false;
  if (Object.keys(flags).length === 0) {
    console.error(
      pc.red(
        "Specify at least one of --read, --unread, --flagged, --unflagged",
      ),
    );
    process.exit(1);
  }

  const provider = await getProvider(account);
  try {
    await provider.setFlags(id, flags, { folder: opts.folder });
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, id, flags }, null, 2));
    } else {
      console.log(pc.green(`✓ Marked ${id}: ${describe(flags)}`));
    }
  } finally {
    await provider.close();
  }
}

function describe(flags: SetFlagsInput): string {
  const parts: string[] = [];
  if (flags.seen === true) parts.push("read");
  if (flags.seen === false) parts.push("unread");
  if (flags.flagged === true) parts.push("flagged");
  if (flags.flagged === false) parts.push("unflagged");
  return parts.join(", ");
}
