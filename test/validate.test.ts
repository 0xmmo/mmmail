import { describe, expect, it } from "vitest";
import {
  impliesImplicitTls,
  parseHostPort,
  validateEmail,
  validateHost,
  validateHostPort,
  validatePort,
} from "../src/auth/validate.js";

describe("validateEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(validateEmail("mo@olly.bot")).toBe(true);
    expect(validateEmail("a.b+c@example.co.uk")).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(validateEmail("  user@example.com  ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(typeof validateEmail("")).toBe("string");
    expect(typeof validateEmail("nope")).toBe("string");
    expect(typeof validateEmail("a@b")).toBe("string"); // no TLD
    expect(typeof validateEmail("a@@b.com")).toBe("string");
    expect(typeof validateEmail("a@.com")).toBe("string");
  });
});

describe("validateHost", () => {
  it("accepts hostnames, localhost, and IPv4", () => {
    expect(validateHost("imap.example.com")).toBe(true);
    expect(validateHost("localhost")).toBe(true);
    expect(validateHost("192.168.1.1")).toBe(true);
    expect(validateHost("[::1]")).toBe(true);
  });

  it("rejects empty, schemes, paths, and userinfo", () => {
    expect(typeof validateHost("")).toBe("string");
    expect(typeof validateHost("https://imap.example.com")).toBe("string");
    expect(typeof validateHost("imap.example.com/path")).toBe("string");
    expect(typeof validateHost("user@imap.example.com")).toBe("string");
    expect(typeof validateHost("imap example.com")).toBe("string");
  });
});

describe("validatePort", () => {
  it("accepts integers in 1..65535", () => {
    expect(validatePort(993)).toBe(true);
    expect(validatePort("587")).toBe(true);
    expect(validatePort(1)).toBe(true);
    expect(validatePort(65535)).toBe(true);
  });

  it("rejects out-of-range and non-integers", () => {
    expect(typeof validatePort(0)).toBe("string");
    expect(typeof validatePort(99999)).toBe("string");
    expect(typeof validatePort("abc")).toBe("string");
    expect(typeof validatePort("12.5")).toBe("string");
  });
});

describe("parseHostPort", () => {
  it("parses host alone", () => {
    expect(parseHostPort("imap.example.com")).toEqual({ host: "imap.example.com" });
  });

  it("parses host:port", () => {
    expect(parseHostPort("imap.example.com:993")).toEqual({
      host: "imap.example.com",
      port: 993,
    });
  });

  it("parses bracketed IPv6 with port", () => {
    expect(parseHostPort("[::1]:993")).toEqual({ host: "[::1]", port: 993 });
  });

  it("returns null for empty input", () => {
    expect(parseHostPort("")).toBeNull();
  });

  it("does not split on a colon followed by non-numeric", () => {
    expect(parseHostPort("imap.example.com:abc")).toEqual({
      host: "imap.example.com:abc",
    });
  });
});

describe("validateHostPort", () => {
  it("accepts host or host:port", () => {
    expect(validateHostPort("imap.example.com:993")).toBe(true);
    expect(validateHostPort("imap.example.com", 993)).toBe(true);
  });

  it("rejects host without port when no default", () => {
    expect(typeof validateHostPort("imap.example.com")).toBe("string");
  });

  it("rejects malformed input", () => {
    expect(typeof validateHostPort("https://imap.example.com:993")).toBe("string");
    expect(typeof validateHostPort("")).toBe("string");
    expect(typeof validateHostPort("imap.example.com:99999")).toBe("string");
  });
});

describe("impliesImplicitTls", () => {
  it("maps standard IMAP ports", () => {
    expect(impliesImplicitTls("imap", 993)).toBe(true);
    expect(impliesImplicitTls("imap", 143)).toBe(false);
  });

  it("maps standard SMTP ports", () => {
    expect(impliesImplicitTls("smtp", 465)).toBe(true);
    expect(impliesImplicitTls("smtp", 587)).toBe(false);
    expect(impliesImplicitTls("smtp", 25)).toBe(false);
  });

  it("returns undefined for non-standard ports", () => {
    expect(impliesImplicitTls("imap", 1234)).toBeUndefined();
    expect(impliesImplicitTls("smtp", 2525)).toBeUndefined();
  });
});
