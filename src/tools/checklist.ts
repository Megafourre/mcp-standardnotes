import { z } from "zod";
import type { SnClient } from "../sn/client.js";
import {
  createChecklist,
  serializeChecklist,
} from "../sn/advancedChecklist.js";
import type { Note } from "../sn/types.js";

export const uuidSchema = z.string().uuid();

const groupNameSchema = z.string().min(1).max(256);
const descriptionSchema = z.string().min(1).max(2000);

export const checklistCreateInput = z.object({
  title: z.string().max(500),
  tags: z.array(uuidSchema).max(64).optional(),
});

export const checklistAddGroupInput = z.object({
  uuid: uuidSchema,
  name: groupNameSchema,
});

export const checklistRenameGroupInput = z.object({
  uuid: uuidSchema,
  groupName: groupNameSchema,
  newName: groupNameSchema,
});

export const checklistDeleteGroupInput = z.object({
  uuid: uuidSchema,
  groupName: groupNameSchema,
});

export const checklistAddTaskInput = z.object({
  uuid: uuidSchema,
  groupName: groupNameSchema,
  description: descriptionSchema,
});

export const checklistUpdateTaskInput = z.object({
  uuid: uuidSchema,
  groupName: groupNameSchema,
  taskId: z.string().min(1).max(128),
  description: descriptionSchema,
});

export const checklistSetTaskCompletedInput = z.object({
  uuid: uuidSchema,
  groupName: groupNameSchema,
  taskId: z.string().min(1).max(128),
  completed: z.boolean(),
});

export const checklistDeleteTaskInput = z.object({
  uuid: uuidSchema,
  groupName: groupNameSchema,
  taskId: z.string().min(1).max(128),
});

// Checklist mutations are writes — mirror notes_update and refuse a note the
// user has protected (needs re-auth) or edit-locked.
function assertWritable(note: Note | null, uuid: string): void {
  if (note && (note.protected || note.locked)) {
    const reason = note.protected ? "protected" : "edit-locked";
    throw new Error(
      `Note ${uuid} is ${reason} — cannot edit its checklist via MCP. ` +
        `Unlock it in the Standard Notes app first.`,
    );
  }
}

export function registerChecklistHandlers(client: SnClient) {
  const guard = async (uuid: string) => {
    assertWritable(await client.getNote(uuid), uuid);
  };

  return {
    notes_checklist_create: async (raw: unknown) => {
      const { title, tags } = checklistCreateInput.parse(raw);
      const uuid = await client.createNote({
        title,
        text: serializeChecklist(createChecklist()),
        editor: "advanced-checklist",
        tags,
      });
      await client.sync();
      return { uuid };
    },
    notes_checklist_add_group: async (raw: unknown) => {
      const { uuid, name } = checklistAddGroupInput.parse(raw);
      await guard(uuid);
      await client.addChecklistGroup({ uuid, name });
      await client.sync();
      return { ok: true };
    },
    notes_checklist_rename_group: async (raw: unknown) => {
      const { uuid, groupName, newName } = checklistRenameGroupInput.parse(raw);
      await guard(uuid);
      await client.renameChecklistGroup({ uuid, groupName, newName });
      await client.sync();
      return { ok: true };
    },
    notes_checklist_delete_group: async (raw: unknown) => {
      const { uuid, groupName } = checklistDeleteGroupInput.parse(raw);
      await guard(uuid);
      await client.deleteChecklistGroup({ uuid, groupName });
      await client.sync();
      return { ok: true };
    },
    notes_checklist_add_task: async (raw: unknown) => {
      const { uuid, groupName, description } =
        checklistAddTaskInput.parse(raw);
      await guard(uuid);
      const taskId = await client.addChecklistTask({
        uuid,
        groupName,
        description,
      });
      await client.sync();
      return { taskId };
    },
    notes_checklist_update_task: async (raw: unknown) => {
      const { uuid, groupName, taskId, description } =
        checklistUpdateTaskInput.parse(raw);
      await guard(uuid);
      await client.updateChecklistTask({ uuid, groupName, taskId, description });
      await client.sync();
      return { ok: true };
    },
    notes_checklist_set_task_completed: async (raw: unknown) => {
      const { uuid, groupName, taskId, completed } =
        checklistSetTaskCompletedInput.parse(raw);
      await guard(uuid);
      await client.toggleChecklistTask({ uuid, groupName, taskId, completed });
      await client.sync();
      return { ok: true };
    },
    notes_checklist_delete_task: async (raw: unknown) => {
      const { uuid, groupName, taskId } = checklistDeleteTaskInput.parse(raw);
      await guard(uuid);
      await client.deleteChecklistTask({ uuid, groupName, taskId });
      await client.sync();
      return { ok: true };
    },
  };
}

export type ChecklistHandlers = ReturnType<typeof registerChecklistHandlers>;
