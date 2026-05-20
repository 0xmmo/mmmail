import { promises as fs } from "node:fs";
import pc from "picocolors";
import { resolveAccount, type AccountConfig } from "../config/store.js";
import {
  getProvider,
  type Provider,
  type RuleInput,
} from "../providers/index.js";
import {
  ReauthRequiredError,
  RulesNotSupportedError,
  validateGmailInput,
  validateGraphInput,
  type NormalizedRule,
  type RuleEntry,
} from "../providers/rules.js";

interface BaseOpts {
  account?: string;
  json?: boolean;
}
interface FromJsonOpts extends BaseOpts {
  fromJson: string;
}

export async function runRulesList(opts: BaseOpts): Promise<void> {
  await withProvider(opts.account, async (provider) => {
    const rules = await provider.listRules();
    if (opts.json) {
      console.log(JSON.stringify(rules, null, 2));
      return;
    }
    if (rules.length === 0) {
      console.log(pc.dim("(no rules)"));
      return;
    }
    console.log(renderTable(rules));
  });
}

export async function runRulesShow(id: string, opts: BaseOpts): Promise<void> {
  await withProvider(opts.account, async (provider) => {
    const entry = await provider.getRule(id);
    if (opts.json) {
      console.log(JSON.stringify(entry, null, 2));
      return;
    }
    console.log(renderDetail(entry));
  });
}

export async function runRulesCreate(opts: FromJsonOpts): Promise<void> {
  await withProvider(opts.account, async (provider, account) => {
    const input = await readRuleInput(opts.fromJson, account);
    const created = await provider.createRule(input);
    if (opts.json) {
      console.log(JSON.stringify(created, null, 2));
    } else {
      console.log(pc.green(`✓ created rule ${created.id}`));
      console.log(renderDetail(created));
    }
  });
}

export async function runRulesUpdate(
  id: string,
  opts: FromJsonOpts,
): Promise<void> {
  await withProvider(opts.account, async (provider, account) => {
    const input = await readRuleInput(opts.fromJson, account);
    const updated = await provider.updateRule(id, input);
    if (opts.json) {
      console.log(JSON.stringify(updated, null, 2));
    } else {
      if (updated.id !== id) {
        // Gmail: new ID after recreate
        console.log(
          pc.green(`✓ replaced rule ${id} → new id ${updated.id}`),
        );
      } else {
        console.log(pc.green(`✓ updated rule ${id}`));
      }
      console.log(renderDetail(updated));
    }
  });
}

export async function runRulesDelete(
  id: string,
  opts: BaseOpts,
): Promise<void> {
  await withProvider(opts.account, async (provider) => {
    await provider.deleteRule(id);
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, id }, null, 2));
    } else {
      console.log(pc.green(`✓ deleted rule ${id}`));
    }
  });
}

export async function runRulesEnable(
  id: string,
  enabled: boolean,
  opts: BaseOpts,
): Promise<void> {
  await withProvider(opts.account, async (provider) => {
    const updated = await provider.setRuleEnabled(id, enabled);
    if (opts.json) {
      console.log(JSON.stringify(updated, null, 2));
    } else {
      console.log(
        pc.green(`✓ ${enabled ? "enabled" : "disabled"} rule ${id}`),
      );
    }
  });
}

export async function runRulesReorder(
  csv: string,
  opts: BaseOpts,
): Promise<void> {
  const ids = csv
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    console.error(pc.red("reorder: provide a comma-separated list of rule IDs"));
    process.exit(1);
  }
  await withProvider(opts.account, async (provider) => {
    await provider.setRulesOrder(ids);
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, ids }, null, 2));
    } else {
      console.log(pc.green(`✓ reordered ${ids.length} rule(s)`));
    }
  });
}

// ---------- shared helpers ----------

async function withProvider(
  email: string | undefined,
  fn: (provider: Provider, account: AccountConfig) => Promise<void>,
): Promise<void> {
  const account = await resolveAccount(email);
  if (!account) {
    console.error(pc.red("No account configured. Run `mmm init`."));
    process.exit(1);
  }
  const provider = await getProvider(account);
  try {
    await fn(provider, account);
  } catch (err) {
    if (err instanceof RulesNotSupportedError) {
      console.error(pc.yellow(`Rules not supported: ${err.message}`));
      process.exit(2);
    }
    if (err instanceof ReauthRequiredError) {
      console.error(pc.red(err.message));
      process.exit(3);
    }
    throw err;
  } finally {
    await provider.close();
  }
}

