import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";
import { runSend } from "./send.js";

interface ReplyOpts {
  body?: string;
  bodyStdin?: boolean;
  folder?: string;
  account?: string;
  all?: boolean;
  json?: boolean;
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
    original = await provider.fetch(id, { folder: opts.folder });
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

  const references = original.messageId
    ? [...original.references, original.messageId]
    : original.references;

  await runSend({
    to,
    cc,
    subject,
    body,
    bodyStdin: opts.bodyStdin,
    account: opts.account,
    json: opts.json,
    inReplyTo: original.messageId,
    references,
  });
}
