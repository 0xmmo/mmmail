import pc from "picocolors";
import type { MessageAttachment, MessageBody } from "../providers/index.js";

export function renderMessage(msg: MessageBody): string {
  const lines: string[] = [];
  lines.push(pc.bold(`Subject: ${msg.subject}`));
  lines.push(`From:    ${msg.from}`);
  if (msg.to.length) lines.push(`To:      ${msg.to.join(", ")}`);
  if (msg.cc.length) lines.push(`Cc:      ${msg.cc.join(", ")}`);
  lines.push(`Date:    ${msg.date.toISOString()}`);
  if (msg.attachments.length) {
    lines.push("Attachments:");
    msg.attachments.forEach((a, i) => {
      lines.push(`  ${i + 1}. ${formatAttachment(a)}`);
    });
  }
  lines.push("");
  lines.push(msg.text.trim());
  return lines.join("\n");
}

function formatAttachment(a: MessageAttachment): string {
  const parts = [a.contentType, formatBytes(a.size)];
  if (a.inline) parts.push("inline");
  return `${a.filename} (${parts.join(", ")})`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
