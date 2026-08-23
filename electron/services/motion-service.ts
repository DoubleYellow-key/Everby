import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import sharp from "sharp";
import yauzl from "yauzl";
import { parseMotionManifest, type MotionManifest } from "../../src/core/motion-manifest";
import type { PetAnimation } from "../../src/shared/contracts";

const MAX_UNPACKED = 100 * 1024 * 1024;
const unsafeEntry = (name: string): boolean => {
  const value = name.replaceAll("\\", "/");
  return value.startsWith("/") || /^[a-zA-Z]:/.test(value) || value.split("/").some((part) => part === ".." || !part) || /\.(exe|dll|bat|cmd|ps1|js|mjs|cjs|vbs|scr)$/i.test(value);
};

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolveOpen, reject) => yauzl.open(path, { lazyEntries: true }, (error, zip) => error || !zip ? reject(error ?? new Error("无法打开扩展包")) : resolveOpen(zip)));
}

async function extract(path: string, destination: string): Promise<void> {
  const zip = await openZip(path);
  let total = 0;
  let entries = 0;
  await new Promise<void>((resolveExtract, reject) => {
    zip.on("entry", (entry) => {
      entries += 1;
      if (entries > 2_000) return reject(new Error("扩展包文件数量超过 2000"));
      if (unsafeEntry(entry.fileName)) return reject(new Error("扩展包包含不安全路径"));
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (mode === 0o120000) return reject(new Error("扩展包不能包含符号链接"));
      total += entry.uncompressedSize;
      if (total > MAX_UNPACKED) return reject(new Error("扩展包解压后超过 100 MB"));
      const output = resolve(destination, normalize(entry.fileName));
      if (!output.startsWith(`${resolve(destination)}${sep}`)) return reject(new Error("扩展包路径越界"));
      if (entry.fileName.endsWith("/")) { void mkdir(output, { recursive: true }).then(() => zip.readEntry(), reject); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return reject(error ?? new Error("无法读取扩展资源"));
        void mkdir(dirname(output), { recursive: true }).then(() => new Promise<void>((done, fail) => {
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          stream.on("error", fail);
          stream.on("end", () => void writeFile(output, Buffer.concat(chunks)).then(done, fail));
        })).then(() => zip.readEntry(), reject);
      });
    });
    zip.on("end", resolveExtract);
    zip.on("error", reject);
    zip.readEntry();
  });
  zip.close();
}

export class MotionService {
  constructor(private readonly root: string) {}

  async install(archivePath: string, baseAnimationIds: Set<string>, targetPetId?: string): Promise<{ manifest: MotionManifest; path: string }> {
    const staging = join(this.root, `.staging-${crypto.randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      await extract(archivePath, staging);
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
          const metadata = await sharp(file).metadata();
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
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  async loadAnimations(packPath: string, packId: string, targetPetId: string): Promise<PetAnimation[]> {
    const manifest = parseMotionManifest(JSON.parse(await readFile(join(packPath, "motion.json"), "utf8")));
    if (manifest.targetPetId !== targetPetId) return [];
    return manifest.animations.map((animation) => ({
      id: animation.id,
      loop: animation.loop,
      weight: animation.weight,
      intents: animation.intents,
      frames: animation.frames.map((frame) => ({ x: 0, y: 0, width: 192, height: 208, durationMs: frame.durationMs, src: `souldesk://motion/${packId}/${frame.src}` }))
    }));
  }
}