async function readRuleInput(
  source: string,
  account: AccountConfig,
): Promise<RuleInput> {
  if (account.kind === "imap") {
    throw new RulesNotSupportedError(
      `Cannot create rules on an IMAP account (${account.email}).`,
    );
  }
  const text = source === "-" ? await readStdin() : await fs.readFile(source, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`--from-json: invalid JSON (${msg})`);
  }
  if (account.kind === "google") {
    return { kind: "gmail", input: validateGmailInput(parsed) };
  }
  return { kind: "microsoft", input: validateGraphInput(parsed) };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function renderTable(rules: RuleEntry[]): string {
  const rows = rules.map((r) => {
    const n = r.normalized;
    return {
      id: truncate(r.id, 12),
      seq: n.sequence !== undefined ? String(n.sequence) : "-",
      en: n.enabled ? "Y" : "N",
      err: n.hasError ? "Y" : " ",
      name: truncate(n.displayName, 38),
      does: truncate(summarizeDoes(n.does), 36),
    };
  });
  const widths = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    seq: Math.max(3, ...rows.map((r) => r.seq.length)),
    en: 2,
    err: 3,
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    does: Math.max(8, ...rows.map((r) => r.does.length)),
  };
  const fmt = (r: Record<keyof typeof widths, string>): string =>
    `${r.id.padEnd(widths.id)}  ${r.seq.padEnd(widths.seq)}  ${r.en.padEnd(widths.en)}  ${r.err.padEnd(widths.err)}  ${r.name.padEnd(widths.name)}  ${r.does}`;
  const header = fmt({
    id: "ID",
    seq: "Seq",
    en: "On",
    err: "Err",
    name: "Name",
    does: "Action",
  });
  const lines = [pc.bold(header), pc.dim("-".repeat(header.length))];
  for (const r of rows) lines.push(fmt(r));
  return lines.join("\n");
}

function renderDetail(entry: RuleEntry): string {
  const n = entry.normalized;
  const lines: string[] = [];
  lines.push(`${pc.bold("id")}        ${entry.id}`);
  lines.push(`${pc.bold("name")}      ${n.displayName}`);
  if (n.sequence !== undefined) lines.push(`${pc.bold("sequence")}  ${n.sequence}`);
  lines.push(`${pc.bold("enabled")}   ${n.enabled ? "yes" : "no"}`);
  if (n.hasError) lines.push(`${pc.bold("error")}     ${pc.red("yes — rule has a server-side error")}`);
  const m = summarizeMatches(n.matches);
  if (m) lines.push(`${pc.bold("when")}      ${m}`);
  const d = summarizeDoes(n.does);
  if (d) lines.push(`${pc.bold("then")}      ${d}`);
  return lines.join("\n");
}

function summarizeMatches(m: NormalizedRule["matches"]): string {
  const parts: string[] = [];
  if (m.from?.length) parts.push(`from ${m.from.join(", ")}`);
  if (m.to?.length) parts.push(`to ${m.to.join(", ")}`);
  if (m.subject) parts.push(`subject "${m.subject}"`);
  if (m.body) parts.push(`body "${m.body}"`);
  if (m.hasAttachment) parts.push("has attachment");
  if (m.query) parts.push(`query "${m.query}"`);
  return parts.join(" + ");
}

function summarizeDoes(d: NormalizedRule["does"]): string {
  const parts: string[] = [];
  if (d.move) parts.push(`→ ${d.move}`);
  if (d.copy) parts.push(`copy → ${d.copy}`);
  if (d.delete) parts.push("delete");
  if (d.permanentDelete) parts.push("permanent delete");
  if (d.markRead) parts.push("mark read");
  if (d.addLabels?.length) parts.push(`+labels ${d.addLabels.join(",")}`);
  if (d.removeLabels?.length) parts.push(`-labels ${d.removeLabels.join(",")}`);
  if (d.assignCategories?.length)
    parts.push(`category ${d.assignCategories.join(",")}`);
  if (d.forward?.length) parts.push(`forward ${d.forward.join(",")}`);
  if (d.redirect?.length) parts.push(`redirect ${d.redirect.join(",")}`);
  if (d.markImportance) parts.push(`importance ${d.markImportance}`);
  if (d.stopProcessing) parts.push("stop");
  return parts.join(" · ");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
