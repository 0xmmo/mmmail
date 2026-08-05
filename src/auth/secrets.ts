import { Entry } from "@napi-rs/keyring";
import pc from "picocolors";

const SERVICE = "mmmail";

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

function writeSecret(key: string, value: string): void {
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

function readSecret(key: string): string | null {
  try {
    return entry(key).getPassword() ?? null;
  } catch (err) {
    // getPassword returns undefined for a missing entry without throwing;
    // a throw means the item exists but this binary can't read it.
    warnUnreadable(key, err);
    return null;
  }
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
    return entry(`${kind}:${email}`).deletePassword();
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
 * Re-save every readable secret so the keychain item is recreated by the
 * current binary. Items created by a different binary (e.g. an older node)
 * carry ACLs that make macOS re-prompt on every read — even after
 * "Always Allow" — and can be silently unreadable. The creator of an item
 * gets silent access, so delete + recreate migrates ownership and stops
 * the prompts. Unreadable items look absent on macOS and are skipped;
 * re-running `mmm init` / `mmm reauth` recreates those.
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
    entry(key).deletePassword();
    entry(key).setPassword(value);
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
