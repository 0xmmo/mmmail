import pc from "picocolors";
import type { MessageBody } from "../providers/index.js";

export function renderMessage(msg: MessageBody): string {
  const lines: string[] = [];
  lines.push(pc.bold(`Subject: ${msg.subject}`));
  lines.push(`From:    ${msg.from}`);
  if (msg.to.length) lines.push(`To:      ${msg.to.join(", ")}`);
  if (msg.cc.length) lines.push(`Cc:      ${msg.cc.join(", ")}`);
  lines.push(`Date:    ${msg.date.toISOString()}`);
  lines.push("");
  lines.push(msg.text.trim());
  return lines.join("\n");
}
