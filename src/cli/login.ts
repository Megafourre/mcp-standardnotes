#!/usr/bin/env node
import readline from "node:readline";
import { logger } from "../security/logger.js";
import keytar from "keytar";
import { createClientFromLogin } from "../sn/client.js";
import { installDesktopAccounts, resolvePaths } from "./install.js";

const KEYCHAIN_SERVICE = process.env.KEYCHAIN_SERVICE ?? "mcp-standardnotes";

const CTRL_C = "";
const DEL = "";

function promptVisible(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptSilent(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    const wasRaw = stdin.isRaw === true;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let input = "";
    const cleanup = (): void => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === CTRL_C) {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("aborted"));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (ch === DEL || ch === "\b") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        input += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

function prompt(question: string, silent = false): Promise<string> {
  return silent ? promptSilent(question) : promptVisible(question);
}

async function loginOne(serverUrl: string, email: string): Promise<void> {
  let password = await prompt("Password: ", true);
  if (!password) throw new Error("password is required");
  try {
    await createClientFromLogin(
      { serverUrl, email },
      password,
      async () => prompt("Two-factor code (6 digits): "),
    );
    password = "";
    logger.info("Login OK, session stored in keychain", { email, serverUrl });
    process.stdout.write(
      `Login successful for ${email}. Session saved in OS keychain.\n`,
    );
  } catch (err) {
    password = "";
    const causes: string[] = [];
    let cur: unknown = err;
    while (cur instanceof Error) {
      causes.push(cur.message);
      cur = (cur as Error & { cause?: unknown }).cause;
    }
    logger.error("Login failed", {
      message: causes[0] ?? String(err),
      causes: causes.slice(1),
    });
    process.exit(1);
  }
}

async function storedAccounts(): Promise<string[]> {
  try {
    const creds = await keytar.findCredentials(KEYCHAIN_SERVICE);
    return creds.map((c) => c.account).sort();
  } catch {
    return [];
  }
}

async function offerInstall(emails: string[]): Promise<void> {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    process.stdout.write(
      "\nHook it up with `mcp-standardnotes-install --all` " +
        "(Claude Desktop) or `mcp-standardnotes-install code --all` " +
        "(prints the `claude mcp add` commands for Claude Code).\n",
    );
    return;
  }
  const ans = (
    await prompt("Wire these account(s) into Claude Desktop now? [Y/n]: ")
  ).toLowerCase();
  if (ans !== "" && ans !== "y" && ans !== "yes") {
    process.stdout.write(
      "Skipped. Run `mcp-standardnotes-install --all` when you're ready.\n",
    );
    return;
  }
  try {
    const { configPath, backup, names } = await installDesktopAccounts({
      emails,
      paths: resolvePaths(),
    });
    process.stdout.write(`Claude Desktop config updated at ${configPath}\n`);
    process.stdout.write(
      `  ${names.map((n, i) => `${n}  →  ${emails[i]}`).join("\n  ")}\n`,
    );
    if (backup) {
      process.stdout.write(`Previous config backed up to ${backup}\n`);
    }
    process.stdout.write(
      "Quit Claude Desktop fully and relaunch to pick up the change.\n",
    );
  } catch (err) {
    process.stdout.write(
      `Desktop install skipped: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.stdout.write(
      "You can retry later with `mcp-standardnotes-install --all`.\n",
    );
  }
}

async function main(): Promise<void> {
  const serverUrl =
    process.env.SN_SERVER_URL ?? "https://api.standardnotes.com";
  const envEmail = process.env.SN_EMAIL;

  // Non-interactive: SN_EMAIL pins a single account, no loop, no install prompt.
  if (envEmail) {
    await loginOne(serverUrl, envEmail);
    return;
  }

  const loggedIn: string[] = [];
  for (;;) {
    const known = await storedAccounts();
    if (known.length > 0 && loggedIn.length === 0) {
      process.stdout.write(
        `Accounts already in the keychain: ${known.join(", ")}\n`,
      );
    }
    const email = await prompt("Email: ");
    if (!email) throw new Error("email is required");
    await loginOne(serverUrl, email);
    if (!loggedIn.includes(email)) loggedIn.push(email);

    const again = (
      await prompt("Log in another account? [y/N]: ")
    ).toLowerCase();
    if (again !== "y" && again !== "yes") break;
  }

  const known = await storedAccounts();
  process.stdout.write(
    `\nStored sessions: ${known.join(", ") || loggedIn.join(", ")}\n`,
  );
  // Wire in every account we just authenticated (so a second `login` run that
  // adds one account doesn't silently drop the first from the config, pass the
  // union with what's already stored).
  const toInstall = known.length > 0 ? known : loggedIn;
  await offerInstall(toInstall);
}

main();
