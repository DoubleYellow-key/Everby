import type { ActionMode, ActionProfile } from "../shared/contracts";

const values: Record<ActionMode, Omit<ActionProfile, "petId" | "updatedAt">> = {
  normal: {
    mode: "normal", activityRatio: 0.25, strategy: "weighted", fallbackActionId: "idle",
    items: [{ actionId: "working", weight: 3 }, { actionId: "review", weight: 2 }, { actionId: "wave", weight: 1 }, { actionId: "stretch", weight: 2 }, { actionId: "daily-reset-stretch", weight: 2 }]
  },
  focus: {
    mode: "focus", activityRatio: 0.9, strategy: "fixed", fallbackActionId: "working",
    items: [{ actionId: "daily-focus-cycle", weight: 1 }]
  },
  rest: {
    mode: "rest", activityRatio: 0.35, strategy: "weighted", fallbackActionId: "stretch",
    items: [{ actionId: "daily-reset-stretch", weight: 3 }, { actionId: "stretch", weight: 2 }]
  }
};

export function defaultActionProfiles(petId: string, now = Date.now()): ActionProfile[] {
  return (Object.keys(values) as ActionMode[]).map((mode) => ({ petId, ...values[mode], items: values[mode].items.map((item) => ({ ...item })), updatedAt: now }));
}
