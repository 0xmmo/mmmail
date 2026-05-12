import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAttachments } from "../src/commands/send.js";
import { saveAttachments, sanitizeFilename } from "../src/commands/read.js";
import { formatBytes, renderMessage } from "../src/ui/pager.js";
import type { MessageAttachment, MessageBody } from "../src/providers/index.js";

function makeBody(attachments: MessageAttachment[]): MessageBody {
  return {
    id: "1",
    from: "alice@example.com",
    to: ["me@example.com"],
    cc: [],
    subject: "hi",
    date: new Date("2026-01-15T10:00:00Z"),
    text: "hello world",
    references: [],
    attachments,
  };
}

describe("resolveAttachments", () => {
  it("returns undefined for empty/missing input", () => {
    expect(resolveAttachments(undefined)).toBeUndefined();
    expect(resolveAttachments([])).toBeUndefined();
  });

  it("resolves paths to absolute and infers filename from basename", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmm-att-"));
    const a = join(dir, "a.txt");
    writeFileSync(a, "hi");
    const out = resolveAttachments([a]);
    expect(out).toEqual([{ filename: "a.txt", path: a }]);
  });

  it("throws when a path doesn't exist", () => {
    expect(() => resolveAttachments(["/nonexistent/path/xyz"])).toThrow(/not readable/);
  });
});

describe("sanitizeFilename", () => {
  it("strips path separators", () => {
    expect(sanitizeFilename("../etc/passwd", 0)).toBe("etc_passwd");
    expect(sanitizeFilename("a/b\\c.txt", 0)).toBe("a_b_c.txt");
  });

  it("falls back when empty after sanitization", () => {
    expect(sanitizeFilename("", 0)).toBe("attachment-1");
    expect(sanitizeFilename(".", 2)).toBe("attachment-3");
    expect(sanitizeFilename("..", 0)).toBe("attachment-1");
  });

  it("strips leading dots so files aren't hidden", () => {
    expect(sanitizeFilename(".hidden", 0)).toBe("hidden");
  });
});

describe("saveAttachments", () => {
  it("writes content to disk and returns savedPath", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmm-save-"));
    const out = saveAttachments(
      [
        {
          filename: "report.pdf",
          contentType: "application/pdf",
          size: 4,
          inline: false,
          content: Buffer.from("PDF1"),
        },
      ],
      dir,
    );
    expect(out[0].savedPath).toBe(join(dir, "report.pdf"));
    expect(readFileSync(out[0].savedPath as string, "utf8")).toBe("PDF1");
  });

  it("de-dups colliding filenames", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmm-dup-"));
    const out = saveAttachments(
      [
        { filename: "a.txt", contentType: "text/plain", size: 1, inline: false, content: Buffer.from("1") },
        { filename: "a.txt", contentType: "text/plain", size: 1, inline: false, content: Buffer.from("2") },
        { filename: "a.txt", contentType: "text/plain", size: 1, inline: false, content: Buffer.from("3") },
      ],
      dir,
    );
    expect(out.map((a) => a.savedPath)).toEqual([
      join(dir, "a.txt"),
      join(dir, "a-1.txt"),
      join(dir, "a-2.txt"),
    ]);
    expect(readFileSync(out[1].savedPath as string, "utf8")).toBe("2");
  });

  it("skips entries with no content (metadata-only)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mmm-skip-"));
    const out = saveAttachments(
      [{ filename: "x.bin", contentType: "application/octet-stream", size: 0, inline: false }],
      dir,
    );
    expect(out[0].savedPath).toBeUndefined();
  });
});

describe("formatBytes", () => {
  it("formats across units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1024 * 1024 * 3)).toBe("3.0 MB");
  });
});

describe("renderMessage with attachments", () => {
  it("renders an Attachments: block when present", () => {
    const out = renderMessage(
      makeBody([
        { filename: "report.pdf", contentType: "application/pdf", size: 124_000, inline: false },
        { filename: "logo.png", contentType: "image/png", size: 8000, inline: true },
      ]),
    );
    expect(out).toContain("Attachments:");
    expect(out).toContain("1. report.pdf (application/pdf, 121.1 KB)");
    expect(out).toContain("2. logo.png (image/png, 7.8 KB, inline)");
  });

  it("omits the block when there are no attachments", () => {
    const out = renderMessage(makeBody([]));
    expect(out).not.toContain("Attachments:");
  });
});
