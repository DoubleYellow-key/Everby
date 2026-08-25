import { describe, expect, it } from "vitest";
import { createActionRuleSchema } from "./action-rule-schema";

describe("action rule input", () => {
  it("accepts a bounded reminder event", () => {
    expect(createActionRuleSchema.parse({
      name: "Reminder stretch", actionId: "stretch", enabled: true, durationSeconds: 8,
      trigger: { type: "event", event: "reminder", cooldownSeconds: 30, probability: 0.5 }
    }).trigger.type).toBe("event");
  });

  it("rejects removed routine schedules", () => {
    const input = {
      name: "Invalid", actionId: "idle", enabled: true, durationSeconds: 8,
      trigger: { type: "routine", weekdays: [], startTime: "08:00", endTime: "18:00", minIntervalMinutes: 30, maxIntervalMinutes: 10, probability: 1 }
    };
    expect(() => createActionRuleSchema.parse(input)).toThrow();
  });

  it("requires an intent only for conversation mappings", () => {
    const base = { name: "Chat", actionId: "wave", enabled: true, durationSeconds: 5 };
    expect(() => createActionRuleSchema.parse({ ...base, trigger: { type: "event", event: "conversation_intent", probability: 1, cooldownSeconds: 0 } })).toThrow();
    expect(createActionRuleSchema.parse({ ...base, trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 0 } }).trigger.type).toBe("event");
  });
});
