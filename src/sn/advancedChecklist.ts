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

export interface AdvancedChecklist {
  schemaVersion: string;
  groups: ChecklistGroup[];
  initialized?: boolean;
  legacyContent?: ChecklistGroup;
  lastError?: string;
}

export function createChecklist(): AdvancedChecklist {
  return {
    schemaVersion: ADVANCED_CHECKLIST_SCHEMA_VERSION,
    groups: [],
  };
}

export function parseChecklist(text: string): AdvancedChecklist {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid Advanced Checklist JSON");
  }

  if (!isAdvancedChecklist(parsed)) {
    throw new Error("Invalid Advanced Checklist structure");
  }

  return parsed;
}

export function serializeChecklist(checklist: AdvancedChecklist): string {
  return JSON.stringify(checklist);
}

function isAdvancedChecklist(value: unknown): value is AdvancedChecklist {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.schemaVersion === "string" &&
    Array.isArray(candidate.groups)
  );
}

export function addGroup(
  checklist: AdvancedChecklist,
  name: string,
): AdvancedChecklist {
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
    groups: checklist.groups.map((item, index) =>
      index === groupIndex
        ? { ...item, tasks: [...item.tasks, task] }
        : item,
    ),
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
    groups: checklist.groups.map((item, index) =>
      index === groupIndex
        ? {
            ...item,
            tasks: item.tasks.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    completed,
                    updatedAt,
                    ...(completed
                      ? { completedAt: updatedAt }
                      : { completedAt: undefined }),
                  }
                : task,
            ),
          }
        : item,
    ),
  };
}
