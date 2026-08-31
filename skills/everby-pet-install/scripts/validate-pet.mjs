#!/usr/bin/env node
// 校验 Everby/Petdex 角色目录,输出 JSON 判定。
// 用法: node <本脚本路径> <角色目录>
// 在 SoulDesk 仓库根目录运行:sharp 从当前工作目录的 node_modules 解析。
import { lstat, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

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
const MIN_COLUMNS = 8;
const MIN_ROWS = 9;
const MAX_METADATA = 128 * 1024;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

const directory = process.argv[2];
if (!directory) {
  console.error("用法: node validate-pet.mjs <角色目录>");
  process.exit(2);
}

const issues = [];
const result = { directory, id: basename(directory), petJson: null, sheet: null, ok: false, issues };

if (!SAFE_ID.test(result.id)) issues.push(`目录名 "${result.id}" 不合法:须以字母或数字开头,只能包含字母、数字、_ 和 -`);

const metadataPath = join(directory, "pet.json");
const metadataInfo = await lstat(metadataPath).catch(() => null);
if (!metadataInfo?.isFile() || metadataInfo.isSymbolicLink()) {
  issues.push("pet.json 缺失或是符号链接");
} else if (metadataInfo.size > MAX_METADATA) {
  issues.push("pet.json 超过 128 KB");
} else {
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    result.petJson = { ok: true, displayName: metadata.displayName ?? null, description: metadata.description ?? null };
    if (typeof metadata.displayName !== "string" || !metadata.displayName.trim()) issues.push("pet.json 缺少 displayName(应用内将回退显示为目录名)");
  } catch {
    issues.push("pet.json 不是合法 JSON");
  }
}

let sheetPath = null;
for (const name of ["spritesheet.webp", "spritesheet.png"]) {
  const candidate = join(directory, name);
  const info = await lstat(candidate).catch(() => null);
  if (info?.isFile() && !info.isSymbolicLink()) { sheetPath = candidate; break; }
}
if (!sheetPath) {
  issues.push("缺少 spritesheet.webp 或 spritesheet.png");
} else {
  try {
    const metadata = await sharp(await readFile(sheetPath)).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const columns = width / FRAME_WIDTH;
    const rows = height / FRAME_HEIGHT;
    const gridOk = Number.isInteger(columns) && Number.isInteger(rows) && columns >= MIN_COLUMNS && rows >= MIN_ROWS;
    result.sheet = { file: basename(sheetPath), width, height, columns, rows, exact: width === 1536 && height === 1872, ok: gridOk };
    if (!gridOk) issues.push(`图集 ${width}x${height} 不符合网格:宽需为 192 的倍数且至少 8 列,高需为 208 的倍数且至少 9 行(标准 1536x1872)`);
    else if (!result.sheet.exact) issues.push("图集不是标准 1536x1872:超出 8x9 网格的部分不会被使用,确认帧没有被画到网格外");
  } catch {
    issues.push("图集不是可识别的图像文件");
  }
}

result.ok = result.petJson?.ok === true && result.sheet?.ok === true && SAFE_ID.test(result.id);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
