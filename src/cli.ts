import { Command, Option } from "commander";
import pc from "picocolors";
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

const program = new Command();

program
  .name("mmm")
  .description("CLI mail client for Gmail, Outlook, and IMAP")
  .version(pkg.version);

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
  .action(async () => {
    const { listAccounts } = await import("./commands/accounts.js");
    await listAccounts();
  });

program
  .command("remove <email>")
  .description("Remove a configured account")
  .action(async (email: string) => {
    const { deleteAccount } = await import("./commands/accounts.js");
    await deleteAccount(email);
  });

program
  .command("list")
  .alias("ls")
  .description("List messages in a folder")
  .option("-f, --folder <name>", "folder name", "INBOX")
  .option("-n, --limit <n>", "max messages", "20")
  .option("-u, --unread", "only unread")
  .option("-a, --account <email>", "account override")
  .action(async (opts) => {
    const { runList } = await import("./commands/list.js");
    await runList(opts);
  });

program
  .command("read <id>")
  .description("Read a message by id (UID)")
  .option("-a, --account <email>", "account override")
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
    new Option("-b, --body <text>", "body text; use '-' to read from stdin"),
  )
  .option("-a, --account <email>", "account override")
  .action(async (opts) => {
    const { runSend } = await import("./commands/send.js");
    await runSend(opts);
  });

program
  .command("reply <id>")
  .description("Reply to a message")
  .option("-b, --body <text>", "reply body")
  .option("--all", "reply to all (cc original recipients)")
  .option("-a, --account <email>", "account override")
  .action(async (id, opts) => {
    const { runReply } = await import("./commands/reply.js");
    await runReply(id, opts);
  });

program
  .command("search <query>")
  .description("Search messages in a folder")
  .option("-f, --folder <name>", "folder name", "INBOX")
  .option("-n, --limit <n>", "max results", "50")
  .option("-a, --account <email>", "account override")
  .action(async (query, opts) => {
    const { runSearch } = await import("./commands/search.js");
    await runSearch(query, opts);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(pc.red("error: ") + msg);
  process.exit(1);
});
