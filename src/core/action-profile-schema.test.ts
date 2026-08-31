import { describe, expect, it } from "vitest";
import { actionProfilePatchSchema, createActionProfileSchema, startActionModeSchema } from "./action-profile-schema";

const profile = {
  name: "工作", activityRatio: 0.75, strategy: "fixed" as const,
  items: [{ actionId: "working", weight: 1 }], fallbackActionId: "working",
  actionDurationSeconds: 90, defaultDurationMinutes: 45,
  eventActions: { pet_click: { actionId: "impatient", durationSeconds: 3 } }
};

describe("action profile inputs", () => {
  it("accepts bounded activity targets and weights", () => {
    expect(actionProfilePatchSchema.parse(profile).activityRatio).toBe(0.75);
    expect(createActionProfileSchema.parse(profile).eventActions.pet_click?.actionId).toBe("impatient");
  });

  it("accepts generated custom state ids and rejects arbitrary ids", () => {
    expect(startActionModeSchema.parse({ mode: "state-12345678" }).mode).toBe("state-12345678");
    expect(() => startActionModeSchema.parse({ mode: "focus" })).toThrow();
    expect(() => actionProfilePatchSchema.parse({ ...profile, defaultDurationMinutes: 481 })).toThrow();
  });
});
