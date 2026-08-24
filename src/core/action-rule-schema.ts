import { z } from "zod";
import { ACTION_INTENTS } from "../shared/contracts";

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const probability = z.number().min(0).max(1);

const routineTriggerSchema = z.object({
  type: z.literal("routine"),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine((days) => new Set(days).size === days.length, "星期不能重复"),
  startTime: clockTime,
  endTime: clockTime,
  minIntervalMinutes: z.number().int().min(1).max(10_080),
  maxIntervalMinutes: z.number().int().min(1).max(10_080),
  probability
}).strict().refine((value) => value.maxIntervalMinutes >= value.minIntervalMinutes, { message: "最大间隔不能小于最小间隔", path: ["maxIntervalMinutes"] });

const eventTriggerSchema = z.object({
  type: z.literal("event"),
  event: z.enum(["pet_click", "conversation_intent", "reminder"]),
  intent: z.enum(ACTION_INTENTS).optional(),
  probability,
  cooldownSeconds: z.number().int().min(0).max(86_400)
}).strict().superRefine((value, context) => {
  if (value.event === "conversation_intent" && !value.intent) context.addIssue({ code: "custom", path: ["intent"], message: "对话事件必须选择语义意图" });
  if (value.event !== "conversation_intent" && value.intent) context.addIssue({ code: "custom", path: ["intent"], message: "该事件不接受语义意图" });
});

export const actionRuleTriggerSchema = z.union([routineTriggerSchema, eventTriggerSchema]);
export const createActionRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  actionId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  enabled: z.boolean(),
  durationSeconds: z.number().int().min(1).max(60),
  trigger: actionRuleTriggerSchema
}).strict();
export const updateActionRuleSchema = createActionRuleSchema.partial().strict();
