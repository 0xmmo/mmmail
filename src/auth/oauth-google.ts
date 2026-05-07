import http from "node:http";
import { AddressInfo } from "node:net";
import { URL } from "node:url";
import { OAuth2Client } from "google-auth-library";
import open from "open";

const SCOPE = "https://mail.google.com/";

export interface ConsentResult {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

export async function runConsentFlow(opts: {
  clientId: string;
  clientSecret: string;
  loginHint?: string;
  onAuthUrl?: (url: string) => void;
}): Promise<ConsentResult> {
  const { server, port } = await startLoopbackServer();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const client = new OAuth2Client({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    redirectUri,
  });

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [SCOPE],
    login_hint: opts.loginHint,
  });

  opts.onAuthUrl?.(authUrl);

  let codePromise: Promise<string>;
  try {
    codePromise = waitForCallback(server);
    await open(authUrl).catch(() => undefined);
    const code = await codePromise;
    const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh token. Revoke previous access at https://myaccount.google.com/permissions and try again.",
      );
    }
    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? "",
      expiresAt: tokens.expiry_date ?? Date.now() + 3500 * 1000,
    };
  } finally {
    server.close();
  }
}

export async function refreshAccessToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresAt: number }> {
  const client = new OAuth2Client({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
  });
  client.setCredentials({ refresh_token: opts.refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error("Failed to refresh Google access token");
  }
  return {
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date ?? Date.now() + 3500 * 1000,
  };
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

function waitForCallback(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for OAuth callback (5 min)"));
    }, 5 * 60 * 1000);

    server.on("request", (req, res) => {
      try {
        const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
        if (!reqUrl.pathname.startsWith("/callback")) {
          res.writeHead(404);
          res.end();
          return;
        }
        const code = reqUrl.searchParams.get("code");
        const error = reqUrl.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(htmlPage(`Authorization failed: ${error}`));
          clearTimeout(timeout);
          reject(new Error(`OAuth error: ${error}`));
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
