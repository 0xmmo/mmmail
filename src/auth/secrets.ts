import { execFileSync } from "node:child_process";
import { Entry } from "@napi-rs/keyring";
import pc from "picocolors";

const SERVICE = "mmmail";

// On macOS a keychain item's ACL trusts the binary that created it. Created
// through @napi-rs/keyring that's node, which Homebrew ships ad-hoc signed, so
// every node upgrade looks like a new app and re-prompts for every item.
// Items created by Apple's /usr/bin/security trust that binary instead, whose
// identity survives node upgrades, so reads through it are silent for good.
// Those items carry MAC_MARKER in their comment and store the value
// base64-encoded (`-w` prints non-ASCII passwords as hex otherwise).
const SECURITY = "/usr/bin/security";
const MAC_MARKER = "mmmail:security-v1";
const useSecurityCli = process.platform === "darwin";

export type SecretKind =
  | "imap-password"
  | "smtp-password"
  | "oauth-refresh"
  | "oauth-client-id"
  | "oauth-client-secret";

export type ProviderName = "google" | "microsoft";

function entry(key: string): Entry {
  return new Entry(SERVICE, key);
}

const warnedUnreadable = new Set<string>();

function warnUnreadable(key: string, err: unknown): void {
  if (warnedUnreadable.has(key)) return;
  warnedUnreadable.add(key);
  const detail = err instanceof Error ? err.message : String(err);
  console.error(
    pc.yellow("warning: ") +
      `keychain denied access to "${key}" (${detail}) — the item exists but this binary is not authorized to read it, so it is treated as missing. ` +
      "Re-saving it (`mmm init` / `mmm reauth`) replaces the item and stops the prompts.",
  );
}

function keyringWrite(key: string, value: string): void {
  try {
    entry(key).setPassword(value);
  } catch {
    // A stale item this binary can't read (ACL bound to a different binary,
    // e.g. an older node) makes setPassword fail with "already exists".
    // Deleting works regardless of the ACL, so replace the item outright.
    entry(key).deletePassword();
    entry(key).setPassword(value);
  }
}

function keyringRead(key: string): string | null {
  try {
    return entry(key).getPassword() ?? null;
  } catch (err) {
    // getPassword returns undefined for a missing entry without throwing;
    // a throw means the item exists but this binary can't read it.
    warnUnreadable(key, err);
    return null;
  }
}

function security(args: string[], input?: string): string {
  return execFileSync(SECURITY, args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// exit 44 = errSecItemNotFound
function isNotFound(err: unknown): boolean {
  return (err as { status?: number }).status === 44;
}

/**
 * The item's comment, read from its attributes only, so it never prompts.
 * undefined = no such item, null = item without a comment.
 */
function macComment(key: string): string | null | undefined {
  let out: string;
  try {
    out = security(["find-generic-password", "-s", SERVICE, "-a", key]);
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
  return out.match(/"icmt"<blob>="(.*)"$/m)?.[1] ?? null;
}

function macWrite(key: string, value: string): void {
  if (!/^[\w.@:+-]+$/.test(key)) {
    throw new Error(`unsupported keychain account name: ${key}`);
  }
  macDelete(key);
  // Through `security -i` on stdin so the secret never shows up in argv/ps,
  // and hex (-X) so no value needs quoting.
  const hex = Buffer.from(Buffer.from(value, "utf8").toString("base64")).toString("hex");
  security(
    ["-i"],
    `add-generic-password -s ${SERVICE} -a ${key} -j ${MAC_MARKER} -X ${hex}\n`,
  );
  // Interactive mode exits 0 even when a command fails, so check the result.
  if (macComment(key) !== MAC_MARKER) {
    throw new Error(`failed to save keychain item "${key}"`);
  }
}

function macRead(key: string): string | null {
  const comment = macComment(key);
  if (comment === undefined) return null;
  if (comment === MAC_MARKER) {
    const b64 = security([
      "find-generic-password",
      "-s",
      SERVICE,
      "-a",
      key,
      "-w",
    ]).trim();
    return Buffer.from(b64, "base64").toString("utf8");
  }
  // A legacy item owned by node: read it through the keyring one last time
  // (this may prompt) and recreate it under /usr/bin/security.
  const value = keyringRead(key);
  if (value != null) macWrite(key, value);
  return value;
}

function macDelete(key: string): boolean {
  const comment = macComment(key);
  if (comment === undefined) return false;
  if (comment !== MAC_MARKER) return entry(key).deletePassword();
  try {
    security(["delete-generic-password", "-s", SERVICE, "-a", key]);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

function writeSecret(key: string, value: string): void {
  if (useSecurityCli) macWrite(key, value);
  else keyringWrite(key, value);
}

function readSecret(key: string): string | null {
  return useSecurityCli ? macRead(key) : keyringRead(key);
}

function removeSecret(key: string): boolean {
  return useSecurityCli ? macDelete(key) : entry(key).deletePassword();
}

export async function setSecret(
  kind: SecretKind,
  email: string,
  value: string,
): Promise<void> {
  writeSecret(`${kind}:${email}`, value);
}

export async function getSecret(
  kind: SecretKind,
  email: string,
): Promise<string | null> {
  return readSecret(`${kind}:${email}`);
}

export async function deleteSecret(
  kind: SecretKind,
  email: string,
): Promise<boolean> {
  try {
    return removeSecret(`${kind}:${email}`);
  } catch {
    return false;
  }
}

export async function setProviderSecret(
  provider: ProviderName,
  kind: "oauth-client-id" | "oauth-client-secret",
  value: string,
): Promise<void> {
  writeSecret(`${kind}:provider:${provider}`, value);
}

export async function getProviderSecret(
  provider: ProviderName,
  kind: "oauth-client-id" | "oauth-client-secret",
): Promise<string | null> {
  return readSecret(`${kind}:provider:${provider}`);
}

const ALL_KINDS: SecretKind[] = [
  "imap-password",
  "smtp-password",
  "oauth-refresh",
  "oauth-client-id",
  "oauth-client-secret",
];
const ALL_PROVIDERS: ProviderName[] = ["google", "microsoft"];

/**
 * Re-save every readable secret. On macOS this moves legacy node-owned items
 * under /usr/bin/security in one pass (reads already do it one item at a
 * time), so they stop prompting after node upgrades. Unreadable items are
 * skipped; re-running `mmm init` / `mmm reauth` recreates those.
 */
export async function rehomeSecrets(
  emails: string[],
): Promise<{ rehomed: string[]; skipped: string[] }> {
  const rehomed: string[] = [];
  const skipped: string[] = [];
  const keys = [
    ...emails.flatMap((email) => ALL_KINDS.map((kind) => `${kind}:${email}`)),
    ...ALL_PROVIDERS.flatMap((provider) =>
      ["oauth-client-id", "oauth-client-secret"].map(
        (kind) => `${kind}:provider:${provider}`,
      ),
    ),
  ];
  for (const key of keys) {
    const value = readSecret(key);
    if (value == null) {
      skipped.push(key);
      continue;
    }
    writeSecret(key, value);
    rehomed.push(key);
  }
  return { rehomed, skipped };
}

export async function deleteAllForAccount(email: string): Promise<void> {
  await Promise.all([
    deleteSecret("imap-password", email),
    deleteSecret("smtp-password", email),
    deleteSecret("oauth-refresh", email),
    deleteSecret("oauth-client-id", email),
  ]);
}
