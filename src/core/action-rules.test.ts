import { describe, expect, it } from "vitest";
import type { ActionProfile, ActionRule } from "../shared/contracts";
import { selectEventRule, selectProfileEventAction } from "./action-rules";

function eventRule(overrides: Partial<ActionRule> = {}): ActionRule {
  return {
    id: "event-1", petId: "daily", name: "Click stretch", actionId: "stretch", enabled: true,
    durationSeconds: 8, trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 0 },
    createdAt: Date.parse("2026-08-24T12:00:00Z"), updatedAt: Date.parse("2026-08-24T12:00:00Z"), lastTriggeredAt: null,
    ...overrides
  };
}

describe("event action rules", () => {
  const base = eventRule({
    id: "event-1", actionId: "wave", updatedAt: 100,
    trigger: { type: "event", event: "conversation_intent", intent: "greet", probability: 1, cooldownSeconds: 60 }
  });

  it("prefers an available event action from the active state", () => {
    const profile: ActionProfile = {
      petId: "daily", mode: "state-12345678", name: "工作", activityRatio: 0.8, strategy: "fixed",
      items: [{ actionId: "working", weight: 1 }], fallbackActionId: "working", actionDurationSeconds: 90,
      defaultDurationMinutes: 45, eventActions: { pet_click: { actionId: "impatient", durationSeconds: 3 } }, updatedAt: 0
    };
    expect(selectProfileEventAction(profile, "pet_click", new Set(["impatient"]))).toEqual({ actionId: "impatient", durationSeconds: 3 });
    expect(selectProfileEventAction(profile, "pet_click", new Set(["working"]))).toBeNull();
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
