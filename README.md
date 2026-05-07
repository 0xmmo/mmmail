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
mmm init        # add an account (IMAP + SMTP, app password)
mmm list        # show 20 most recent messages in INBOX
mmm read 1234   # read message with UID 1234
mmm send -t a@example.com -s "hi" -b "hello"
mmm reply 1234 -b "thanks"
mmm search "invoice"
```

Account metadata lives in `~/.config/mmmail/config.json` (mode 0600). Passwords and OAuth refresh tokens are stored in your OS keychain via [keytar](https://www.npmjs.com/package/keytar) — they never touch the config file.

## Providers

| Provider | Status | Auth |
|---|---|---|
| Google | ✅ supported | OAuth 2.0 (loopback redirect) |
| Microsoft | 🚧 stubbed for now | OAuth 2.0 + Microsoft Graph (planned) |
| Generic IMAP / SMTP | ✅ supported | App password (stored in OS keychain) |
| Fastmail / iCloud / Yahoo | ✅ supported | App password (server presets included) |

### Google setup (one-time, ~3 min)

`mmm` uses **your own** Google OAuth client. Google's `https://mail.google.com/` scope is restricted, so a shared client isn't possible — but `mmm init` walks you through the setup and opens each URL for you.

You'll do this once per machine. Subsequent Gmail accounts skip the setup and only run the consent flow.

1. Create or pick a Google Cloud project — https://console.cloud.google.com/projectcreate
2. Enable the Gmail API — https://console.cloud.google.com/apis/library/gmail.googleapis.com
3. Configure the OAuth consent screen — https://console.cloud.google.com/auth/overview
   - User type: **External**
   - Add your Gmail address as a **Test user** (Audience tab)
4. Create OAuth credentials — https://console.cloud.google.com/auth/clients
   - Type: **Desktop app**
5. Copy the **Client ID** and **Client secret** from the dialog and paste them when `mmm init` asks

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
npm run dev        # tsup --watch
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
npm publish --access public
```

## License

MIT
