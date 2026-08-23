import { describe, expect, it } from "vitest";
import { frameAtTime } from "./timeline";

describe("frameAtTime", () => {
  const frames = [
    { x: 0, y: 0, width: 1, height: 1, durationMs: 100 },
    { x: 1, y: 0, width: 1, height: 1, durationMs: 200 }
  ];

  it("respects per-frame timing and loops", () => {
    expect(frameAtTime(frames, 99, true)).toBe(0);
    expect(frameAtTime(frames, 100, true)).toBe(1);
    expect(frameAtTime(frames, 300, true)).toBe(0);
  });

  it("holds the last frame for non-looping actions", () => {
    expect(frameAtTime(frames, 999, false)).toBe(1);
  });
});
