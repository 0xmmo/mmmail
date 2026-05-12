import { resolveMx, resolveSrv } from "node:dns/promises";
import type { ProviderPreset } from "../commands/init.js";

const DEFAULT_TIMEOUT_MS = 4000;

export interface DiscoverResult {
  preset: ProviderPreset;
  source: "ispdb" | "autoconfig" | "mx" | "srv";
  displayName?: string;
}

interface MxProvider {
  match: (mx: string) => boolean;
  displayName: string;
  preset: ProviderPreset;
}

const MX_PROVIDERS: MxProvider[] = [
  {
    match: (mx) => mx.endsWith(".privateemail.com") || mx === "privateemail.com",
    displayName: "Namecheap PrivateEmail",
    preset: {
      imap: { host: "mail.privateemail.com", port: 993, secure: true },
      smtp: { host: "mail.privateemail.com", port: 465, secure: true },
    },
  },
  {
    match: (mx) => mx.endsWith(".messagingengine.com"),
    displayName: "Fastmail",
    preset: {
      imap: { host: "imap.fastmail.com", port: 993, secure: true },
      smtp: { host: "smtp.fastmail.com", port: 465, secure: true },
    },
  },
  {
    match: (mx) =>
      mx.endsWith(".mail.protection.outlook.com") ||
      mx.endsWith(".protection.outlook.com"),
    displayName: "Microsoft 365",
    preset: {
      imap: { host: "outlook.office365.com", port: 993, secure: true },
      smtp: { host: "smtp.office365.com", port: 587, secure: false },
    },
  },
  {
    match: (mx) =>
      mx.endsWith(".google.com") ||
      mx.endsWith(".googlemail.com") ||
      mx.endsWith(".aspmx.l.google.com") ||
      mx === "aspmx.l.google.com",
    displayName: "Google Workspace",
    preset: {
      imap: { host: "imap.gmail.com", port: 993, secure: true },
      smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    },
  },
  {
    match: (mx) => mx.endsWith(".zoho.com") || mx.endsWith(".zohomail.com"),
    displayName: "Zoho Mail",
    preset: {
      imap: { host: "imap.zoho.com", port: 993, secure: true },
      smtp: { host: "smtp.zoho.com", port: 465, secure: true },
    },
  },
  {
    match: (mx) => mx.endsWith(".yandex.net") || mx.endsWith(".yandex.ru"),
    displayName: "Yandex Mail",
    preset: {
      imap: { host: "imap.yandex.com", port: 993, secure: true },
      smtp: { host: "smtp.yandex.com", port: 465, secure: true },
    },
  },
  {
    match: (mx) => mx.endsWith(".mail.me.com") || mx.endsWith(".icloud.com"),
    displayName: "iCloud Mail",
    preset: {
      imap: { host: "imap.mail.me.com", port: 993, secure: true },
      smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    },
  },
];

interface ServerSpec {
  host: string;
  port: number;
  secure: boolean;
}

interface AutoconfigResult {
  imap: ServerSpec;
  smtp: ServerSpec;
  displayName?: string;
}

