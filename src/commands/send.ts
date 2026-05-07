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
  account?: string;
}

export async function runSend(opts: SendOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `cmail init`."));
    process.exit(1);
  }
  if (!opts.subject) {
    console.error(pc.red("--subject is required"));
    process.exit(1);
  }

  let body = opts.body;
  if (body === "-") {
    body = await readStdin();
  } else if (body === undefined) {
    body = await composeInEditor();
  }

  const provider = await getProvider(account);
  try {
    await provider.send({
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      text: body ?? "",
    });
    console.log(pc.green(`✓ Sent to ${opts.to.join(", ")}`));
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
  const dir = mkdtempSync(join(tmpdir(), "cmail-"));
  const file = join(dir, "message.txt");
  writeFileSync(file, "");
  const res = spawnSync(editor, [file], { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`Editor exited with status ${res.status}`);
  }
  return Promise.resolve(readFileSync(file, "utf8"));
}
