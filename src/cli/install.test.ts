import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// keytar is a top-level import in install.ts. Mock it so the test doesn't
// dlopen libsecret on the Linux CI runner (which doesn't have it installed).
vi.mock("keytar", () => ({
  default: {
    findCredentials: vi.fn(async () => []),
    getPassword: vi.fn(async () => null),
    setPassword: vi.fn(async () => undefined),
    deletePassword: vi.fn(async () => true),
  },
}));

import {
  accountEntryName,
  buildEntry,
  installDesktop,
  installDesktopAccounts,
} from "./install.js";

const fakePaths = {
  node: "/abs/path/to/node",
  server: "/abs/path/to/dist/index.js",
};

describe("install — buildEntry", () => {
  it("uses absolute node + server paths and sets SN_EMAIL", () => {
    expect(buildEntry(fakePaths, "a@b.co")).toEqual({
      command: "/abs/path/to/node",
      args: ["/abs/path/to/dist/index.js"],
      env: { SN_EMAIL: "a@b.co" },
    });
  });
});

describe("install — accountEntryName", () => {
  it("keeps the historical name for a single account", () => {
    expect(accountEntryName("a@b.co")).toBe("mcp-standardnotes");
    expect(accountEntryName("a@b.co", ["a@b.co"])).toBe("mcp-standardnotes");
  });

  it("suffixes with the local part when several accounts", () => {
    const emails = ["me@perso.fr", "family@shared.com"];
    expect(accountEntryName("me@perso.fr", emails)).toBe(
      "mcp-standardnotes-me",
    );
    expect(accountEntryName("family@shared.com", emails)).toBe(
      "mcp-standardnotes-family",
    );
  });

  it("disambiguates with the domain when local parts collide", () => {
    const emails = ["me@perso.fr", "me@work.com"];
    expect(accountEntryName("me@perso.fr", emails)).toBe(
      "mcp-standardnotes-me-perso",
    );
    expect(accountEntryName("me@work.com", emails)).toBe(
      "mcp-standardnotes-me-work",
    );
  });
});

describe("install — installDesktopAccounts (against a tmpdir)", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-sn-install-multi-"));
    configPath = join(dir, "claude_desktop_config.json");
  });

  it("writes one named entry per account", async () => {
    const { names } = await installDesktopAccounts({
      emails: ["me@perso.fr", "family@shared.com"],
      paths: fakePaths,
      configPath,
    });
    expect(names).toEqual([
      "mcp-standardnotes-me",
      "mcp-standardnotes-family",
    ]);
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written.mcpServers["mcp-standardnotes-me"].env.SN_EMAIL).toBe(
      "me@perso.fr",
    );
    expect(written.mcpServers["mcp-standardnotes-family"].env.SN_EMAIL).toBe(
      "family@shared.com",
    );
  });

  it("drops a stale single-account entry that points at this server", async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          "mcp-standardnotes": buildEntry(fakePaths, "me@perso.fr"),
        },
      }),
    );
    await installDesktopAccounts({
      emails: ["me@perso.fr", "family@shared.com"],
      paths: fakePaths,
      configPath,
    });
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(Object.keys(written.mcpServers).sort()).toEqual([
      "mcp-standardnotes-family",
      "mcp-standardnotes-me",
    ]);
  });

  it("keeps an unrelated single-account entry (different server path)", async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          "mcp-standardnotes": { command: "x", args: ["/other/server.js"] },
        },
      }),
    );
    await installDesktopAccounts({
      emails: ["me@perso.fr", "family@shared.com"],
      paths: fakePaths,
      configPath,
    });
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written.mcpServers["mcp-standardnotes"]).toBeDefined();
  });
});

describe("install — installDesktop (against a tmpdir)", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-sn-install-test-"));
    configPath = join(dir, "claude_desktop_config.json");
  });
  afterEach(() => {
    // tmpdir auto-cleans; nothing else to do
  });

  it("creates the config when it doesn't exist", async () => {
    const { backup } = await installDesktop({
      email: "a@b.co",
      paths: fakePaths,
      configPath,
    });
    expect(backup).toBeNull();
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written.mcpServers["mcp-standardnotes"]).toEqual(
      buildEntry(fakePaths, "a@b.co"),
    );
  });

  it("preserves other mcpServers entries when merging", async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          "some-other-server": { command: "/usr/bin/other", args: [] },
        },
      }),
    );
    await installDesktop({ email: "a@b.co", paths: fakePaths, configPath });
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written.mcpServers["some-other-server"]).toBeDefined();
    expect(written.mcpServers["mcp-standardnotes"].env.SN_EMAIL).toBe("a@b.co");
  });

  it("backs up the existing config before overwriting", async () => {
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { "mcp-standardnotes": { command: "old" } } }),
    );
    const { backup } = await installDesktop({
      email: "a@b.co",
      paths: fakePaths,
      configPath,
    });
    expect(backup).not.toBeNull();
    expect(backup).toMatch(/\.bak-/);
    const backedUp = JSON.parse(await readFile(backup as string, "utf8"));
    expect(backedUp.mcpServers["mcp-standardnotes"].command).toBe("old");
  });

  it("overwrites a stale mcp-standardnotes entry without duplicating", async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          "mcp-standardnotes": { command: "/old/node", args: ["/old/path"] },
        },
      }),
    );
    await installDesktop({ email: "a@b.co", paths: fakePaths, configPath });
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(Object.keys(written.mcpServers)).toEqual(["mcp-standardnotes"]);
    expect(written.mcpServers["mcp-standardnotes"].command).toBe(fakePaths.node);
  });

  it("refuses to overwrite an existing malformed config", async () => {
    await writeFile(configPath, "{ not json");
    await expect(
      installDesktop({ email: "a@b.co", paths: fakePaths, configPath }),
    ).rejects.toThrow(/not valid JSON/);
  });
});
