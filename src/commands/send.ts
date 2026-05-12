import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import type { SendAttachment } from "../providers/index.js";
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
  attach?: string[];
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

  let attachments: SendAttachment[] | undefined;
  try {
    attachments = resolveAttachments(opts.attach);
  } catch (err) {
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
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
      attachments,
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

export function resolveAttachments(paths: string[] | undefined): SendAttachment[] | undefined {
  if (!paths || paths.length === 0) return undefined;
  const missing: string[] = [];
  const out: SendAttachment[] = [];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
    try {
      accessSync(abs, constants.R_OK);
      const stat = statSync(abs);
      if (!stat.isFile()) {
        missing.push(`${p} (not a regular file)`);
        continue;
      }
    } catch {
      missing.push(p);
      continue;
    }
    out.push({ filename: basename(abs), path: abs });
  }
  if (missing.length) {
    throw new Error(`attachment(s) not readable: ${missing.join(", ")}`);
  }
  return out;
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
