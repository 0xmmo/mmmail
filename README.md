# mmmail

A small, agent-friendly CLI mail client. Stateless commands — list, read, send, reply, search, mark, move, delete — for Gmail (OAuth) and any IMAP/SMTP server. Installs the `mmm` binary. JSON output on every data command.

## Install

```sh
npm install -g @0xmmo/mmmail
```

Requires Node.js ≥ 20. On Linux you may also need `libsecret` for keychain support:

```sh
# Debian/Ubuntu
sudo apt-get install -y libsecret-1-dev
```

## Quickstart

Interactive (laptop):

```sh
mmm                       # opens the dashboard (add / set default / remove)
mmm init                  # same as bare `mmm` — adds an account
mmm list                  # show 20 most recent messages in INBOX
mmm read 1234             # read message with UID 1234
mmm send -t a@example.com -s "hi" -b "hello"
mmm reply 1234 -b "thanks"
mmm search "invoice"
```

Non-interactive / agent (every data command also takes `--json`):

```sh
mmm setup google                                       # print Google OAuth setup steps
mmm add google --email me@gmail.com \
  --credentials-file ./client_secret.json              # auth via printed URL
mmm add microsoft --email me@outlook.com               # uses mmmail's built-in Entra app
# (or pass --client-id <id> to use your own Entra app)
mmm add imap --email me@example.com --preset fastmail \
  --password-stdin                                     # piped password
mmm doctor --json                                      # health check, exits 1 on failure
mmm list --json -n 50 --uid-after 12000                # pagination
mmm mark 1234 --read --flagged
mmm move 1234 "[Gmail]/All Mail"
```

