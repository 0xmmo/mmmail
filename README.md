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
| Microsoft | 🚧 stubbed for now | OAuth 2.0 + Microsoft Graph (planned) |
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

## Commands

### Account management

```
mmm                                  open the interactive dashboard (TTY)
                                     in non-TTY: prints status + help, exits 2
mmm init                             same as bare `mmm`
mmm accounts [--json]                list configured accounts
mmm default <email>                  set the default account
mmm remove <email>                   remove an account + its keychain entries

mmm setup [google]                   print OAuth setup instructions
mmm add google --email <addr> \
    [--credentials-file <path>]      auth via Google's downloaded JSON
    [--client-id <id> --client-secret <secret>]
    [--client-secret-stdin]
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
