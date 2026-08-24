import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MotionService } from "./motion-service";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));

describe("MotionService example extension", () => {
  it("installs and loads all three labelled Daily actions from the real archive", async () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-motion-test-")); directories.push(directory);
    const service = new MotionService(directory);
    const installed = await service.install(resolve("examples/motions/daily-routines.soulmotion"), new Set(["idle", "wave", "jump"]), "daily");
    const actions = await service.loadAnimations(installed.path, installed.manifest.packId, "daily", installed.manifest.name, true);
    expect(actions.map((action) => action.id)).toEqual(["daily-cheer-combo", "daily-focus-cycle", "daily-reset-stretch"]);
    expect(actions.map((action) => action.label)).toEqual(["欢呼组合", "专注循环", "舒展恢复"]);
    expect(actions.every((action) => action.source === "extension" && action.enabled)).toBe(true);
    expect(actions.flatMap((action) => action.frames).every((frame) => frame.src?.startsWith("everby://motion/daily-routines/"))).toBe(true);
  });

  it("rejects importing the Daily extension for another role", async () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-motion-test-")); directories.push(directory);
    await expect(new MotionService(directory).install(resolve("examples/motions/daily-routines.soulmotion"), new Set(), "boba")).rejects.toThrow("动作扩展不适用于当前角色");
  });
});
