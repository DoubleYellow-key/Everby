import { z } from "zod";

export const actionModeSchema = z.enum(["normal", "focus", "rest"]);
const actionId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const actionProfilePatchSchema = z.object({
  activityRatio: z.number().min(0.05).max(0.95),
  strategy: z.enum(["weighted", "fixed"]),
  items: z.array(z.object({ actionId, weight: z.number().int().min(1).max(10) }).strict()).min(1).max(12),
  fallbackActionId: actionId
}).strict();

export const startActionModeSchema = z.object({
  mode: z.enum(["focus", "rest"]),
  durationMinutes: z.number().int()
}).strict().superRefine((value, context) => {
  const allowed = value.mode === "focus" ? [25, 45, 60] : [5, 10, 15];
  if (!allowed.includes(value.durationMinutes)) context.addIssue({ code: "custom", path: ["durationMinutes"], message: "模式时长不受支持" });
});
