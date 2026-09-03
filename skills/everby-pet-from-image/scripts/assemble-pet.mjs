#!/usr/bin/env node
// 把逐行帧图组装成 Everby 1536x1872 图集。
// 输入约定: <帧目录>/row<0-8>/<列号,从0开始>.png(支持 png/webp)
// 用法: node <本脚本路径> <帧目录> <输出角色目录> --id <petId> [--name 显示名] [--description 描述]
// 在 SoulDesk 仓库根目录运行:sharp 从当前工作目录的 node_modules 解析。
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const cwdRequire = createRequire(join(process.cwd(), "noop.js"));
let sharp;
try {
  sharp = cwdRequire("sharp");
} catch {
  console.error("找不到 sharp:请在 SoulDesk 仓库根目录运行(需要项目的 node_modules)");
  process.exit(2);
}

const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const COLUMNS = 8;
const ROWS = 9;
// 每行实际被使用的帧数,与 src/core/codex-atlas.ts 的 FRAME_COUNTS 保持一致
const EXPECTED = [6, 8, 8, 4, 5, 8, 6, 6, 6];
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

const [framesDir, outputDir, ...rest] = process.argv.slice(2);
if (!framesDir || !outputDir) {
  console.error("用法: node assemble-pet.mjs <帧目录> <输出角色目录> --id <petId> [--name 显示名] [--description 描述]");
  process.exit(2);
}
const arg = (name, fallback = "") => { const index = rest.indexOf(`--${name}`); return index >= 0 && rest[index + 1] ? rest[index + 1] : fallback; };
const id = arg("id");
if (!SAFE_ID.test(id)) throw new Error("--id 必填且须符合规则:字母或数字开头,只能包含字母、数字、_ 和 -");
const name = arg("name", id);
const description = arg("description");

async function toCell(path) {
  // 去透明边缘(全透明帧 trim 会抛错,回退原图),等比缩放进单元格,底部居中对齐
  const source = await readFile(path);
  const trimmed = await sharp(source).trim().toBuffer().catch(() => null);
  return sharp(trimmed ?? source)
    .resize({ width: FRAME_WIDTH, height: FRAME_HEIGHT, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, position: sharp.gravity.south })
    .png()
    .toBuffer();
}

const composites = [];
const warnings = [];
for (let row = 0; row < ROWS; row += 1) {
  const rowDir = join(framesDir, `row${row}`);
  const files = (await readdir(rowDir).catch(() => []))
    .filter((file) => /^\d+\.(png|webp)$/i.test(file))
    .sort((left, right) => Number.parseInt(left) - Number.parseInt(right));
  if (files.length === 0) { warnings.push(`row${row} 没有帧,该行动画将是空白`); continue; }
  if (files.length < EXPECTED[row]) warnings.push(`row${row} 只有 ${files.length} 帧,该动作需要 ${EXPECTED[row]} 帧`);
  for (let column = 0; column < Math.min(files.length, COLUMNS); column += 1) {
    composites.push({ input: await toCell(join(rowDir, files[column])), left: column * FRAME_WIDTH, top: row * FRAME_HEIGHT });
  }
}
if (composites.length === 0) throw new Error("没有找到任何帧图(需要 <帧目录>/row<0-8>/<列号>.png)");

await mkdir(outputDir, { recursive: true });
const { data: atlasPixels, info: atlasInfo } = await sharp({
  create: {
    width: FRAME_WIDTH * COLUMNS,
    height: FRAME_HEIGHT * ROWS,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

// Some image generators leave arbitrary RGB values under fully transparent
// pixels. Zero them before WebP encoding so every renderer previews the atlas
// consistently and transparent padding cannot produce colored blocks.
for (let offset = 0; offset < atlasPixels.length; offset += 4) {
  if (atlasPixels[offset + 3] !== 0) continue;
  atlasPixels[offset] = 0;
  atlasPixels[offset + 1] = 0;
  atlasPixels[offset + 2] = 0;
}

await sharp(atlasPixels, { raw: atlasInfo })
  .webp({ lossless: true })
  .toFile(join(outputDir, "spritesheet.webp"));

const petJsonPath = join(outputDir, "pet.json");
const existing = await readFile(petJsonPath, "utf8").catch(() => null);
if (existing === null) {
  await writeFile(petJsonPath, `${JSON.stringify({ id, displayName: name, description, spritesheetPath: "spritesheet.webp", kind: "character" }, null, 2)}\n`);
}

console.log(JSON.stringify({ output: outputDir, frames: composites.length, warnings }, null, 2));
