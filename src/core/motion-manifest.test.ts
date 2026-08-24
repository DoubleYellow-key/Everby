import { describe, expect, it } from "vitest";
import { parseMotionManifest } from "./motion-manifest";

describe("motion manifest", () => {
  const valid = {
    formatVersion: 1,
    packId: "daily-dance",
    version: "1.0.0",
    name: "Daily Dance",
    targetPetId: "daily",
    canvas: { width: 192, height: 208, anchorX: 96, anchorY: 208 },
    animations: [{ id: "dance", label: "庆祝舞步", loop: true, weight: 1, intents: ["celebrate"], frames: [{ src: "assets/dance/000.webp", durationMs: 100 }] }]
  };

  it("accepts a constrained extension manifest", () => {
    expect(parseMotionManifest(valid).animations[0].label).toBe("庆祝舞步");
  });

  it("rejects traversal and executable assets", () => {
    expect(() => parseMotionManifest({ ...valid, animations: [{ ...valid.animations[0], frames: [{ src: "../run.js", durationMs: 100 }] }] })).toThrow();
  });

  it("requires the desktop pet canvas contract", () => {
    expect(() => parseMotionManifest({ ...valid, canvas: { ...valid.canvas, width: 320 } })).toThrow();
  });
});
