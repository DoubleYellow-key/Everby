import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MotionService } from "../electron/services/motion-service";

const [archivePath] = process.argv.slice(2).filter((value) => value !== "--");
if (!archivePath) throw new Error("用法: pnpm motion:validate -- <file.soulmotion>");
const directory = await mkdtemp(join(tmpdir(), "souldesk-motion-"));
try {
  const result = await new MotionService(directory).install(resolve(archivePath), new Set(["idle", "run-right", "run-left", "wave", "jump", "failed", "stretch", "working", "review"]));
  console.log(`验证通过：${result.manifest.name} v${result.manifest.version}，${result.manifest.animations.length} 个动作`);
} finally { await rm(directory, { recursive: true, force: true }); }
