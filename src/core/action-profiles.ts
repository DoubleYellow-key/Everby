import type { ActionProfile } from "../shared/contracts";

export function defaultActionProfiles(petId: string, now = Date.now()): ActionProfile[] {
  return [{
    petId, mode: "normal", name: "常规", activityRatio: 0.25, strategy: "weighted", fallbackActionId: "idle",
    items: [{ actionId: "working", weight: 3 }, { actionId: "review", weight: 2 }, { actionId: "wave", weight: 1 }, { actionId: "stretch", weight: 2 }, { actionId: "daily-reset-stretch", weight: 2 }],
    actionDurationSeconds: 15, defaultDurationMinutes: 0, eventActions: {}, updatedAt: now
  }];
}
