import { describe, expect, it } from "vitest";
import type { ActionRule } from "../shared/contracts";
import { isRoutineRuleActive, nextRoutineTriggerAt, selectEventRule } from "./action-rules";

function routine(overrides: Partial<ActionRule> = {}): ActionRule {
  return {
    id: "routine-1", petId: "daily", name: "Evening stretch", actionId: "stretch", enabled: true,
    durationSeconds: 8, trigger: { type: "routine", weekdays: [1, 2, 3, 4, 5], startTime: "22:00", endTime: "02:00", minIntervalMinutes: 10, maxIntervalMinutes: 20, probability: 1 },
    createdAt: Date.parse("2026-08-24T12:00:00Z"), updatedAt: Date.parse("2026-08-24T12:00:00Z"), lastTriggeredAt: null,
    ...overrides
  };
}

describe("action routine rules", () => {
  it("treats the after-midnight part of an overnight window as the previous weekday", () => {
    const rule = routine();
    expect(isRoutineRuleActive(rule, new Date("2026-08-25T01:00:00"))).toBe(true);
    expect(isRoutineRuleActive(rule, new Date("2026-08-24T03:00:00"))).toBe(false);
  });

  it("calculates the next trigger from the last persisted trigger within the configured range", () => {
    const rule = routine({ lastTriggeredAt: 1_000 });
    expect(nextRoutineTriggerAt(rule, () => 0)).toBe(1_000 + 10 * 60_000);
    expect(nextRoutineTriggerAt(rule, () => 1)).toBe(1_000 + 20 * 60_000);
  });
});

describe("event action rules", () => {
  const base = routine({
    id: "event-1", actionId: "wave", updatedAt: 100,
    trigger: { type: "event", event: "conversation_intent", intent: "greet", probability: 1, cooldownSeconds: 60 }
  });

  it("matches an available conversation intent after cooldown", () => {
    expect(selectEventRule([base], { event: "conversation_intent", intent: "greet" }, new Set(["wave"]), 120_000, () => 0)?.id).toBe("event-1");
  });

  it("rejects mismatched, unavailable, cooling-down, and failed-probability rules", () => {
    expect(selectEventRule([base], { event: "conversation_intent", intent: "work" }, new Set(["wave"]), 120_000, () => 0)).toBeNull();
    expect(selectEventRule([base], { event: "conversation_intent", intent: "greet" }, new Set(), 120_000, () => 0)).toBeNull();
    expect(selectEventRule([{ ...base, lastTriggeredAt: 90_000 }], { event: "conversation_intent", intent: "greet" }, new Set(["wave"]), 120_000, () => 0)).toBeNull();
    expect(selectEventRule([{ ...base, trigger: { ...base.trigger, probability: 0.25 } as ActionRule["trigger"] }], { event: "conversation_intent", intent: "greet" }, new Set(["wave"]), 120_000, () => 0.8)).toBeNull();
    expect(selectEventRule([{ ...base, trigger: { ...base.trigger, probability: 0 } as ActionRule["trigger"] }], { event: "conversation_intent", intent: "greet" }, new Set(["wave"]), 120_000, () => 0)).toBeNull();
  });

  it("lets the most recently updated matching rule override older mappings", () => {
    const newer = { ...base, id: "event-2", actionId: "jump", updatedAt: 200 };
    expect(selectEventRule([base, newer], { event: "conversation_intent", intent: "greet" }, new Set(["wave", "jump"]), 120_000, () => 0)?.id).toBe("event-2");
  });
});
