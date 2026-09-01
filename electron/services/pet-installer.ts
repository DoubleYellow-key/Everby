import { cp, lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import sharp from "sharp";
import { SAFE_ID } from "./pet-catalog";
import { extractZip } from "./zip-extract";

const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const MIN_COLUMNS = 8;
const MIN_ROWS = 9;
const MAX_METADATA_BYTES = 128 * 1024;
const SHEET_NAMES = ["spritesheet.webp", "spritesheet.png"] as const;

export interface InstalledPet {
  id: string;
  directory: string;
}

async function findPetRoot(directory: string): Promise<string> {
  const own = await lstat(join(directory, "pet.json")).catch(() => null);
  if (own?.isFile()) return directory;
  const candidates: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = await lstat(join(directory, entry.name, "pet.json")).catch(() => null);
    if (nested?.isFile()) candidates.push(entry.name);
  }
  if (candidates.length === 1) return join(directory, candidates[0]);
  throw new Error("没有找到包含 pet.json 的角色目录");
}

async function validatePetRoot(root: string): Promise<void> {
  const metadataPath = join(root, "pet.json");
  const metadataInfo = await lstat(metadataPath);
  if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink()) throw new Error("pet.json 不是有效文件");
  if (metadataInfo.size > MAX_METADATA_BYTES) throw new Error("pet.json 不能超过 128 KB");
  try {
    JSON.parse(await readFile(metadataPath, "utf8"));
  } catch {
    throw new Error("pet.json 不是合法 JSON");
  }
  let sheetPath: string | null = null;
  for (const name of SHEET_NAMES) {
    const candidate = join(root, name);
    const info = await lstat(candidate).catch(() => null);
    if (info?.isFile() && !info.isSymbolicLink()) { sheetPath = candidate; break; }
  }
  if (!sheetPath) throw new Error("角色目录缺少 spritesheet.webp 或 spritesheet.png");
  // sharp 直接读路径时 libvips 会缓存 webp 文件句柄,导致 Windows 上 rename 暂存目录 EPERM;先读入 Buffer 规避。
  const metadata = await sharp(await readFile(sheetPath)).metadata().catch(() => { throw new Error("图集不是可识别的图像文件"); });
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const columns = width / FRAME_WIDTH;
  const rows = height / FRAME_HEIGHT;
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < MIN_COLUMNS || rows < MIN_ROWS) {
    throw new Error(`图集尺寸 ${width}x${height} 不符合网格要求:宽需为 192 的倍数且至少 8 列,高需为 208 的倍数且至少 9 行(标准 1536x1872)`);
  }
}

export async function installPet(sourcePath: string, petdexRoot: string): Promise<InstalledPet> {
  const sourceInfo = await lstat(sourcePath).catch(() => { throw new Error("所选路径不存在"); });
  await mkdir(petdexRoot, { recursive: true });
  const staging = join(petdexRoot, `.staging-${crypto.randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    let root: string;
    if (sourceInfo.isDirectory()) {
      root = join(staging, basename(sourcePath));
      await cp(sourcePath, root, { recursive: true });
    } else if (extname(sourcePath).toLowerCase() === ".zip") {
      await extractZip(sourcePath, staging, "角色包");
      root = await findPetRoot(staging);
    } else {
      throw new Error("请选择角色文件夹或 .zip 压缩包");
    }
    const id = root === staging ? basename(sourcePath, extname(sourcePath)) : basename(root);
    if (!SAFE_ID.test(id)) throw new Error(`角色目录名 "${id}" 不合法:须以字母或数字开头,只能包含字母、数字、_ 和 -`);
    await validatePetRoot(root);
    const destination = join(petdexRoot, id);
    const existing = await lstat(destination).catch(() => null);
    if (existing) throw new Error(`已存在同名角色 ${id},如需更新请先移除原有角色`);
    await rename(root, destination);
    if (root !== staging) await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    return { id, directory: destination };
  } catch (error) {
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    throw error;
  }
}

export async function removePet(id: string, petdexRoot: string): Promise<void> {
  if (!SAFE_ID.test(id)) throw new Error("角色 ID 不合法");
  const root = resolve(petdexRoot);
  const target = resolve(root, id);
  if (dirname(target) !== root) throw new Error("角色路径越界");
  const info = await lstat(target).catch(() => null);
  if (!info) throw new Error("角色不存在或已经删除");
  if (info.isSymbolicLink()) throw new Error("不能删除符号链接角色");
  if (!info.isDirectory()) throw new Error("角色路径不是目录");
  await rm(target, { recursive: true, force: false, maxRetries: 5, retryDelay: 100 });
}
