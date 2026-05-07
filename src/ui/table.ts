import pc from "picocolors";
import type { MessageSummary } from "../providers/index.js";

export function renderMessageTable(messages: MessageSummary[]): string {
  if (messages.length === 0) return pc.dim("(no messages)");
  const rows = messages.map((m) => {
    const flag = m.flags.seen ? " " : pc.cyan("●");
    const date = formatDate(m.date);
    const from = truncate(m.from, 28);
    const subject = truncate(m.subject, 60);
    return `${flag} ${pc.dim(m.id.padStart(6))} ${pc.gray(date)} ${pc.bold(from.padEnd(28))} ${subject}`;
  });
  return rows.join("\n");
}

function formatDate(d: Date): string {
  const now = new Date();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "2-digit" };
  return new Intl.DateTimeFormat("en-US", opts).format(d).padEnd(15);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
