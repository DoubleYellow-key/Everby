import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import yazl from "yazl";
import { parseMotionManifest } from "../src/core/motion-manifest";

const [specPath, outputPath] = process.argv.slice(2).filter((value) => value !== "--");
if (!specPath || !outputPath) throw new Error("用法: pnpm motion:build -- <motion.json> <output.soulmotion>");
const absoluteSpec = resolve(specPath);
const manifest = parseMotionManifest(JSON.parse(await readFile(absoluteSpec, "utf8")));
const zip = new yazl.ZipFile();
zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), "motion.json");
const packedFiles = new Set<string>();
for (const animation of manifest.animations) {
  for (const frame of animation.frames) {
    const archivePath = frame.src.replaceAll("\\", "/");
    if (packedFiles.has(archivePath)) continue;
    packedFiles.add(archivePath);
    zip.addFile(resolve(dirname(absoluteSpec), frame.src), archivePath);
  }
}
await new Promise<void>((done, fail) => {
  zip.outputStream.on("error", fail).pipe(createWriteStream(resolve(outputPath))).on("error", fail).on("close", done);
  zip.end();
});
console.log(`已生成 ${resolve(outputPath)}：${manifest.animations.length} 个动作`);
