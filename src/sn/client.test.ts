import { afterEach, describe, expect, it, vi } from "vitest";

const {
  syncMock,
  loadSessionMock,
  saveSessionMock,
  getLoginParamsMock,
  loginMock,
} = vi.hoisted(() => ({
  syncMock: vi.fn(),
  loadSessionMock: vi.fn(),
  saveSessionMock: vi.fn(),
  getLoginParamsMock: vi.fn(),
  loginMock: vi.fn(),
}));

vi.mock("./http.js", async () => {
  const actual = await vi.importActual<typeof import("./http.js")>("./http.js");
  return {
    ...actual,
    sync: syncMock,
    getLoginParams: getLoginParamsMock,
    login: loginMock,
  };
});

vi.mock("./session.js", () => ({
  loadSession: loadSessionMock,
  saveSession: saveSessionMock,
  deleteSession: vi.fn(),
}));

import { SnApiError } from "./http.js";
import { createClientFromLogin, createClientFromSession } from "./client.js";
import { randomBytes, sodiumReady, toHex } from "./crypto.js";
import {
  encryptNote,
  encryptString,
  generateItemsKeyRaw,
} from "./protocol004.js";
import type { AdvancedChecklist } from "./advancedChecklist.js";
import { serializeChecklist } from "./advancedChecklist.js";

describe("createClientFromSession bootstrap", () => {
  afterEach(() => {
    syncMock.mockReset();
    loadSessionMock.mockReset();
    saveSessionMock.mockReset();
    getLoginParamsMock.mockReset();
    loginMock.mockReset();
  });

  it("ignores the stored syncToken so the cold-boot sync is full (fetches items_keys)", async () => {
    loadSessionMock.mockResolvedValue({
      serverUrl: "https://example.test",
      email: "a@b.co",
      sessionPayload: { access_token: "tok", refresh_token: "ref" },
      masterKeyHex: "00".repeat(32),
      keyParams: { version: "004", identifier: "a@b.co", pw_nonce: "n" },
      syncToken: "stale-token-from-previous-process",
      savedAt: new Date().toISOString(),
    });

    // Return at least one items_key to satisfy the bootstrap; we don't actually
    // decrypt anything here — the call will fail to decrypt the items_key (our
    // fake masterKey is all zeros) and createClientFromSession should throw.
    // What we care about is the syncToken passed to http.sync on the first call.
    syncMock.mockResolvedValue({
      retrieved_items: [],
      saved_items: [],
      conflicts: [],
      sync_token: "fresh-token",
    });

    await expect(
      createClientFromSession({
        serverUrl: "https://example.test",
        email: "a@b.co",
      }),
    ).rejects.toThrow(/No items_key decrypted/);

    expect(syncMock).toHaveBeenCalled();
    const firstCallParams = syncMock.mock.calls[0]?.[1];
    expect(firstCallParams?.syncToken).toBeUndefined();
  });
});

describe("createClientFromLogin MFA handling", () => {
  afterEach(() => {
    syncMock.mockReset();
    loadSessionMock.mockReset();
    saveSessionMock.mockReset();
    getLoginParamsMock.mockReset();
    loginMock.mockReset();
  });

  // SN verifies MFA inside the /v2/login-params handler — when 2FA is enabled,
  // the FIRST getLoginParams call comes back as 401 mfa-required. This test
  // pins down the contract: the prompt fires, the user's code goes back via
  // a second getLoginParams call with `{ [mfa_key]: code }`, and ONLY THEN do
  // we hit /v2/login. The previous 0.3.4 release wrapped the try/catch around
  // http.login instead, so the MFA error from login-params propagated straight
  // to the logger as "Login failed" without ever prompting (issue #3, Adaluin).
  it("prompts for the 2FA code on mfa-required from /v2/login-params and resubmits with mfa_<key>=code", async () => {
    let getLoginParamsCalls = 0;
    getLoginParamsMock.mockImplementation(async (_cfg, _email, _challenge, extra?: Record<string, string>) => {
      getLoginParamsCalls += 1;
      if (getLoginParamsCalls === 1) {
        // First attempt: server demands MFA.
        throw new SnApiError(
          "Please enter your two-factor authentication code.",
          "mfa-required",
          401,
          { mfa_key: "mfa_1a2b3c" },
        );
      }
      // Second attempt: the MFA code has to be in the body, under the key the
      // server gave us. Anything else means the wrong endpoint got the code.
      expect(extra).toEqual({ mfa_1a2b3c: "654321" });
      return {
        identifier: "a@b.co",
        pw_nonce: "deadbeef".repeat(8),
        version: "004",
      };
    });
    loginMock.mockResolvedValue({
      session: {
        access_token: "tok",
        refresh_token: "ref",
        access_expiration: 0,
        refresh_expiration: 0,
      },
      key_params: {
        version: "004",
        identifier: "a@b.co",
        pw_nonce: "deadbeef".repeat(8),
      },
      user: { uuid: "u-uuid", email: "a@b.co" },
    });
    syncMock.mockResolvedValue({
      retrieved_items: [],
      saved_items: [],
      conflicts: [],
      sync_token: "tok",
    });

    const mfaPrompt = vi.fn().mockResolvedValue("654321");

    await expect(
      createClientFromLogin(
        { serverUrl: "https://example.test", email: "a@b.co" },
        "correct horse battery staple",
        mfaPrompt,
      ),
    ).rejects.toThrow(/No items_key decrypted/);

    expect(mfaPrompt).toHaveBeenCalledTimes(1);
    expect(getLoginParamsMock).toHaveBeenCalledTimes(2);
    expect(loginMock).toHaveBeenCalledTimes(1);
    // Login must never see the MFA code — that's a /v2/login-params concern.
    const loginArgs = loginMock.mock.calls[0];
    expect(loginArgs).toHaveLength(4);
  });

  it("fails fast (without ever calling login) when 2FA is enabled but no mfaPrompt is provided", async () => {
    getLoginParamsMock.mockRejectedValueOnce(
      new SnApiError(
        "Please enter your two-factor authentication code.",
        "mfa-required",
        401,
        { mfa_key: "mfa_1a2b3c" },
      ),
    );

    await expect(
      createClientFromLogin(
        { serverUrl: "https://example.test", email: "a@b.co" },
        "correct horse battery staple",
      ),
    ).rejects.toThrow(/Two-factor authentication is enabled/);

    expect(loginMock).not.toHaveBeenCalled();
  });
});

