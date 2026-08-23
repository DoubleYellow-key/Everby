import { describe, expect, it } from "vitest";
import { createCodexRuntime } from "./codex-atlas";

describe("createCodexRuntime", () => {
  it("maps an 8x9 character atlas to nine stable animations", () => {
    const runtime = createCodexRuntime({ id: "daily", name: "Daily", description: "Programmer", sheetUrl: "pet://daily/spritesheet.webp" });
    expect(runtime.animations).toHaveLength(9);
    expect(runtime.animations.map((animation) => animation.id)).toEqual([
      "idle", "run-right", "run-left", "wave", "jump", "failed", "stretch", "working", "review"
    ]);
    expect(runtime.animations[0].frames).toHaveLength(6);
    expect(runtime.animations[1].frames).toHaveLength(8);
    expect(runtime.animations[0].frames[0]).toMatchObject({ x: 0, y: 0, width: 192, height: 208 });
    expect(runtime.animations.find((animation) => animation.id === "wave")?.frames[0].durationMs).toBe(320);
    expect(runtime.animations.find((animation) => animation.id === "run-left")?.intents).toEqual([]);
    const working = runtime.animations.find((animation) => animation.id === "working")!;
    expect(working.frames).toHaveLength(12);
    expect(working.frames.map((frame) => frame.x / 192)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 0, 1]);
    expect(working.frames.reduce((sum, frame) => sum + frame.durationMs, 0)).toBe(4_800);
    const stretch = runtime.animations.find((animation) => animation.id === "stretch")!;
    expect(stretch.loop).toBe(false);
    expect(stretch.frames.at(-1)).toMatchObject({ x: 5 * 192, durationMs: 420 });
  });
});
