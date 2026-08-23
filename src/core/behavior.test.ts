import { describe, expect, it } from "vitest";
import { chooseAnimation, chooseLocalBehavior, fallbackConversationIntent, resolveDecision } from "./behavior";

describe("behavior mapping", () => {
  it("maps a validated semantic intent to an available character action", () => {
    expect(chooseAnimation("greet", [{ id: "idle", intents: ["idle"] }, { id: "wave", intents: ["greet", "happy"] }], () => 0)).toBe("wave");
  });

  it("falls back to idle when the intent is unavailable", () => {
    expect(chooseAnimation("tired", [{ id: "idle", intents: ["idle"] }], () => 0)).toBe("idle");
  });

  it("sanitizes malformed model decisions", () => {
    expect(resolveDecision({ actionIntent: "destroy", mood: 42 })).toEqual({ actionIntent: "idle", mood: "calm", memoryCandidates: [] });
  });

  it("keeps walking rare and favors quiet desk behaviors", () => {
    expect(chooseLocalBehavior(0.01, false).id).toBe("run-right");
    expect(chooseLocalBehavior(0.01, true).id).toBe("run-left");
    expect(chooseLocalBehavior(0.08, false).id).toBe("working");
    expect(chooseLocalBehavior(0.55, false).id).toBe("stretch");
    expect(chooseLocalBehavior(0.75, false).id).toBe("review");
    expect(chooseLocalBehavior(0.95, false).id).toBe("idle");
  });

  it("keeps coding visible and lets stretching finish before returning to idle", () => {
    expect(chooseLocalBehavior(0.08, false)).toMatchObject({ minDurationMs: 18_000, maxDurationMs: 30_000 });
    expect(chooseLocalBehavior(0.55, false)).toMatchObject({ minDurationMs: 2_730, maxDurationMs: 2_730 });
  });

  it("keeps emotional feedback visible when the behavior model is unavailable", () => {
    expect(fallbackConversationIntent("测试已经全部通过，完成了")).toBe("celebrate");
    expect(fallbackConversationIntent("别担心，我们继续试试")).toBe("encourage");
    expect(fallbackConversationIntent("让我想想这个问题？")).toBe("think");
    expect(fallbackConversationIntent("今天随便聊聊")).toBe("happy");
  });
});
