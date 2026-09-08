import { describe, expect, it, vi } from "vitest";
import type { SnClient } from "../sn/client.js";
import type { Note } from "../sn/types.js";
import { registerChecklistHandlers } from "./checklist.js";

const NOTE_UUID = "11111111-1111-4111-8111-111111111111";

function fullNote(over: Partial<Note> = {}): Note {
  return {
    uuid: NOTE_UUID,
    title: "Groceries",
    text: '{"schemaVersion":"1.0.0","groups":[]}',
    createdAt: "2026-04-14T00:00:00Z",
    updatedAt: "2026-04-15T00:00:00Z",
    trashed: false,
    protected: false,
    locked: false,
    tags: [],
    noteType: "task",
    editor: "advanced-checklist",
    ...over,
  };
}

function fakeClient(over: Partial<SnClient> = {}): SnClient {
  return {
    listNotes: vi.fn(async () => []),
    searchNotes: vi.fn(async () => []),
    getNote: vi.fn(async () => fullNote()),
    createNote: vi.fn(async () => NOTE_UUID),
    createNotesBatch: vi.fn(async () => []),
    updateNote: vi.fn(async () => undefined),
    deleteNote: vi.fn(async () => undefined),
    addChecklistGroup: vi.fn(async () => undefined),
    renameChecklistGroup: vi.fn(async () => undefined),
    deleteChecklistGroup: vi.fn(async () => undefined),
    addChecklistTask: vi.fn(async () => "task-generated-id"),
    updateChecklistTask: vi.fn(async () => undefined),
    toggleChecklistTask: vi.fn(async () => undefined),
    deleteChecklistTask: vi.fn(async () => undefined),
    stats: vi.fn(async () => ({
      notes: { total: 0, active: 0, trashed: 0 },
      tags: 0,
      byNoteType: {},
      totalTextBytes: 0,
      averageTextBytes: 0,
      largest: null,
      oldest: null,
      newest: null,
    })),
    listTags: vi.fn(async () => []),
    getTag: vi.fn(async () => null),
    createTag: vi.fn(async () => "22222222-2222-4222-8222-222222222222"),
    updateTag: vi.fn(async () => undefined),
    deleteTag: vi.fn(async () => undefined),
    attachTag: vi.fn(async () => undefined),
    detachTag: vi.fn(async () => undefined),
    sync: vi.fn(async () => ({
      notes: 0,
      tags: 0,
      syncedAt: "2026-04-15T00:00:00Z",
    })),
    ...over,
  };
}

describe("checklist tools", () => {
  it("notes_checklist_create makes an advanced-checklist note with an empty body", async () => {
    const c = fakeClient();
    const h = registerChecklistHandlers(c);

    const res = await h.notes_checklist_create({ title: "Groceries" });

    expect(res).toEqual({ uuid: NOTE_UUID });
    expect(c.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Groceries",
        editor: "advanced-checklist",
        text: expect.stringContaining('"groups": []'),
      }),
    );
    expect(c.sync).toHaveBeenCalled();
  });

  it("notes_checklist_add_task forwards args and returns the taskId", async () => {
    const c = fakeClient();
    const h = registerChecklistHandlers(c);

    const res = await h.notes_checklist_add_task({
      uuid: NOTE_UUID,
      groupName: "Shopping",
      description: "Buy milk",
    });

    expect(res).toEqual({ taskId: "task-generated-id" });
    expect(c.addChecklistTask).toHaveBeenCalledWith({
      uuid: NOTE_UUID,
      groupName: "Shopping",
      description: "Buy milk",
    });
    expect(c.sync).toHaveBeenCalled();
  });

  it("notes_checklist_set_task_completed forwards the completed flag", async () => {
    const c = fakeClient();
    const h = registerChecklistHandlers(c);

    await h.notes_checklist_set_task_completed({
      uuid: NOTE_UUID,
      groupName: "Shopping",
      taskId: "t1",
      completed: true,
    });

    expect(c.toggleChecklistTask).toHaveBeenCalledWith({
      uuid: NOTE_UUID,
      groupName: "Shopping",
      taskId: "t1",
      completed: true,
    });
  });

  it("refuses to edit a protected or locked note", async () => {
    const locked = fakeClient({
      getNote: vi.fn(async () => fullNote({ locked: true })),
    });
    const h = registerChecklistHandlers(locked);

    await expect(
      h.notes_checklist_add_group({ uuid: NOTE_UUID, name: "Shopping" }),
    ).rejects.toThrow(/edit-locked/);
    expect(locked.addChecklistGroup).not.toHaveBeenCalled();

    const prot = fakeClient({
      getNote: vi.fn(async () => fullNote({ protected: true })),
    });
    const hp = registerChecklistHandlers(prot);
    await expect(
      hp.notes_checklist_delete_task({
        uuid: NOTE_UUID,
        groupName: "Shopping",
        taskId: "t1",
      }),
    ).rejects.toThrow(/protected/);
  });

  it("validates input: bad uuid, empty group name, empty description", async () => {
    const h = registerChecklistHandlers(fakeClient());

    await expect(
      h.notes_checklist_add_group({ uuid: "not-a-uuid", name: "x" }),
    ).rejects.toThrow();
    await expect(
      h.notes_checklist_add_group({ uuid: NOTE_UUID, name: "" }),
    ).rejects.toThrow();
    await expect(
      h.notes_checklist_add_task({
        uuid: NOTE_UUID,
        groupName: "Shopping",
        description: "",
      }),
    ).rejects.toThrow();
  });
});
