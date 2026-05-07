import keytar from "keytar";

const SERVICE = "cmail";

export type SecretKind = "imap-password" | "smtp-password" | "oauth-refresh";

function key(kind: SecretKind, email: string): string {
  return `${kind}:${email}`;
}

export async function setSecret(
  kind: SecretKind,
  email: string,
  value: string,
): Promise<void> {
  await keytar.setPassword(SERVICE, key(kind, email), value);
}

export async function getSecret(
  kind: SecretKind,
  email: string,
): Promise<string | null> {
  return keytar.getPassword(SERVICE, key(kind, email));
}

export async function deleteSecret(
  kind: SecretKind,
  email: string,
): Promise<boolean> {
  return keytar.deletePassword(SERVICE, key(kind, email));
}

export async function deleteAllForAccount(email: string): Promise<void> {
  await Promise.all([
    deleteSecret("imap-password", email),
    deleteSecret("smtp-password", email),
    deleteSecret("oauth-refresh", email),
  ]);
}
