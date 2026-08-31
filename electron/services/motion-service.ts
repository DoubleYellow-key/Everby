import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import { parseMotionManifest, type MotionManifest } from "../../src/core/motion-manifest";
import type { PetAnimation } from "../../src/shared/contracts";
import { extractZip } from "./zip-extract";

export class MotionService {
  constructor(private readonly root: string) {}

  async install(archivePath: string, baseAnimationIds: Set<string>, targetPetId?: string): Promise<{ manifest: MotionManifest; path: string }> {
    const staging = join(this.root, `.staging-${crypto.randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      await extractZip(archivePath, staging);
      const manifest = parseMotionManifest(JSON.parse(await readFile(join(staging, "motion.json"), "utf8")));
      if (targetPetId && manifest.targetPetId !== targetPetId) throw new Error("动作扩展不适用于当前角色");
      const destination = join(this.root, manifest.packId);
      try {
        const installed = parseMotionManifest(JSON.parse(await readFile(join(destination, "motion.json"), "utf8")));
        const current = installed.version.split(".").map(Number); const incoming = manifest.version.split(".").map(Number);
        const newer = incoming.some((value, index) => value > current[index] && incoming.slice(0, index).every((part, partIndex) => part === current[partIndex]));
        if (!newer) throw new Error(`动作扩展必须高于已安装版本 ${installed.version}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("动作扩展必须")) throw error;
      }
      const extensionIds = new Set<string>();
      for (const directory of await readdir(this.root, { withFileTypes: true }).catch(() => [])) {
        if (!directory.isDirectory() || directory.name.startsWith(".staging-") || directory.name === manifest.packId) continue;
        try {
          const installed = parseMotionManifest(JSON.parse(await readFile(join(this.root, directory.name, "motion.json"), "utf8")));
          installed.animations.forEach((animation) => extensionIds.add(animation.id));
        } catch { /* Broken disabled packs are ignored and can be removed from settings. */ }
      }
      for (const animation of manifest.animations) {
        if (baseAnimationIds.has(animation.id) || extensionIds.has(animation.id)) throw new Error(`动作 ${animation.id} 与已有动作冲突`);
        for (const frame of animation.frames) {
          const file = resolve(staging, frame.src);
          if (!file.startsWith(`${resolve(staging)}${sep}`)) throw new Error("动作资源路径越界");
          const metadata = await sharp(await readFile(file)).metadata();
          if (metadata.width !== 192 || metadata.height !== 208 || !metadata.hasAlpha) throw new Error("动作帧必须是 192x208 透明图像");
        }
      }
      await mkdir(this.root, { recursive: true });
      const backup = `${destination}.backup`;
      await rm(backup, { recursive: true, force: true });
      try { await rename(destination, backup); } catch { /* Fresh install. */ }
      try { await rename(staging, destination); await rm(backup, { recursive: true, force: true }); }
      catch (error) { try { await rename(backup, destination); } catch { /* No previous version. */ } throw error; }
      return { manifest, path: destination };
    } catch (error) {
      await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
      throw error;
    }
  }

  async readManifest(packPath: string): Promise<MotionManifest> {
    return parseMotionManifest(JSON.parse(await readFile(join(packPath, "motion.json"), "utf8")));
  }

  async loadAnimations(packPath: string, packId: string, targetPetId: string, packName = packId, enabled = true): Promise<PetAnimation[]> {
    const manifest = await this.readManifest(packPath);
    if (manifest.targetPetId !== targetPetId) return [];
    return manifest.animations.map((animation) => ({
      id: animation.id,
      label: animation.label,
      loop: animation.loop,
      weight: animation.weight,
      intents: animation.intents,
      source: "extension",
      packId,
      packName,
      enabled,
      frames: animation.frames.map((frame) => ({ x: 0, y: 0, width: 192, height: 208, durationMs: frame.durationMs, src: `everby://motion/${packId}/${frame.src}` }))
    }));
  }
}
