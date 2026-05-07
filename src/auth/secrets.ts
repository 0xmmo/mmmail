import { Entry } from "@napi-rs/keyring";

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

export async function setSecret(
  kind: SecretKind,
  email: string,
  value: string,
): Promise<void> {
  entry(`${kind}:${email}`).setPassword(value);
}

export async function getSecret(
  kind: SecretKind,
  email: string,
): Promise<string | null> {
  try {
    return entry(`${kind}:${email}`).getPassword() ?? null;
  } catch {
    return null;
  }
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
  entry(`${kind}:provider:${provider}`).setPassword(value);
}

export async function getProviderSecret(
  provider: ProviderName,
  kind: "oauth-client-id" | "oauth-client-secret",
): Promise<string | null> {
  try {
    return entry(`${kind}:provider:${provider}`).getPassword() ?? null;
  } catch {
    return null;
  }
}

export async function deleteAllForAccount(email: string): Promise<void> {
  await Promise.all([
    deleteSecret("imap-password", email),
    deleteSecret("smtp-password", email),
    deleteSecret("oauth-refresh", email),
  ]);
}