Account metadata lives in `~/.config/mmmail/config.json` (mode 0600). Passwords, OAuth client secrets, and OAuth refresh tokens are stored in your OS keychain via [@napi-rs/keyring](https://www.npmjs.com/package/@napi-rs/keyring) — they never touch the config file.

## Providers

| Provider | Status | Auth |
|---|---|---|
| Google | ✅ supported | OAuth 2.0 (loopback redirect) |
| Microsoft (Outlook.com / M365) | ✅ supported | OAuth 2.0 + PKCE (loopback redirect) |
| Generic IMAP / SMTP | ✅ supported | App password (stored in OS keychain) |
| Fastmail / iCloud / Yahoo | ✅ supported | App password (server presets included) |

### Google setup (one-time, ~3 min)

`mmm` uses **your own** Google OAuth client. Google's `https://mail.google.com/` scope is restricted, so a shared client isn't possible — but `mmm init` walks you through the setup. URLs are printed as clickable links. Run `mmm setup google` to see the same steps non-interactively.

You'll do this once per machine. Subsequent Gmail accounts skip the setup and only run the consent flow.

1. Create a Google Cloud project (or skip if you already have one) — https://console.cloud.google.com/projectcreate
2. Enable the Gmail API — https://console.cloud.google.com/apis/library/gmail.googleapis.com
3. Configure the OAuth consent screen — https://console.cloud.google.com/auth/overview
   - Audience: **External**
4. Add yourself as a test user — https://console.cloud.google.com/auth/audience
   - Under the *Audience* tab, scroll to *Test users* and add your Gmail address
5. Create OAuth credentials — https://console.cloud.google.com/auth/clients
   - *+ Create Client* → Application type: **Desktop app**
6. Copy the **Client ID** and **Client secret** (or download the JSON) and paste them when `mmm init` asks (or pass via `--client-id`/`--client-secret` or `--credentials-file`)

Your app stays in **testing mode** (no Google verification needed) — that's fine for personal use. Up to 100 test users can authorize.

### Microsoft (Outlook.com / M365)

`mmm` ships with a built-in Microsoft Entra app (multi-tenant + personal accounts, public client + PKCE, no secret). The default flow needs **zero Azure setup**:

```sh
mmm add microsoft --email me@outlook.com
```

You'll see "mmmail" on the consent screen, approve, and you're done.

> **Work/school accounts:** Many M365 tenants disable SMTP AUTH by default. If `mmm send` fails with `SmtpClientAuthentication is disabled`, ask your admin to enable [authenticated client SMTP submission](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission) for your mailbox.

#### Optional: register your own Entra app

If you'd prefer to authorize through an app you own — typical for M365 tenants where admins require you-owned apps — register your own and pass `--client-id`:

1. Register a new app — https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/quickStartType~/null/isMSAApp~/false
   - Account types: **Accounts in any organizational directory and personal Microsoft accounts**
   - Leave the Redirect URI blank — you'll set it next
2. Entra admin center → **App registrations** → click your new app → left sidebar **Manage → Authentication**
3. On the **Redirect URI configuration** tab, click **+ Add Redirect URI** → in the "Select a platform" panel, pick **Mobile and desktop applications** (Windows, UWP, Console, IoT…) → **Select**. Enter `http://localhost` as the URI → **Configure**
4. Same Authentication page → **Settings** tab → toggle **Allow public client flows** to **Yes** → **Save**
5. Left sidebar of your app → **Overview** → copy **Application (client) ID**. No client secret is needed.

```sh
mmm add microsoft --email me@outlook.com --client-id <your-id>
```

`mmm init` and `mmm setup microsoft` walk through the same steps interactively.

## Commands

### Account management

```
mmm                                  open the interactive dashboard (TTY)
                                     in non-TTY: prints status + help, exits 2
mmm init                             same as bare `mmm`
mmm accounts [--json]                list configured accounts
mmm default <email>                  set the default account
mmm remove <email>                   remove an account + its keychain entries

mmm setup [google|microsoft]         print OAuth setup instructions
mmm add google --email <addr> \
    [--credentials-file <path>]      auth via Google's downloaded JSON
    [--client-id <id> --client-secret <secret>]
    [--client-secret-stdin]
mmm add microsoft --email <addr> \
    [--client-id <id>]               default: mmmail's built-in Entra app (PKCE);
                                     pass --client-id to use your own app
mmm add imap --email <addr> \
    [--preset fastmail|icloud|yahoo  | --imap-host ... --imap-port ... --smtp-host ... --smtp-port ...] \
    [--password-stdin | --password-env <VAR>] \
    [--smtp-password-stdin | --smtp-password-env <VAR>]
```

### Reading

```
mmm list [-f INBOX] [-n 20] [-u]      list messages (-u = unread only)
         [--since <date>] [--before <date>] [--uid-after <uid>]
mmm read <uid> [-f INBOX]             read one message (text + headers)
         [--include-html]             also include HTML body (large)
mmm search <query> [-f INBOX] [-n 50] full-text search across subject/body/from
         [--since <date>] [--before <date>] [--uid-after <uid>]
mmm folders                           list available IMAP folders
```

### Writing

```
mmm send -t <addr...> -s <subj> [-b <body> | --body-stdin]
         [-c <cc...>] [-B <bcc...>]
mmm reply <uid> [-b <body> | --body-stdin] [--all] [-f INBOX]
         (auto-sets In-Reply-To and References for proper threading)
```

### Mailbox actions

```
mmm mark <uid> [--read | --unread] [--flagged | --unflagged] [-f INBOX]
mmm move <uid> <destination> [-f INBOX]      e.g. move 1234 "[Gmail]/All Mail"
mmm delete <uid> [-f INBOX]                  permanent (\Deleted + EXPUNGE)
```

### Health

```
mmm doctor [--json]                          probe each account; exits 1 on any failure
```

Every command takes `-a, --account <email>` to override the default account, and `--json` for machine-readable output.

## Agent-friendly notes

- All read/list/search/folders/doctor/send/reply/mark/move/delete support `--json`.
- `mmm` (bare) in a non-TTY exits with status 2 — fail-fast for scripts that forgot a subcommand.
- `mmm doctor --json` exits 1 if any account fails to connect — easy CI gate.
- `read --json` omits the HTML body by default (it's often >50× the text). Pass `--include-html` if you need it.
- Use `--body-stdin` / `--password-stdin` to keep secrets out of `argv` / shell history.
- Pagination: `--uid-after <n>` for incremental sync, `--since <iso-date>` / `--before <iso-date>` for time windows.

## Development

```sh
git clone https://github.com/0xmmo/mmmail
cd mmmail
npm install
npm run cli -- list --limit 5   # run the CLI directly from TS via tsx
npm run watch                   # tsup --watch (rebuilds dist/ on change)
npm run typecheck
npm test
npm run build
```

## Releasing

Two paths:

**Automated (recommended):** push a `v*.*.*` tag. CI runs typecheck + tests + build, publishes to npm with provenance, and creates a GitHub release.

```sh
npm version patch  # creates commit + tag
git push --follow-tags
```

This requires npm Trusted Publishing configured (or an `NPM_TOKEN` repo secret as fallback).

**Manual:**

```sh
npm login
npm run build
npm publish    # publishConfig.access=public is set, no flag needed
```

## License

MIT
