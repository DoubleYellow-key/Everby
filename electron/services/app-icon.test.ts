import { readFile } from "node:fs/promises";
import { posix, resolve, win32 } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { resolveAppIconPath } from "./app-icon";

describe("Everby application icon", () => {
  it("ships a square high-resolution icon with transparency", async () => {
    const metadata = await sharp(resolve("build/icon.png")).metadata();
    expect(metadata).toMatchObject({ width: 1024, height: 1024, format: "png", hasAlpha: true });
  });

  it("ships a native multi-resolution Windows icon", async () => {
    const icon = await readFile(resolve("build/icon.ico"));
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBeGreaterThanOrEqual(5);
  });

  it("uses the Windows icon in development and packaged builds", () => {
    expect(resolveAppIconPath({ appPath: "C:\\Everby", isPackaged: false, platform: "win32", resourcesPath: "C:\\resources" }))
      .toBe(win32.join("C:\\Everby", "build/icon.ico"));
    expect(resolveAppIconPath({ appPath: "C:\\Everby", isPackaged: true, platform: "win32", resourcesPath: "C:\\resources" }))
      .toBe(win32.join("C:\\resources", "app-icon.ico"));
  });

  it("uses the PNG icon for POSIX development and packaged builds", () => {
    expect(resolveAppIconPath({ appPath: "/opt/Everby", isPackaged: false, platform: "darwin", resourcesPath: "/opt/resources" }))
      .toBe(posix.join("/opt/Everby", "build/icon.png"));
    expect(resolveAppIconPath({ appPath: "/opt/Everby", isPackaged: true, platform: "linux", resourcesPath: "/opt/resources" }))
      .toBe(posix.join("/opt/resources", "app-icon.png"));
  });
});
