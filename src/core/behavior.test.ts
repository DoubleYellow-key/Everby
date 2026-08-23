import { describe, expect, it } from "vitest";
import { chooseAnimation, chooseLocalBehavior, resolveDecision } from "./behavior";

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
});
