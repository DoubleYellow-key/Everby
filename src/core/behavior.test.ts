import { describe, expect, it } from "vitest";
import { chooseAnimation, fallbackConversationIntent, resolveDecision } from "./behavior";

describe("behavior mapping", () => {
  it("maps a validated semantic intent to an available character action", () => {
    expect(chooseAnimation("greet", [{ id: "idle", intents: ["idle"] }, { id: "wave", intents: ["greet", "happy"] }], () => 0)).toBe("wave");
  });

  it("falls back to idle when the intent is unavailable", () => {
    expect(chooseAnimation("tired", [{ id: "idle", intents: ["idle"] }], () => 0)).toBe("idle");
  });

  it("sanitizes malformed model decisions", () => {
    expect(resolveDecision({ actionIntent: "destroy", mood: 42 })).toEqual({ actionIntent: "idle", mood: "calm", memoryCandidates: [], todoOperations: [] });
  });

  it("accepts only bounded todo operations from the model", () => {
    expect(resolveDecision({
      actionIntent: "happy", mood: "helpful", memoryCandidates: [],
      todoOperations: [{ type: "create", title: "喝水", remindAt: 2_000, repeat: "daily" }, { type: "complete", title: "写周报" }]
    }).todoOperations).toEqual([
      { type: "create", title: "喝水", remindAt: 2_000, repeat: "daily" }, { type: "complete", title: "写周报" }
    ]);
    expect(resolveDecision({ actionIntent: "happy", mood: "calm", todoOperations: [{ type: "delete", title: "everything" }] }).todoOperations).toEqual([]);
  });

  it("keeps emotional feedback visible when the behavior model is unavailable", () => {
    expect(fallbackConversationIntent("测试已经全部通过，完成了")).toBe("celebrate");
    expect(fallbackConversationIntent("别担心，我们继续试试")).toBe("encourage");
    expect(fallbackConversationIntent("让我想想这个问题？")).toBe("think");
    expect(fallbackConversationIntent("今天随便聊聊")).toBe("happy");
  });
});
