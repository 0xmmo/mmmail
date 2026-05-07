# mmmail

A small CLI mail client. Stateless commands — list, read, send, reply, search — for Gmail (OAuth) and any IMAP/SMTP server. Installs the `mmm` binary.

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

```sh
mmm init        # add an account (Gmail via OAuth, or any IMAP server)
mmm list        # show 20 most recent messages in INBOX
mmm read 1234   # read message with UID 1234
mmm send -t a@example.com -s "hi" -b "hello"
mmm reply 1234 -b "thanks"
mmm search "invoice"
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

`mmm` uses **your own** Google OAuth client. Google's `https://mail.google.com/` scope is restricted, so a shared client isn't possible — but `mmm init` walks you through the setup. URLs are printed as clickable links.

You'll do this once per machine. Subsequent Gmail accounts skip the setup and only run the consent flow.

1. Create a Google Cloud project (or skip if you already have one) — https://console.cloud.google.com/projectcreate
2. Enable the Gmail API — https://console.cloud.google.com/apis/library/gmail.googleapis.com
3. Configure the OAuth consent screen — https://console.cloud.google.com/auth/overview
   - Audience: **External**
4. Add yourself as a test user — https://console.cloud.google.com/auth/audience
   - Under the *Audience* tab, scroll to *Test users* and add your Gmail address
5. Create OAuth credentials — https://console.cloud.google.com/auth/clients
   - *+ Create Client* → Application type: **Desktop app**
6. Copy the **Client ID** and **Client secret** from the dialog and paste them when `mmm init` asks

Your app stays in **testing mode** (no Google verification needed) — that's fine for personal use. Up to 100 test users can authorize.

## Commands

```
mmm init                          add a mail account
mmm accounts                      list configured accounts
mmm remove <email>                remove an account
mmm list [-f INBOX] [-n 20] [-u]  list messages
mmm read <uid>                    read a single message
mmm send -t to -s subject [-b]    send a message ('-' = stdin, omit = $EDITOR)
mmm reply <uid> [-b body] [--all] reply (or reply-all)
mmm search <query>                full-text search
```

Every command takes `-a, --account <email>` to override the default account.

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