describe("SnClient Advanced Checklist methods", () => {
  const serverUrl = "https://example.test";
  const email = "a@b.co";
  const checklistUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const plainUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const itemsKeyUuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  afterEach(() => {
    syncMock.mockReset();
    loadSessionMock.mockReset();
    saveSessionMock.mockReset();
  });

  // Builds a real (decryptable) vault snapshot: one wrapped items_key, one
  // Advanced Checklist note carrying `initialChecklist`, and one plain note.
  async function bootClient(initialChecklist: AdvancedChecklist) {
    await sodiumReady();
    const masterKey = await randomBytes(32);
    const wrappingKey = await generateItemsKeyRaw();
    const realItemsKey = await generateItemsKeyRaw();
    const ikAad = { u: itemsKeyUuid, v: "004", kp: { version: "004" } };
    const iso = new Date("2026-09-08T00:00:00.000Z").toISOString();

    const itemsKeyRaw = {
      uuid: itemsKeyUuid,
      content_type: "SN|ItemsKey",
      enc_item_key: await encryptString(await toHex(wrappingKey), masterKey, ikAad),
      content: await encryptString(
        JSON.stringify({ version: "004", itemsKey: await toHex(realItemsKey) }),
        wrappingKey,
        ikAad,
      ),
      items_key_id: null,
      created_at: iso,
      updated_at: iso,
      created_at_timestamp: 1,
      updated_at_timestamp: 1,
      deleted: false,
    };

    const mkNote = async (
      uuid: string,
      text: string,
      editor: "advanced-checklist" | undefined,
      ts: number,
    ) => {
      const enc = await encryptNote(
        {
          uuid,
          title: editor ? "Groceries" : "Notes",
          text,
          noteType: editor ? "task" : "plain-text",
          editor,
        },
        { uuid: itemsKeyUuid, itemsKey: realItemsKey },
      );
      return {
        uuid,
        content_type: "Note",
        content: enc.content,
        enc_item_key: enc.enc_item_key,
        items_key_id: enc.items_key_id,
        created_at: iso,
        updated_at: iso,
        created_at_timestamp: ts,
        updated_at_timestamp: ts,
        deleted: false,
      };
    };

    const checklistNote = await mkNote(
      checklistUuid,
      serializeChecklist(initialChecklist),
      "advanced-checklist",
      2,
    );
    const plainNote = await mkNote(plainUuid, "just text", undefined, 3);

    loadSessionMock.mockResolvedValue({
      serverUrl,
      email,
      sessionPayload: { access_token: "tok", refresh_token: "ref" },
      masterKeyHex: await toHex(masterKey),
      keyParams: { version: "004", identifier: email, pw_nonce: "n" },
      syncToken: null,
      savedAt: iso,
    });

    let pulled = false;
    const pushed: unknown[][] = [];
    syncMock.mockImplementation(
      async (_cfg: unknown, params: { items?: unknown[] }) => {
        if (params.items && params.items.length > 0) {
          pushed.push(params.items);
          const now = Date.now() * 1000;
          return {
            retrieved_items: [],
            saved_items: (params.items as Record<string, unknown>[]).map((i) => ({
              ...i,
              updated_at: new Date().toISOString(),
              updated_at_timestamp: now,
            })),
            conflicts: [],
            sync_token: "tok-after-push",
          };
        }
        if (!pulled) {
          pulled = true;
          return {
            retrieved_items: [itemsKeyRaw, checklistNote, plainNote],
            saved_items: [],
            conflicts: [],
            sync_token: "tok-1",
          };
        }
        return {
          retrieved_items: [],
          saved_items: [],
          conflicts: [],
          sync_token: "tok-n",
        };
      },
    );

    const client = await createClientFromSession({ serverUrl, email });
    return { client, pushed };
  }

  const oneGroup = (): AdvancedChecklist => ({
    schemaVersion: "1.0.0",
    groups: [{ name: "Shopping", tasks: [] }],
  });

  it("addChecklistGroup persists a new group and pushes an encrypted note", async () => {
    const { client, pushed } = await bootClient({
      schemaVersion: "1.0.0",
      groups: [],
    });

    await client.addChecklistGroup({ uuid: checklistUuid, name: "Shopping" });

    const note = await client.getNote(checklistUuid);
    const parsed = JSON.parse(note!.text);
    expect(parsed.groups.map((g: { name: string }) => g.name)).toEqual([
      "Shopping",
    ]);
    expect(note!.editor).toBe("advanced-checklist");
    expect(pushed).toHaveLength(1);
    expect((pushed[0]![0] as { content: string }).content).toMatch(/^004:/);
  });

  it("addChecklistTask returns the new id and inserts it at the front", async () => {
    const { client } = await bootClient({
      schemaVersion: "1.0.0",
      groups: [
        {
          name: "Shopping",
          tasks: [
            {
              id: "old",
              description: "Bread",
              completed: false,
              createdAt: "2026-09-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    const id = await client.addChecklistTask({
      uuid: checklistUuid,
      groupName: "Shopping",
      description: "Buy milk",
    });

    const parsed = JSON.parse((await client.getNote(checklistUuid))!.text);
    expect(parsed.groups[0].tasks.map((t: { id: string }) => t.id)).toEqual([
      id,
      "old",
    ]);
    expect(parsed.groups[0].tasks[0]).toMatchObject({
      description: "Buy milk",
      completed: false,
    });
  });

  it("toggleChecklistTask completes, timestamps and moves the task to the top", async () => {
    const { client } = await bootClient({
      schemaVersion: "1.0.0",
      groups: [
        {
          name: "Shopping",
          tasks: [
            { id: "a", description: "A", completed: false, createdAt: "x" },
            { id: "b", description: "B", completed: false, createdAt: "x" },
          ],
        },
      ],
    });

    await client.toggleChecklistTask({
      uuid: checklistUuid,
      groupName: "Shopping",
      taskId: "b",
      completed: true,
    });

    const parsed = JSON.parse((await client.getNote(checklistUuid))!.text);
    expect(parsed.groups[0].tasks.map((t: { id: string }) => t.id)).toEqual([
      "b",
      "a",
    ]);
    expect(parsed.groups[0].tasks[0].completed).toBe(true);
    expect(typeof parsed.groups[0].tasks[0].completedAt).toBe("string");
  });

  it("updateChecklistTask and deleteChecklistTask mutate the right task", async () => {
    const { client } = await bootClient({
      schemaVersion: "1.0.0",
      groups: [
        {
          name: "Shopping",
          tasks: [
            { id: "a", description: "A", completed: false, createdAt: "x" },
            { id: "b", description: "B", completed: false, createdAt: "x" },
          ],
        },
      ],
    });

    await client.updateChecklistTask({
      uuid: checklistUuid,
      groupName: "Shopping",
      taskId: "a",
      description: "A2",
    });
    await client.deleteChecklistTask({
      uuid: checklistUuid,
      groupName: "Shopping",
      taskId: "b",
    });

    const parsed = JSON.parse((await client.getNote(checklistUuid))!.text);
    expect(parsed.groups[0].tasks).toHaveLength(1);
    expect(parsed.groups[0].tasks[0]).toMatchObject({ id: "a", description: "A2" });
  });

  it("renameChecklistGroup and deleteChecklistGroup work by name", async () => {
    const { client } = await bootClient({
      schemaVersion: "1.0.0",
      groups: [
        { name: "Shopping", tasks: [] },
        { name: "Work", tasks: [] },
      ],
    });

    await client.renameChecklistGroup({
      uuid: checklistUuid,
      groupName: "Shopping",
      newName: "Groceries",
    });
    await client.deleteChecklistGroup({
      uuid: checklistUuid,
      groupName: "Work",
    });

    const parsed = JSON.parse((await client.getNote(checklistUuid))!.text);
    expect(parsed.groups.map((g: { name: string }) => g.name)).toEqual([
      "Groceries",
    ]);
  });

  it("rejects an unknown note, a non-checklist note and an unknown group", async () => {
    const { client } = await bootClient(oneGroup());

    await expect(
      client.addChecklistGroup({ uuid: plainUuid, name: "x" }),
    ).rejects.toThrow(/not an Advanced Checklist/);

    await expect(
      client.addChecklistTask({
        uuid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        groupName: "Shopping",
        description: "x",
      }),
    ).rejects.toThrow(/not found/);

    await expect(
      client.addChecklistTask({
        uuid: checklistUuid,
        groupName: "Nope",
        description: "x",
      }),
    ).rejects.toThrow(/group "Nope" not found/);
  });
});
