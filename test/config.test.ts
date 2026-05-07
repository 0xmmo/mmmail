import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "cmail-test-"));
  process.env.XDG_CONFIG_HOME = tmp;
});

afterAll(() => {
  delete process.env.XDG_CONFIG_HOME;
});

describe("config store", () => {
  it("returns an empty config when none exists", async () => {
    const { readConfig } = await import("../src/config/store.js");
    const cfg = await readConfig();
    expect(cfg.accounts).toEqual({});
    expect(cfg.defaultAccount).toBeUndefined();
  });

  it("upserts and resolves accounts; first becomes default", async () => {
    const { upsertAccount, readConfig, resolveAccount } = await import(
      "../src/config/store.js"
    );
    await upsertAccount({
      kind: "imap",
      email: "a@example.com",
      imap: { host: "imap.example.com", port: 993, secure: true, user: "a@example.com" },
      smtp: { host: "smtp.example.com", port: 465, secure: true, user: "a@example.com" },
    });
    await upsertAccount({
      kind: "imap",
      email: "b@example.com",
      imap: { host: "imap.example.com", port: 993, secure: true, user: "b@example.com" },
      smtp: { host: "smtp.example.com", port: 465, secure: true, user: "b@example.com" },
    });

    const cfg = await readConfig();
    expect(Object.keys(cfg.accounts).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(cfg.defaultAccount).toBe("a@example.com");

    const resolved = await resolveAccount();
    expect(resolved?.email).toBe("a@example.com");

    const explicit = await resolveAccount("b@example.com");
    expect(explicit?.email).toBe("b@example.com");
  });

  it("removes an account and reassigns the default", async () => {
    const { removeAccount, readConfig } = await import("../src/config/store.js");
    const ok = await removeAccount("a@example.com");
    expect(ok).toBe(true);
    const cfg = await readConfig();
    expect(cfg.defaultAccount).toBe("b@example.com");
  });
});
