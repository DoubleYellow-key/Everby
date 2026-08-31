import { describe, expect, it } from "vitest";
import { actionPriority, createDirectorState, switchDirectorMode, tickDirector } from "./action-director";
import type { ActionMode, ActionProfile, PetAnimation } from "../shared/contracts";

const loop: PetAnimation = { id: "working", label: "Work", loop: true, weight: 1, intents: ["work"], frames: [{ x: 0, y: 0, width: 1, height: 1, durationMs: 500 }] };
const short: PetAnimation = { id: "stretch", label: "Stretch", loop: false, weight: 1, intents: ["tired"], frames: [{ x: 0, y: 0, width: 1, height: 1, durationMs: 3_000 }] };

function profile(mode: ActionMode, activityRatio: number, actionId = "working"): ActionProfile {
  return {
    petId: "daily", mode, name: mode === "normal" ? "常规" : "工作", activityRatio, strategy: "fixed",
    items: [{ actionId, weight: 1 }], fallbackActionId: actionId, actionDurationSeconds: 90,
    defaultDurationMinutes: mode === "normal" ? 0 : 45, eventActions: {}, updatedAt: 0
  };
}

function simulate(value: ActionProfile, animation: PetAnimation): number {
  let state = createDirectorState(0); let now = 0; let active = 0;
  while (now < 3_600_000) {
    const result = tickDirector(state, { now, profile: value, animations: [animation], paused: false, locked: false, random: () => 0 });
    state = result.state;
    if (result.request) { active += result.request.durationSeconds; now += result.request.durationSeconds * 1_000; }
    else now += 1_000;
  }
  return active / 3_600;
}

describe("ActionDirector time budget", () => {
  it("defines the fixed action priority order", () => {
    expect(["drag", "preview", "reminder", "conversation", "pet_click", "state"].map((source) => actionPriority(source as Parameters<typeof actionPriority>[0]))).toEqual([100, 90, 80, 70, 60, 10]);
  });

  it("converges on normal, focus and rest activity targets", () => {
    expect(simulate(profile("normal", 0.25), loop)).toBeCloseTo(0.25, 1);
    expect(simulate(profile("state-12345678", 0.7), loop)).toBeCloseTo(0.7, 1);
    expect(simulate(profile("state-12345678", 0.9), loop)).toBeCloseTo(0.9, 1);
    expect(simulate({ ...profile("state-87654321", 0.35, "stretch"), actionDurationSeconds: 12 }, short)).toBeCloseTo(0.35, 1);
  });

  it("does not burst on startup and starts focus immediately", () => {
    const normal = profile("normal", 0.25);
    expect(tickDirector(createDirectorState(0), { now: 0, profile: normal, animations: [loop], paused: false, locked: false }).request).toBeNull();
    const focus = profile("state-12345678", 0.7);
    const state = switchDirectorMode(createDirectorState(0), focus.mode, focus, 1_000);
    expect(tickDirector(state, { now: 1_000, profile: focus, animations: [loop], paused: false, locked: false }).request?.actionId).toBe("working");
    expect(tickDirector(state, { now: 1_000, profile: focus, animations: [loop], paused: false, locked: false }).request?.durationSeconds).toBe(90);
    const rest = { ...profile("state-87654321", 0.35, "stretch"), actionDurationSeconds: 12 };
    const restState = switchDirectorMode(createDirectorState(0), rest.mode, rest, 1_000);
    expect(tickDirector(restState, { now: 1_000, profile: rest, animations: [short], paused: false, locked: false }).request?.actionId).toBe("stretch");
  });

  it("pauses background selection while locked", () => {
    const value = profile("normal", 0.25);
    const state = createDirectorState(0);
    expect(tickDirector(state, { now: 120_000, profile: value, animations: [loop], paused: false, locked: true }).request).toBeNull();
  });

  it("falls back when an extension action is disabled", () => {
    const extension = { ...loop, id: "daily-focus-cycle", source: "extension" as const, enabled: false };
    const value: ActionProfile = { ...profile("state-12345678", 0.7, extension.id), fallbackActionId: "working" };
    const state = switchDirectorMode(createDirectorState(0), value.mode, value, 1_000);
    expect(tickDirector(state, { now: 1_000, profile: value, animations: [extension, loop], paused: false, locked: false }).request?.actionId).toBe("working");
  });
});
