import { Command, Option } from "commander";
import pc from "picocolors";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

const program = new Command();

program
  .name("mmm")
  .description("A CLI email client made for agents — Gmail, Microsoft 365, IMAP")
  .version(pkg.version)
  .action(async () => {
    const { runInit } = await import("./commands/init.js");
    await runInit();
    if (!process.stdin.isTTY) {
      console.log("");
      console.log(program.helpInformation());
      // No subcommand was given; in non-TTY this is almost certainly a script
      // that forgot to specify one. Fail fast so the caller notices.
      process.exit(2);
    }
  });

program
  .command("init")
  .description("Add a mail account")
  .action(async () => {
    const { runInit } = await import("./commands/init.js");
    await runInit();
  });

program
  .command("accounts")
  .description("List configured accounts")
  .option("--json", "output JSON")
  .action(async (opts) => {
    const { listAccounts } = await import("./commands/accounts.js");
    await listAccounts(opts);
  });

program
  .command("remove <email>")
  .description("Remove a configured account")
  .action(async (email: string) => {
    const { deleteAccount } = await import("./commands/accounts.js");
    await deleteAccount(email);
  });

program
  .command("default <email>")
  .description("Set the default account")
  .action(async (email: string) => {
    const { setDefault } = await import("./commands/accounts.js");
    await setDefault(email);
  });

const addCmd = program
  .command("add")
  .description("Add a mail account non-interactively (see also: `mmm init`)");

addCmd
  .command("google")
  .description("Add a Gmail account via OAuth (loopback)")
  .option("--client-id <id>", "Google OAuth client ID (else read from keychain)")
  .option("--client-secret <secret>", "Google OAuth client secret (else read from keychain)")
  .option("--client-secret-stdin", "read --client-secret from stdin")
  .option(
    "--credentials-file <path>",
    "path to client_secret_*.json downloaded from Google Cloud Console",
  )
  .requiredOption("--email <addr>", "Gmail address to authorize")
  .option("--json", "output JSON")
  .action(async (opts) => {
    const { runAddGoogle } = await import("./commands/add.js");
    await runAddGoogle(opts);
  });

addCmd
  .command("microsoft")
  .description("Add a Microsoft account (Outlook.com / M365) via OAuth (loopback, PKCE)")
  .option("--client-id <id>", "Microsoft Entra app (client) ID (else read from keychain)")
  .requiredOption("--email <addr>", "Microsoft email address to authorize")
  .option("--json", "output JSON")
  .action(async (opts) => {
    const { runAddMicrosoft } = await import("./commands/add.js");
    await runAddMicrosoft(opts);
  });

addCmd
  .command("imap")
  .description("Add a generic IMAP/SMTP account (auto-discovers servers from the email domain)")
  .requiredOption("--email <addr>", "email address (also used as IMAP/SMTP user)")
  .option("--preset <name>", "use a preset: fastmail | icloud | yahoo")
  .option("--imap-host <host>", "IMAP host (e.g. imap.example.com)")
  .option("--imap-port <port>", "IMAP port (993 implicit-TLS, 143 STARTTLS)")
  .option("--imap-tls <bool>", "IMAP implicit TLS (default true)")
  .option("--smtp-host <host>", "SMTP host")
  .option("--smtp-port <port>", "SMTP port (465 implicit-TLS, 587 STARTTLS)")
  .option("--smtp-tls <bool>", "SMTP implicit TLS (default true)")
  .option("--no-autodiscover", "disable automatic IMAP/SMTP server lookup")
  .option("--password-stdin", "read IMAP/SMTP password from stdin")
  .option("--password-env <var>", "read IMAP/SMTP password from this env var")
  .option(
    "--smtp-password-stdin",
    "read a separate SMTP password from stdin (rare; defaults to --password)",
  )
  .option(
    "--smtp-password-env <var>",
    "read a separate SMTP password from this env var",
  )
  .option("--json", "output JSON")
  .action(async (opts) => {
    const { runAddImap } = await import("./commands/add.js");
    await runAddImap(opts);
  });

program
  .command("setup [provider]")
  .description("Print OAuth setup instructions for a provider (default: google)")
  .action(async (provider) => {
    const { runSetup } = await import("./commands/setup.js");
    await runSetup(provider);
  });

program
  .command("list")
  .alias("ls")
  .description("List messages in a folder")
  .option("-f, --folder <name>", "folder name", "INBOX")
  .option("-n, --limit <n>", "max messages", "20")
  .option("-u, --unread", "only unread")
  .option("--since <date>", "only messages on/after this date (ISO or YYYY-MM-DD)")
  .option("--before <date>", "only messages strictly before this date")
  .option("--uid-after <uid>", "only messages with UID greater than this")
  .option("-a, --account <email>", "account override")
  .option("--json", "output JSON")
  .action(async (opts) => {
    const { runList } = await import("./commands/list.js");
    await runList(opts);
  });

