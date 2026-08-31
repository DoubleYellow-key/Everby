import { describe, expect, it } from "vitest";
import { createActionRuleSchema } from "./action-rule-schema";
import { DAILY_DEFAULT_ACTION_RULES } from "./default-action-rules";

describe("Daily default action rules", () => {
  it("provides editable rules accepted by the public rule schema", () => {
    expect(DAILY_DEFAULT_ACTION_RULES).toHaveLength(6);
    expect(DAILY_DEFAULT_ACTION_RULES.map((rule) => createActionRuleSchema.parse(rule).name)).toEqual([
      "点击互动", "打招呼时挥手", "庆祝回应", "提醒时欢呼", "专注陪伴", "疲劳时舒展"
    ]);
    expect(DAILY_DEFAULT_ACTION_RULES[0]).toMatchObject({
      actionId: "interaction",
      trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 0 }
    });
    expect(DAILY_DEFAULT_ACTION_RULES[1]).toMatchObject({
      actionId: "wave",
      trigger: { type: "event", event: "conversation_intent", intent: "greet", probability: 1, cooldownSeconds: 5 }
    });
  });
});
