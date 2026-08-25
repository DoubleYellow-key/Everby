import { describe, expect, it } from "vitest";
import { actionProfilePatchSchema, startActionModeSchema } from "./action-profile-schema";

describe("action profile inputs", () => {
  it("accepts bounded activity targets and weights", () => {
    expect(actionProfilePatchSchema.parse({ activityRatio: 0.25, strategy: "weighted", items: [{ actionId: "working", weight: 3 }], fallbackActionId: "idle" }).activityRatio).toBe(0.25);
    expect(actionProfilePatchSchema.parse({ activityRatio: 0.9, strategy: "fixed", items: [{ actionId: "daily-focus-cycle", weight: 1 }], fallbackActionId: "working" }).activityRatio).toBe(0.9);
  });

  it("restricts focus and rest timers to supported presets", () => {
    expect(startActionModeSchema.parse({ mode: "focus", durationMinutes: 45 }).durationMinutes).toBe(45);
    expect(startActionModeSchema.parse({ mode: "rest", durationMinutes: 10 }).durationMinutes).toBe(10);
    expect(() => startActionModeSchema.parse({ mode: "focus", durationMinutes: 10 })).toThrow();
    expect(() => startActionModeSchema.parse({ mode: "rest", durationMinutes: 25 })).toThrow();
  });
});
