import { Entry } from "@napi-rs/keyring";

const SERVICE = "mmmail";

export type SecretKind = "imap-password" | "smtp-password" | "oauth-refresh";

function entry(kind: SecretKind, email: string): Entry {
  return new Entry(SERVICE, `${kind}:${email}`);
}

export async function setSecret(
  kind: SecretKind,
  email: string,
  value: string,
): Promise<void> {
  entry(kind, email).setPassword(value);
}

export async function getSecret(
  kind: SecretKind,
  email: string,
): Promise<string | null> {
  try {
    return entry(kind, email).getPassword() ?? null;
  } catch {
    return null;
  }
}

export async function deleteSecret(
  kind: SecretKind,
  email: string,
): Promise<boolean> {
  try {
    return entry(kind, email).deletePassword();
  } catch {
    return false;
  }
}

export async function deleteAllForAccount(email: string): Promise<void> {
  await Promise.all([
    deleteSecret("imap-password", email),
    deleteSecret("smtp-password", email),
    deleteSecret("oauth-refresh", email),
  ]);
}
