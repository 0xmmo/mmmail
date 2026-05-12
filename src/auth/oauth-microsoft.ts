import http from "node:http";
import crypto from "node:crypto";
import { AddressInfo } from "node:net";
import { URL } from "node:url";
import open from "open";

const AUTHORIZE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPES =
  "offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send";

// mmmail's shared Microsoft Entra app — multi-tenant + personal accounts,
// public client (PKCE), redirect `http://localhost`. Lets users authorize
// without registering their own Azure app. Override with --client-id (or pick
// "Register your own" in `mmm init`) when running against an M365 tenant whose
// admin requires you-owned apps.
export const DEFAULT_CLIENT_ID = "40c38c9d-11e8-4af4-9702-ed4ddc486cfe";

export interface ConsentResult {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

export async function runConsentFlow(opts: {
  clientId: string;
  loginHint?: string;
  onAuthUrl?: (url: string) => void;
}): Promise<ConsentResult> {
  const { server, port } = await startLoopbackServer();
  // Azure's OAuth 2.0 native-app loopback exception lets us pick any port
  // at runtime, but the hostname AND path must match the registered URI
  // exactly. The registered URI is `http://localhost` (no path), so the
  // redirect URI must be `http://localhost:PORT` (root path). The server
  // itself still binds on 127.0.0.1.
  const redirectUri = `http://localhost:${port}`;
  const { verifier, challenge } = generatePkce();
  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  const authUrl = `${AUTHORIZE}?${params.toString()}`;

  opts.onAuthUrl?.(authUrl);

  try {
    const codePromise = waitForCallback(server, state);
    await open(authUrl).catch(() => undefined);
    const code = await codePromise;
    const tokens = await exchange({
      grant_type: "authorization_code",
      client_id: opts.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: SCOPES,
    });
    if (!tokens.refresh_token) {
      throw new Error(
        "Microsoft did not return a refresh token. Confirm that 'Allow public client flows' is enabled in your Azure app registration and that offline_access is in the requested scopes.",
      );
    }
    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? "",
      expiresAt: Date.now() + (tokens.expires_in ?? 3500) * 1000,
    };
  } finally {
    server.close();
  }
}

export async function refreshAccessToken(opts: {
  clientId: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresAt: number; refreshToken: string }> {
  const tokens = await exchange({
    grant_type: "refresh_token",
    client_id: opts.clientId,
    refresh_token: opts.refreshToken,
    scope: SCOPES,
  });
  if (!tokens.access_token) {
    throw new Error("Microsoft did not return an access token on refresh");
  }
  // Microsoft rotates the refresh token on every refresh — return the new
  // one so the caller can persist it. Fall back to the old one if for some
  // reason the response omits it.
  return {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3500) * 1000,
    refreshToken: tokens.refresh_token ?? opts.refreshToken,
  };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function exchange(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // leave json empty; we'll fall back to raw in the error message
  }
  if (!res.ok) {
    const err = String(json.error ?? "");
    const desc = String(json.error_description ?? "");
    const hint = hintForError(err);
    const detail = desc || raw || `HTTP ${res.status}`;
    throw new Error(
      `Microsoft OAuth ${res.status} (${err || "error"}): ${detail}${hint ? `\n  ${hint}` : ""}`,
    );
  }
  return json as TokenResponse;
}

function hintForError(code: string): string {
  switch (code) {
    case "unauthorized_client":
      return "Ensure 'Allow public client flows' is enabled in your Azure app registration.";
    case "invalid_client":
      return "Wrong Client ID, or your app is configured as a confidential client (mmm uses PKCE — no secret).";
    case "invalid_grant":
      return "Your refresh token was revoked or expired. Run `mmm add microsoft --email <addr> --client-id <id>` to re-authorize.";
    default:
      return "";
  }
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function startLoopbackServer(): Promise<{
  server: http.Server;
  port: number;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        server.close();
        reject(new Error("Loopback server failed to bind"));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

function waitForCallback(server: http.Server, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for OAuth callback (5 min)"));
    }, 5 * 60 * 1000);

    server.on("request", (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
        // The OAuth callback lands on the root path (no `/callback`) because
        // the registered redirect URI is `http://localhost` and Microsoft
        // requires an exact path match. Ignore everything else (browsers
        // hit /favicon.ico etc.).
        const params = reqUrl.searchParams;
        const looksLikeOAuthCallback =
          params.has("code") || params.has("error");
        if (reqUrl.pathname !== "/" || !looksLikeOAuthCallback) {
          res.writeHead(404);
          res.end();
          return;
        }
        const code = params.get("code");
        const error = params.get("error");
        const state = params.get("state");
        if (error) {
          const desc = params.get("error_description") ?? "";
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(htmlPage(`Authorization failed: ${error}${desc ? ` — ${desc}` : ""}`));
          clearTimeout(timeout);
          reject(new Error(`OAuth error: ${error}${desc ? ` — ${desc}` : ""}`));
          return;
        }
        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(htmlPage("State mismatch — possible CSRF. Try again."));
          clearTimeout(timeout);
          reject(new Error("OAuth state mismatch"));
          return;
        }
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(htmlPage("Missing authorization code."));
          clearTimeout(timeout);
          reject(new Error("OAuth callback missing code"));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          htmlPage(
            "Authorization complete. You can close this tab and return to the terminal.",
          ),
        );
        clearTimeout(timeout);
        resolve(code);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function htmlPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>mmmail</title>
<style>body{font:16px system-ui;margin:80px auto;max-width:480px;color:#222}</style></head>
<body><h1>mmmail</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
