export const ADVANCED_CHECKLIST_SCHEMA_VERSION = "1.0.0";

export interface ChecklistTask {
  id: string;
  description: string;
  completed?: boolean;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface ChecklistGroup {
  name: string;
  collapsed?: boolean;
  draft?: string;
  lastActive?: string;
  tasks: ChecklistTask[];
}

// The plugin's runtime state also carries `initialized` / `legacyContent` /
// `lastError`, but those are UI-only — it never persists them to the note. We
// model just the two keys that live on disk.
export interface AdvancedChecklist {
  schemaVersion: string;
  groups: ChecklistGroup[];
}

export function createChecklist(): AdvancedChecklist {
  return {
    schemaVersion: ADVANCED_CHECKLIST_SCHEMA_VERSION,
    groups: [],
  };
}

// Mirrors the Advanced Checklist plugin's `tasksLoaded` reducer: an empty body
// is a fresh empty checklist, and `schemaVersion` / `groups` both fall back to
// defaults rather than being required. Only genuinely un-parseable JSON or a
// wrong-typed field is rejected. We also drop any extra top-level keys
// (`initialized`, `lastError`, `legacyContent`) — the plugin only ever persists
// `{ schemaVersion, groups }`.
export function parseChecklist(text: string): AdvancedChecklist {
  const raw = text.trim() === "" ? "{}" : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Advanced Checklist JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Advanced Checklist structure");
  }

  const candidate = parsed as Record<string, unknown>;

  if (
    candidate.schemaVersion !== undefined &&
    typeof candidate.schemaVersion !== "string"
  ) {
    throw new Error("Invalid Advanced Checklist structure");
  }
  if (candidate.groups !== undefined && !Array.isArray(candidate.groups)) {
    throw new Error("Invalid Advanced Checklist structure");
  }

  return {
    schemaVersion:
      (candidate.schemaVersion as string | undefined) ??
      ADVANCED_CHECKLIST_SCHEMA_VERSION,
    groups: (candidate.groups as ChecklistGroup[] | undefined) ?? [],
  };
}

// Byte-for-byte the same shape the plugin writes back to `content.text`:
// pretty-printed with a 2-space indent, and only the two persisted keys.
export function serializeChecklist(checklist: AdvancedChecklist): string {
  return JSON.stringify(
    { schemaVersion: checklist.schemaVersion, groups: checklist.groups },
    null,
    2,
  );
}

export function addGroup(
  checklist: AdvancedChecklist,
  name: string,
): AdvancedChecklist {
  // The plugin keys groups by name (`tasksGroupAdded` is a no-op when the name
  // already exists), and our whole API addresses groups by name — a duplicate
  // would be permanently unreachable.
  if (checklist.groups.some((group) => group.name === name)) {
    throw new Error(`Checklist group "${name}" already exists`);
  }

  return {
    ...checklist,
    groups: [
      ...checklist.groups,
      {
        name,
        tasks: [],
      },
    ],
  };
}

export function renameGroup(
  checklist: AdvancedChecklist,
  groupIndex: number,
  name: string,
): AdvancedChecklist {
  const group = checklist.groups[groupIndex];

  if (!group) {
    throw new Error(`Checklist group ${groupIndex} not found`);
  }

  if (
    name !== group.name &&
    checklist.groups.some((item) => item.name === name)
  ) {
    throw new Error(`Checklist group "${name}" already exists`);
  }

  return {
    ...checklist,
    groups: checklist.groups.map((item, index) =>
      index === groupIndex ? { ...item, name } : item,
    ),
  };
}

export function deleteGroup(
  checklist: AdvancedChecklist,
  groupIndex: number,
): AdvancedChecklist {
  if (!checklist.groups[groupIndex]) {
    throw new Error(`Checklist group ${groupIndex} not found`);
  }

  return {
    ...checklist,
    groups: checklist.groups.filter((_, index) => index !== groupIndex),
  };
}

export function addTask(
  checklist: AdvancedChecklist,
  groupIndex: number,
  description: string,
  id: string,
  createdAt: string,
): AdvancedChecklist {
  const group = checklist.groups[groupIndex];

  if (!group) {
    throw new Error(`Checklist group ${groupIndex} not found`);
  }

  const task: ChecklistTask = {
    id,
    description,
    completed: false,
    createdAt,
  };

  return {
    ...checklist,
    groups: checklist.groups.map((item, index) => {
      if (index !== groupIndex) return item;
      // The plugin's `taskAdded` clears the group's unsaved "new task" draft.
      const { draft: _draft, ...rest } = item;
      return { ...rest, tasks: [task, ...item.tasks] };
    }),
  };
}

export function updateTask(
  checklist: AdvancedChecklist,
  groupIndex: number,
  taskId: string,
  updates: {
    description?: string;
    updatedAt?: string;
  },
): AdvancedChecklist {
  const group = checklist.groups[groupIndex];

  if (!group) {
    throw new Error(`Checklist group ${groupIndex} not found`);
  }

  if (!group.tasks.some((task) => task.id === taskId)) {
    throw new Error(`Checklist task ${taskId} not found`);
  }

  return {
    ...checklist,
    groups: checklist.groups.map((item, index) =>
      index === groupIndex
        ? {
            ...item,
            tasks: item.tasks.map((task) =>
              task.id === taskId ? { ...task, ...updates } : task,
            ),
          }
        : item,
    ),
  };
}

export function deleteTask(
  checklist: AdvancedChecklist,
  groupIndex: number,
  taskId: string,
): AdvancedChecklist {
  const group = checklist.groups[groupIndex];

  if (!group) {
    throw new Error(`Checklist group ${groupIndex} not found`);
  }

  if (!group.tasks.some((task) => task.id === taskId)) {
    throw new Error(`Checklist task ${taskId} not found`);
  }

  return {
    ...checklist,
    groups: checklist.groups.map((item, index) =>
      index === groupIndex
        ? {
            ...item,
            tasks: item.tasks.filter((task) => task.id !== taskId),
          }
        : item,
    ),
  };
}

export function toggleTask(
  checklist: AdvancedChecklist,
  groupIndex: number,
  taskId: string,
  completed: boolean,
  updatedAt: string,
): AdvancedChecklist {
  const group = checklist.groups[groupIndex];

  if (!group) {
    throw new Error(`Checklist group ${groupIndex} not found`);
  }

  if (!group.tasks.some((task) => task.id === taskId)) {
    throw new Error(`Checklist task ${taskId} not found`);
  }

  return {
    ...checklist,
    groups: checklist.groups.map((item, index) => {
      if (index !== groupIndex) return item;

      const current = item.tasks.find((task) => task.id === taskId)!;
      const toggled: ChecklistTask = {
        ...current,
        completed,
        updatedAt,
        ...(completed
          ? { completedAt: updatedAt }
          : { completedAt: undefined }),
      };

      // The plugin's `taskToggled` moves the just-toggled task to the top of
      // the group.
      return {
        ...item,
        tasks: [toggled, ...item.tasks.filter((task) => task.id !== taskId)],
      };
    }),
  };
}
