import { describe, expect, it } from "vitest";
import { createCodexRuntime } from "./codex-atlas";

describe("createCodexRuntime", () => {
  it("maps an 8x9 character atlas to nine stable animations", () => {
    const runtime = createCodexRuntime({ id: "daily", name: "Daily", description: "Programmer", sheetUrl: "pet://daily/spritesheet.webp" });
    expect(runtime.animations).toHaveLength(9);
    expect(runtime.animations.map((animation) => animation.id)).toEqual([
      "idle", "run-right", "run-left", "wave", "jump", "failed", "waiting", "working", "review"
    ]);
    expect(runtime.animations[0].frames).toHaveLength(6);
    expect(runtime.animations[1].frames).toHaveLength(8);
    expect(runtime.animations[0].frames[0]).toMatchObject({ x: 0, y: 0, width: 192, height: 208 });
  });
});