program
  .command("read <id>")
  .description("Read a message by id (UID)")
  .option("-f, --folder <name>", "folder name", "INBOX")
  .option("-a, --account <email>", "account override")
  .option("--json", "output JSON")
  .option("--include-html", "include the HTML body (omitted by default; can be very large)")
  .option("--save-attachments <dir>", "save message attachments into this directory")
  .action(async (id, opts) => {
    const { runRead } = await import("./commands/read.js");
    await runRead(id, opts);
  });

program
  .command("send")
  .description("Send a message")
  .requiredOption("-t, --to <addr...>", "recipient(s)")
  .option("-c, --cc <addr...>", "cc recipient(s)")
  .option("-B, --bcc <addr...>", "bcc recipient(s)")
  .requiredOption("-s, --subject <text>", "subject")
  .addOption(
    new Option("-b, --body <text>", "body text; use '-' or --body-stdin to read from stdin"),
  )
  .option("--body-stdin", "read body from stdin (avoids leaking via argv)")
  .option("--attach <path...>", "attach one or more files (repeatable)")
  .option("-a, --account <email>", "account override")
  .option("--json", "output JSON")
  .action(async (opts) => {
    const { runSend } = await import("./commands/send.js");
    await runSend(opts);
  });

program
  .command("reply <id>")
  .description("Reply to a message")
  .option("-b, --body <text>", "reply body")
  .option("--body-stdin", "read body from stdin")
  .option("--all", "reply to all (cc original recipients)")
  .option("--attach <path...>", "attach one or more files (repeatable)")
  .option("-f, --folder <name>", "folder of the original message", "INBOX")
  .option("-a, --account <email>", "account override")
  .option("--json", "output JSON")
  .action(async (id, opts) => {
    const { runReply } = await import("./commands/reply.js");
    await runReply(id, opts);
  });

program
  .command("search <query>")
  .description("Search messages in a folder")
  .option("-f, --folder <name>", "folder name", "INBOX")
  .option("-n, --limit <n>", "max results", "50")
  .option("--since <date>", "only messages on/after this date")
  .option("--before <date>", "only messages strictly before this date")
  .option("--uid-after <uid>", "only messages with UID greater than this")
  .option("-a, --account <email>", "account override")
  .option("--json", "output JSON")
  .action(async (query, opts) => {
    const { runSearch } = await import("./commands/search.js");
    await runSearch(query, opts);
  });

program
  .command("folders")
  .description("List available IMAP folders")
  .option("-a, --account <email>", "account override")
  .option("--json", "output JSON")
  .action(async (opts) => {
    const { runFolders } = await import("./commands/folders.js");
    await runFolders(opts);
  });

program
  .command("doctor")
  .description("Verify each account can connect and fetch INBOX")
  .option("--json", "output JSON")
  .action(async (opts) => {
    const { runDoctor } = await import("./commands/doctor.js");
    await runDoctor(opts);
  });

program
  .command("mark <id>")
  .description("Mark a message as read/unread/flagged/unflagged")
  .option("--read", "mark as read (sets \\Seen)")
  .option("--unread", "mark as unread (clears \\Seen)")
  .option("--flagged", "set the \\Flagged flag (Gmail: star)")
  .option("--unflagged", "clear the \\Flagged flag")
  .option("-f, --folder <name>", "folder containing the message", "INBOX")
  .option("-a, --account <email>", "account override")
  .option("--json", "output JSON")
  .action(async (id, opts) => {
    const { runMark } = await import("./commands/mark.js");
    await runMark(id, opts);
  });

program
  .command("move <id> <destination>")
  .description("Move a message to another folder")
  .option("-f, --folder <name>", "current folder of the message", "INBOX")
  .option("-a, --account <email>", "account override")
  .option("--json", "output JSON")
  .action(async (id, destination, opts) => {
    const { runMove } = await import("./commands/move.js");
    await runMove(id, destination, opts);
  });

program
  .command("delete <id>")
  .alias("rm")
  .description("Permanently delete a message (sets \\Deleted + EXPUNGE)")
  .option("-f, --folder <name>", "folder containing the message", "INBOX")
  .option("-a, --account <email>", "account override")
  .option("--json", "output JSON")
  .action(async (id, opts) => {
    const { runDelete } = await import("./commands/delete.js");
    await runDelete(id, opts);
  });

function trailingNewline(): void {
  if (process.stdout.isTTY) process.stdout.write("\n");
}

program
  .parseAsync(process.argv)
  .then(trailingNewline)
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(pc.red("error: ") + msg);
    trailingNewline();
    process.exit(1);
  });
