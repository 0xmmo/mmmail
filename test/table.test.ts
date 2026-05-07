import { describe, expect, it } from "vitest";
import { renderMessageTable } from "../src/ui/table.js";

describe("renderMessageTable", () => {
  it("renders an empty placeholder when there are no messages", () => {
    const out = renderMessageTable([]);
    expect(out).toContain("(no messages)");
  });

  it("renders one row per message and truncates long subjects", () => {
    const out = renderMessageTable([
      {
        id: "42",
        uid: 42,
        from: "alice@example.com",
        to: ["me@example.com"],
        subject: "x".repeat(200),
        date: new Date("2026-01-15T10:00:00Z"),
        flags: { seen: false, flagged: false },
      },
    ]);
    expect(out).toContain("42");
    expect(out).toContain("alice@example.com");
    expect(out).toContain("…");
  });
});
