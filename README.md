# mmmail

A small, agent-friendly CLI mail client. Stateless commands — `list`, `read`, `send`, `reply`, `search`, `mark`, `move`, `delete` — plus attachments, for Gmail (OAuth), Microsoft (OAuth + PKCE), and any IMAP/SMTP host. Installs the `mmm` binary. `--json` on every data command.

```sh
npm install -g @0xmmo/mmmail
```

Requires Node.js ≥ 20. On Linux: `sudo apt-get install -y libsecret-1-dev` for keychain support.

```sh
mmm init                                       # add an account
mmm list                                       # 20 most recent in INBOX
mmm read 1234 --save-attachments ./out         # read + extract attachments
mmm send -t a@example.com -s "hi" -b "hello" --attach ./report.pdf
mmm reply 1234 -b "thanks"
mmm search "invoice"
mmm doctor --json                              # CI gate (exits 1 on failure)
```

**Full documentation, setup guides, and command reference:** <https://blog.0xmmo.co/mmmail/>

## Development

```sh
git clone https://github.com/0xmmo/mmmail && cd mmmail
npm install
npm run cli -- list -n 5       # run from TS via tsx
npm test
npm run build
```

## Releasing

Push a `v*.*.*` tag — CI runs typecheck + tests + build, publishes to npm with provenance, creates a GitHub release.

```sh
npm version patch              # or: minor / major
git push --follow-tags
```

Requires npm Trusted Publishing (or `NPM_TOKEN` repo secret).

## License

MIT
