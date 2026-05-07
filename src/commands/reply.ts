import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";
import { runSend } from "./send.js";

interface ReplyOpts {
  body?: string;
  account?: string;
  all?: boolean;
}

export async function runReply(id: string, opts: ReplyOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }

  const provider = await getProvider(account);
  let original;
  try {
    original = await provider.fetch(id);
  } finally {
    await provider.close();
  }

  const subject = original.subject.startsWith("Re:")
    ? original.subject
    : `Re: ${original.subject}`;
  const to = [original.from];
  const cc = opts.all ? original.cc : undefined;

  const quoted = original.text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const body = (opts.body ?? "") + "\n\n" + quoted;

  await runSend({
    to,
    cc,
    subject,
    body,
    account: opts.account,
  });
}
