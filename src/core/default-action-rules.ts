import type { CreateActionRuleInput } from "../shared/contracts";

export const DAILY_GREETING_ACTION_RULE: CreateActionRuleInput = {
  name: "打招呼时挥手", actionId: "wave", enabled: true, durationSeconds: 4,
  trigger: { type: "event", event: "conversation_intent", intent: "greet", probability: 1, cooldownSeconds: 5 }
};

export const DAILY_DEFAULT_ACTION_RULES: CreateActionRuleInput[] = [
  {
    name: "点击互动", actionId: "interaction", enabled: true, durationSeconds: 3,
    trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 0 }
  },
  DAILY_GREETING_ACTION_RULE,
  {
    name: "庆祝回应", actionId: "daily-cheer-combo", enabled: true, durationSeconds: 4,
    trigger: { type: "event", event: "conversation_intent", intent: "celebrate", probability: 1, cooldownSeconds: 5 }
  },
  {
    name: "提醒时欢呼", actionId: "daily-cheer-combo", enabled: true, durationSeconds: 4,
    trigger: { type: "event", event: "reminder", probability: 1, cooldownSeconds: 30 }
  },
  {
    name: "专注陪伴", actionId: "daily-focus-cycle", enabled: true, durationSeconds: 12,
    trigger: { type: "event", event: "conversation_intent", intent: "work", probability: 1, cooldownSeconds: 10 }
  },
  {
    name: "疲劳时舒展", actionId: "daily-reset-stretch", enabled: true, durationSeconds: 6,
    trigger: { type: "event", event: "conversation_intent", intent: "tired", probability: 1, cooldownSeconds: 30 }
  },
];