export async function discoverMailServers(
  email: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<DiscoverResult | null> {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  try {
    const [ispdb, domainCfg, mx, srv] = await Promise.allSettled([
      fetchIspdb(domain, ctrl.signal),
      fetchDomainAutoconfig(domain, email, ctrl.signal),
      lookupByMx(domain),
      fetchSrv(domain),
    ]);

    const ispdbVal = ispdb.status === "fulfilled" ? ispdb.value : null;
    if (ispdbVal) {
      return { preset: toPreset(ispdbVal), source: "ispdb", displayName: ispdbVal.displayName };
    }
    const domainVal = domainCfg.status === "fulfilled" ? domainCfg.value : null;
    if (domainVal) {
      return { preset: toPreset(domainVal), source: "autoconfig", displayName: domainVal.displayName };
    }
    const mxVal = mx.status === "fulfilled" ? mx.value : null;
    if (mxVal) {
      return { preset: mxVal.preset, source: "mx", displayName: mxVal.displayName };
    }
    const srvVal = srv.status === "fulfilled" ? srv.value : null;
    if (srvVal) {
      return { preset: toPreset(srvVal), source: "srv" };
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookupByMx(domain: string): Promise<{ preset: ProviderPreset; displayName: string } | null> {
  let records: { exchange: string; priority: number }[];
  try {
    records = await resolveMx(domain);
  } catch {
    return null;
  }
  if (records.length === 0) return null;
  records.sort((a, b) => a.priority - b.priority);
  for (const rec of records) {
    const hit = matchMxProvider(rec.exchange);
    if (hit) return hit;
  }
  return null;
}

export function matchMxProvider(
  exchange: string,
): { preset: ProviderPreset; displayName: string } | null {
  const host = exchange.toLowerCase().replace(/\.$/, "");
  for (const provider of MX_PROVIDERS) {
    if (provider.match(host)) {
      return { preset: provider.preset, displayName: provider.displayName };
    }
  }
  return null;
}

function toPreset(r: AutoconfigResult): ProviderPreset {
  return { imap: r.imap, smtp: r.smtp };
}

async function fetchIspdb(domain: string, signal: AbortSignal): Promise<AutoconfigResult | null> {
  const url = `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`;
  return fetchAndParse(url, signal);
}

async function fetchDomainAutoconfig(
  domain: string,
  email: string,
  signal: AbortSignal,
): Promise<AutoconfigResult | null> {
  const q = `?emailaddress=${encodeURIComponent(email)}`;
  const urls = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml${q}`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml${q}`,
  ];
  for (const url of urls) {
    const r = await fetchAndParse(url, signal).catch(() => null);
    if (r) return r;
  }
  return null;
}

async function fetchAndParse(
  url: string,
  signal: AbortSignal,
): Promise<AutoconfigResult | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal, redirect: "follow" });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const xml = await res.text();
  return parseAutoconfigXml(xml);
}

export function parseAutoconfigXml(xml: string): AutoconfigResult | null {
  const incoming = pickServer(xml, "incomingServer", "imap");
  const outgoing = pickServer(xml, "outgoingServer", "smtp");
  if (!incoming || !outgoing) return null;
  const displayName = firstTag(xml, "displayName") ?? undefined;
  return { imap: incoming, smtp: outgoing, displayName };
}

function pickServer(
  xml: string,
  tag: "incomingServer" | "outgoingServer",
  type: "imap" | "smtp",
): ServerSpec | null {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\btype="${type}"[^>]*>([\\s\\S]*?)</${tag}>`,
    "gi",
  );
  let match: RegExpExecArray | null;
  const candidates: ServerSpec[] = [];
  while ((match = re.exec(xml))) {
    const inner = match[1]!;
    const host = firstTag(inner, "hostname");
    const portStr = firstTag(inner, "port");
    const socketType = firstTag(inner, "socketType");
    if (!host || !portStr) continue;
    const port = Number(portStr);
    if (!Number.isFinite(port)) continue;
    const secure = (socketType ?? "").toUpperCase() === "SSL";
    candidates.push({ host: host.trim(), port, secure });
  }
  if (candidates.length === 0) return null;
  // Prefer implicit-TLS variant if multiple are listed.
  return candidates.find((c) => c.secure) ?? candidates[0]!;
}

function firstTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeXmlEntities(m[1]!) : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

async function fetchSrv(domain: string): Promise<AutoconfigResult | null> {
  const [imapsRec, imapRec, submissionsRec, submissionRec] = await Promise.all([
    safeSrv(`_imaps._tcp.${domain}`),
    safeSrv(`_imap._tcp.${domain}`),
    safeSrv(`_submissions._tcp.${domain}`),
    safeSrv(`_submission._tcp.${domain}`),
  ]);

  const imap = pickSrv(imapsRec, true) ?? pickSrv(imapRec, false);
  const smtp = pickSrv(submissionsRec, true) ?? pickSrv(submissionRec, false);
  if (!imap || !smtp) return null;
  return { imap, smtp };
}

interface SrvRecord {
  name: string;
  port: number;
  priority: number;
  weight: number;
}

async function safeSrv(name: string): Promise<SrvRecord[]> {
  try {
    return await resolveSrv(name);
  } catch {
    return [];
  }
}

function pickSrv(records: SrvRecord[], secure: boolean): ServerSpec | null {
  const live = records.filter((r) => r.name && r.name !== ".");
  if (live.length === 0) return null;
  live.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
  const top = live[0]!;
  return { host: top.name.replace(/\.$/, ""), port: top.port, secure };
}
