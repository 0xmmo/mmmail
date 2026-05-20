import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import pc from "picocolors";
import { resolveAccount } from "../config/store.js";
import type { MessageAttachment, MessageBody } from "../providers/index.js";
import { getProvider } from "../providers/index.js";
import { renderMessage } from "../ui/pager.js";

interface ReadOpts {
  folder?: string;
  account?: string;
  json?: boolean;
  includeHtml?: boolean;
  saveAttachments?: string;
  batch?: string;
}

interface SavedAttachment extends MessageAttachment {
  savedPath?: string;
}

export async function runRead(id: string | undefined, opts: ReadOpts): Promise<void> {
  const account = await resolveAccount(opts.account);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }

  if (opts.batch !== undefined) {
    if (id) {
      console.error(pc.red("Pass UIDs via --batch OR a positional id, not both."));
      process.exit(1);
    }
    const ids = await readBatchIds(opts.batch);
    if (ids.length === 0) {
      console.error(pc.red("--batch: no UIDs provided."));
      process.exit(1);
    }
    if (opts.saveAttachments) {
      console.error(pc.red("--save-attachments isn't supported with --batch."));
      process.exit(1);
    }
    const provider = await getProvider(account);
    try {
      const msgs = await provider.fetchMany(ids, { folder: opts.folder });
      if (!opts.includeHtml) for (const m of msgs) m.html = undefined;
      // JSON is the only sensible output for batch.
      console.log(JSON.stringify(msgs, null, 2));
    } finally {
      await provider.close();
    }
    return;
  }

  if (!id) {
    console.error(pc.red("missing message id (or pass --batch <uid,uid,...> / --batch -)"));
    process.exit(1);
  }

  const provider = await getProvider(account);
  try {
    const msg = await provider.fetch(id, {
      folder: opts.folder,
      withAttachmentData: Boolean(opts.saveAttachments),
    });
    if (!opts.includeHtml) msg.html = undefined;

    let saved: SavedAttachment[] | undefined;
    if (opts.saveAttachments) {
      saved = saveAttachments(msg.attachments, opts.saveAttachments);
      msg.attachments = saved.map((a) => {
        const { content, ...rest } = a;
        void content;
        return rest as MessageAttachment;
      });
    }

    if (opts.json) {
      console.log(JSON.stringify(msg, null, 2));
    } else {
      console.log(renderMessage(msg));
      if (saved && saved.length) {
        console.log("");
        for (const a of saved) {
          if (a.savedPath) console.log(pc.green(`✓ saved ${a.savedPath}`));
        }
      }
    }
  } finally {
    await provider.close();
  }
}

async function readBatchIds(value: string): Promise<string[]> {
  const raw = value === "-" ? await readStdin() : value;
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function saveAttachments(
  attachments: MessageAttachment[],
  dir: string,
): SavedAttachment[] {
  const absDir = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
  mkdirSync(absDir, { recursive: true });
  const used = new Set<string>();
  const out: SavedAttachment[] = [];
  for (const [i, a] of attachments.entries()) {
    const result: SavedAttachment = { ...a };
    if (!a.content) {
      out.push(result);
      continue;
    }
    const safe = sanitizeFilename(a.filename, i);
    const final = dedupeFilename(safe, used, absDir);
    used.add(final);
    const path = join(absDir, final);
    writeFileSync(path, a.content);
    result.savedPath = path;
    out.push(result);
  }
  return out;
}

export function sanitizeFilename(name: string, index: number): string {
  let cleaned = name.replace(/\0/g, "").replace(/[/\\]/g, "_");
  cleaned = cleaned.replace(/^[._]+/, "");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return `attachment-${index + 1}`;
  }
  return cleaned;
}

function dedupeFilename(name: string, used: Set<string>, dir: string): string {
  const taken = (n: string) => used.has(n) || existsSync(join(dir, n));
  if (!taken(name)) return name;
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 10000; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}
