const HOSTNAME_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function validateEmail(v: string): true | string {
  const s = v.trim();
  if (!s) return "Enter an email address";
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@") || at === s.length - 1) {
    return "Enter a valid email address";
  }
  const domain = s.slice(at + 1);
  if (!isValidHost(domain) || !domain.includes(".")) {
    return "Enter a valid email address";
  }
  return true;
}

export function isValidHost(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  if (s.startsWith("[") && s.endsWith("]")) return s.length > 2; // bracketed IPv6
  if (s === "localhost") return true;
  if (IPV4_RE.test(s)) return true;
  return HOSTNAME_RE.test(s);
}

export function validateHost(v: string): true | string {
  const s = v.trim();
  if (!s) return "Enter a hostname";
  if (/\s/.test(s)) return "Hostname can't contain spaces";
  if (/^[a-z]+:\/\//i.test(s)) return "Drop the URL scheme — just the hostname";
  if (s.includes("/")) return "No path — just the hostname";
  if (s.includes("@")) return "No user info — just the hostname";
  if (!isValidHost(s)) return "Doesn't look like a valid hostname";
  return true;
}

export function validatePort(v: string | number): true | string {
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n)) return "Port must be a whole number";
  if (n < 1 || n > 65535) return "Port must be between 1 and 65535";
  return true;
}

export function validateNonEmpty(label: string) {
  return (v: string): true | string => (v.trim() ? true : `Enter ${label}`);
}

export interface HostPort {
  host: string;
  port?: number;
}

export function parseHostPort(input: string): HostPort | null {
  const s = input.trim();
  if (!s) return null;
  // Bracketed IPv6: [::1]:993
  const ipv6 = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6) {
    return {
      host: `[${ipv6[1]}]`,
      port: ipv6[2] ? Number(ipv6[2]) : undefined,
    };
  }
  // host:port (only if there's exactly one colon and the right side is numeric)
  const colon = s.lastIndexOf(":");
  if (colon > 0 && colon === s.indexOf(":")) {
    const host = s.slice(0, colon);
    const portStr = s.slice(colon + 1);
    if (/^\d+$/.test(portStr)) {
      return { host, port: Number(portStr) };
    }
  }
  return { host: s };
}

export function validateHostPort(
  v: string,
  defaultPort?: number,
): true | string {
  const parsed = parseHostPort(v);
  if (!parsed) return "Enter a hostname";
  const hostOk = validateHost(parsed.host);
  if (hostOk !== true) return hostOk;
  const port = parsed.port ?? defaultPort;
  if (port === undefined) return "Enter a port (e.g. host:993)";
  return validatePort(port);
}

// Standard IMAP/SMTP port → implicit-TLS mapping. STARTTLS is the right
// behavior for the unsecured-but-upgradable ports (143/587/25), but we
// still represent it as `secure: false` in the existing config schema.
export function impliesImplicitTls(
  protocol: "imap" | "smtp",
  port: number,
): boolean | undefined {
  if (protocol === "imap") {
    if (port === 993) return true;
    if (port === 143) return false;
  } else {
    if (port === 465) return true;
    if (port === 587 || port === 25) return false;
  }
  return undefined;
}
