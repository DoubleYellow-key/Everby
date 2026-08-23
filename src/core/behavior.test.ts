import { describe, expect, it } from "vitest";
import { chooseAnimation, resolveDecision } from "./behavior";

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
});
