import { resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("Everby application icon", () => {
  it("ships a square high-resolution icon with transparency", async () => {
    const metadata = await sharp(resolve("build/icon.png")).metadata();
    expect(metadata).toMatchObject({ width: 1024, height: 1024, format: "png", hasAlpha: true });
  });
});
