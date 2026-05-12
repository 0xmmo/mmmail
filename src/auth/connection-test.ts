import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export interface ServerSpec {
  host: string;
  port: number;
  secure: boolean;
}

export interface TestOutcome {
  ok: boolean;
  error?: string;
  authFailed?: boolean;
}

export async function testImap(
  spec: ServerSpec,
  user: string,
  pass: string,
): Promise<TestOutcome> {
  const client = new ImapFlow({
    host: spec.host,
    port: spec.port,
    secure: spec.secure,
    auth: { user, pass },
    logger: false,
  });
  try {
    await client.connect();
    return { ok: true };
  } catch (err) {
    return classify(err);
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export async function testSmtp(
  spec: ServerSpec,
  user: string,
  pass: string,
): Promise<TestOutcome> {
  const transport = nodemailer.createTransport({
    host: spec.host,
    port: spec.port,
    secure: spec.secure,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return classify(err);
  } finally {
    transport.close();
  }
}

function classify(err: unknown): TestOutcome {
  const msg = err instanceof Error ? err.message : String(err);
  // ImapFlow surfaces auth failures with code "AUTHENTICATIONFAILED"; nodemailer
  // raises EAUTH. Both also tend to include "Invalid credentials" or "535".
  const lower = msg.toLowerCase();
  const authFailed =
    /authenticationfailed|eauth|invalid credentials|incorrect username|535/i.test(
      lower,
    );
  return { ok: false, error: msg, authFailed };
}
