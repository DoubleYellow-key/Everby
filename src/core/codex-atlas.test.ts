import { describe, expect, it } from "vitest";
import { createCodexRuntime } from "./codex-atlas";

describe("createCodexRuntime", () => {
  it("maps an 8x9 character atlas and builds a responsive interaction combo", () => {
    const runtime = createCodexRuntime({ id: "daily", name: "Daily", description: "Programmer", sheetUrl: "pet://daily/spritesheet.webp" });
    expect(runtime.animations).toHaveLength(14);
    expect(runtime.animations.map((animation) => animation.id)).toEqual([
      "idle", "run-right", "run-left", "wave", "jump", "failed", "stretch", "working", "review",
      "interaction", "impatient", "acknowledge", "double-wave", "deep-review"
    ]);
    expect(runtime.animations[0].frames).toHaveLength(10);
    expect(runtime.animations[1].frames).toHaveLength(8);
    expect(runtime.animations[0].frames[0]).toMatchObject({ x: 0, y: 0, width: 192, height: 208 });
    expect(runtime.animations.find((animation) => animation.id === "wave")?.frames[0].durationMs).toBe(220);
    expect(runtime.animations.find((animation) => animation.id === "run-left")?.intents).toEqual([]);
    const working = runtime.animations.find((animation) => animation.id === "working")!;
    expect(working.frames).toHaveLength(10);
    expect(working.frames.map((frame) => frame.x / 192)).toEqual([0, 1, 2, 3, 4, 5, 4, 3, 2, 1]);
    expect(working.frames.reduce((sum, frame) => sum + frame.durationMs, 0)).toBe(4_000);
    const stretch = runtime.animations.find((animation) => animation.id === "stretch")!;
    expect(stretch.loop).toBe(false);
    expect(stretch.frames.at(-2)).toMatchObject({ x: 5 * 192, y: 6 * 208, durationMs: 420 });
    expect(stretch.frames.at(-1)).toMatchObject({ x: 0, y: 0, durationMs: 180 });
    const interaction = runtime.animations.find((item) => item.id === "interaction")!;
    expect(interaction.loop).toBe(false);
    expect(interaction.frames.at(0)).toMatchObject({ x: 0, y: 0 });
    expect(interaction.frames.at(-1)).toMatchObject({ x: 0, y: 0 });
    expect(runtime.animations.find((item) => item.id === "impatient")).toMatchObject({ label: "不耐烦", loop: false });
    expect(runtime.animations.find((item) => item.id === "acknowledge")).toMatchObject({ label: "点头确认", loop: false });
    expect(runtime.animations.find((item) => item.id === "double-wave")).toMatchObject({ label: "双手回应", loop: false });
    expect(runtime.animations.find((item) => item.id === "deep-review")).toMatchObject({ label: "深度检查", loop: true });
    for (const id of ["wave", "jump", "failed", "acknowledge", "double-wave"]) {
      const frames = runtime.animations.find((item) => item.id === id)!.frames;
      expect(frames.at(-1)).toMatchObject({ x: frames[0].x, y: frames[0].y });
    }
  });
});
