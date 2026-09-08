import { describe, expect, it } from "vitest";
import {
  ADVANCED_CHECKLIST_SCHEMA_VERSION,
  addGroup,
  addTask,
  createChecklist,
  deleteGroup,
  deleteTask,
  parseChecklist,
  renameGroup,
  serializeChecklist,
  toggleTask,
  updateTask,
} from "./advancedChecklist.js";

describe("advanced checklist", () => {
  it("creates an empty checklist with the expected schema version", () => {
    expect(createChecklist()).toEqual({
      schemaVersion: ADVANCED_CHECKLIST_SCHEMA_VERSION,
      groups: [],
    });
  });

  it("parses a valid checklist", () => {
    const checklist = parseChecklist(
      JSON.stringify({
        schemaVersion: "1.0.0",
        groups: [
          {
            name: "Shopping",
            tasks: [
              {
                id: "task-1",
                description: "Milk",
                completed: false,
                createdAt: "2026-09-08T00:00:00.000Z",
              },
            ],
          },
        ],
      }),
    );

    expect(checklist.groups[0]?.name).toBe("Shopping");
    expect(checklist.groups[0]?.tasks[0]?.description).toBe("Milk");
  });

  it("serializes a checklist", () => {
    const checklist = createChecklist();

    expect(serializeChecklist(checklist)).toBe(
      '{"schemaVersion":"1.0.0","groups":[]}',
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => parseChecklist("not json")).toThrow(
      "Invalid Advanced Checklist JSON",
    );
  });

  it("rejects invalid checklist structure", () => {
    expect(() => parseChecklist(JSON.stringify({ groups: [] }))).toThrow(
      "Invalid Advanced Checklist structure",
    );
  });

  it("adds a group", () => {
    const checklist = addGroup(createChecklist(), "Shopping");

    expect(checklist.groups).toEqual([
      {
        name: "Shopping",
        tasks: [],
      },
    ]);
  });

  it("renames a group", () => {
    const checklist = addGroup(createChecklist(), "Shopping");
    const renamed = renameGroup(checklist, 0, "Groceries");

    expect(renamed.groups[0]?.name).toBe("Groceries");
  });

  it("deletes a group", () => {
    let checklist = createChecklist();
    checklist = addGroup(checklist, "Shopping");
    checklist = addGroup(checklist, "Work");

    const result = deleteGroup(checklist, 0);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.name).toBe("Work");
  });

  it("adds a task to a group", () => {
    const checklist = addGroup(createChecklist(), "Shopping");

    const result = addTask(
      checklist,
      0,
      "Buy milk",
      "task-1",
      "2026-09-08T10:00:00.000Z",
    );

    expect(result.groups[0]?.tasks).toEqual([
      {
        id: "task-1",
        description: "Buy milk",
        completed: false,
        createdAt: "2026-09-08T10:00:00.000Z",
      },
    ]);
  });

  it("updates a task", () => {
    let checklist = addGroup(createChecklist(), "Shopping");
    checklist = addTask(
      checklist,
      0,
      "Buy milk",
      "task-1",
      "2026-09-08T10:00:00.000Z",
    );

    const result = updateTask(checklist, 0, "task-1", {
      description: "Buy oat milk",
      updatedAt: "2026-09-08T11:00:00.000Z",
    });

    expect(result.groups[0]?.tasks[0]).toMatchObject({
      id: "task-1",
      description: "Buy oat milk",
      updatedAt: "2026-09-08T11:00:00.000Z",
    });
  });

  it("deletes a task", () => {
    let checklist = addGroup(createChecklist(), "Shopping");
    checklist = addTask(
      checklist,
      0,
      "Buy milk",
      "task-1",
      "2026-09-08T10:00:00.000Z",
    );

    const result = deleteTask(checklist, 0, "task-1");

    expect(result.groups[0]?.tasks).toEqual([]);
  });

  it("completes a task and records completedAt", () => {
    let checklist = addGroup(createChecklist(), "Shopping");
    checklist = addTask(
      checklist,
      0,
      "Buy milk",
      "task-1",
      "2026-09-08T10:00:00.000Z",
    );

    const result = toggleTask(
      checklist,
      0,
      "task-1",
      true,
      "2026-09-08T11:00:00.000Z",
    );

    expect(result.groups[0]?.tasks[0]).toMatchObject({
      id: "task-1",
      completed: true,
      completedAt: "2026-09-08T11:00:00.000Z",
      updatedAt: "2026-09-08T11:00:00.000Z",
    });
  });

  it("uncompletes a task and clears completedAt", () => {
    let checklist = addGroup(createChecklist(), "Shopping");
    checklist = addTask(
      checklist,
      0,
      "Buy milk",
      "task-1",
      "2026-09-08T10:00:00.000Z",
    );

    checklist = toggleTask(
      checklist,
      0,
      "task-1",
      true,
      "2026-09-08T11:00:00.000Z",
    );

    const result = toggleTask(
      checklist,
      0,
      "task-1",
      false,
      "2026-09-08T12:00:00.000Z",
    );

    expect(result.groups[0]?.tasks[0]).toMatchObject({
      id: "task-1",
      completed: false,
      updatedAt: "2026-09-08T12:00:00.000Z",
    });
    expect(result.groups[0]?.tasks[0]?.completedAt).toBeUndefined();
  });

  it("does not mutate the original checklist", () => {
    const original = addGroup(createChecklist(), "Shopping");
    const result = addGroup(original, "Work");

    expect(original.groups).toHaveLength(1);
    expect(result.groups).toHaveLength(2);
  });

  it("rejects operations on a missing group", () => {
    expect(() => renameGroup(createChecklist(), 0, "Shopping")).toThrow(
      "Checklist group 0 not found",
    );

    expect(() =>
      addTask(
        createChecklist(),
        0,
        "Milk",
        "task-1",
        "2026-09-08T10:00:00.000Z",
      ),
    ).toThrow("Checklist group 0 not found");
  });

  it("rejects operations on a missing task", () => {
    const checklist = addGroup(createChecklist(), "Shopping");

    expect(() =>
      updateTask(checklist, 0, "missing", { description: "Milk" }),
    ).toThrow("Checklist task missing not found");

    expect(() => deleteTask(checklist, 0, "missing")).toThrow(
      "Checklist task missing not found",
    );

    expect(() =>
      toggleTask(
        checklist,
        0,
        "missing",
        true,
        "2026-09-08T11:00:00.000Z",
      ),
    ).toThrow("Checklist task missing not found");
  });
});
