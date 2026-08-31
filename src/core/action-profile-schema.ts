import { z } from "zod";

export const actionModeSchema = z.string().regex(/^(normal|state-[a-f0-9-]{8,64})$/);
const actionId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const eventBinding = z.object({ actionId, durationSeconds: z.number().int().min(1).max(300) }).strict();
const profileFields = {
  name: z.string().trim().min(1).max(30),
  activityRatio: z.number().min(0.05).max(0.95),
  strategy: z.enum(["weighted", "fixed"]),
  items: z.array(z.object({ actionId, weight: z.number().int().min(1).max(10) }).strict()).min(1).max(12),
  fallbackActionId: actionId,
  actionDurationSeconds: z.number().int().min(3).max(300),
  defaultDurationMinutes: z.number().int().min(0).max(480),
  eventActions: z.object({
    pet_click: eventBinding.optional(),
    conversation_intent: eventBinding.optional(),
    reminder: eventBinding.optional()
  }).strict()
};
export const createActionProfileSchema = z.object(profileFields).strict();
export const actionProfilePatchSchema = z.object(profileFields).strict();

export const startActionModeSchema = z.object({
  mode: actionModeSchema
}).strict();
