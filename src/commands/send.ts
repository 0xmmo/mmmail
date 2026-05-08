import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import { getProvider } from "../providers/index.js";

interface SendOpts {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  bodyStdin?: boolean;
  account?: string;
  json?: boolean;
  inReplyTo?: string;
  references?: string[];
}

export async function runSend(opts: SendOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }
  if (!opts.subject) {
    console.error(pc.red("--subject is required"));
    process.exit(1);
  }

  let body = opts.body;
  if (opts.bodyStdin || body === "-") {
    body = await readStdin();
  } else if (body === undefined) {
    if (opts.json) {
      console.error(
        pc.red("--body or --body-stdin is required in --json mode (no $EDITOR fallback)"),
      );
      process.exit(1);
    }
    body = await composeInEditor();
  }

  const provider = await getProvider(account);
  try {
    const result = await provider.send({
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      text: body ?? "",
      inReplyTo: opts.inReplyTo,
      references: opts.references,
    });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(pc.green(`✓ Sent to ${opts.to.join(", ")}`));
      if (result.messageId) console.log(pc.dim(`  ${result.messageId}`));
    }
  } finally {
    await provider.close();
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer | string));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function composeInEditor(): Promise<string> {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const dir = mkdtempSync(join(tmpdir(), "mmmail-"));
  const file = join(dir, "message.txt");
  writeFileSync(file, "");
  const res = spawnSync(editor, [file], { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`Editor exited with status ${res.status}`);
  }
  return Promise.resolve(readFileSync(file, "utf8"));
}
