import { mkdir, writeFile } from "node:fs/promises";
import { dirname, normalize, resolve, sep } from "node:path";
import yauzl from "yauzl";

const MAX_ENTRIES = 2_000;
const MAX_UNPACKED = 100 * 1024 * 1024;

export function unsafeZipEntry(name: string): boolean {
  const value = name.replaceAll("\\", "/");
  return value.startsWith("/") || /^[a-zA-Z]:/.test(value) || value.split("/").some((part) => part === ".." || !part) || /\.(exe|dll|bat|cmd|ps1|js|mjs|cjs|vbs|scr)$/i.test(value);
}

function openZip(path: string, label: string): Promise<yauzl.ZipFile> {
  return new Promise((resolveOpen, reject) => yauzl.open(path, { lazyEntries: true }, (error, zip) => error || !zip ? reject(error ?? new Error(`无法打开${label}`)) : resolveOpen(zip)));
}

export async function extractZip(path: string, destination: string, label = "扩展包"): Promise<void> {
  const zip = await openZip(path, label);
  let total = 0;
  let entries = 0;
  await new Promise<void>((resolveExtract, reject) => {
    zip.on("entry", (entry) => {
      entries += 1;
      if (entries > MAX_ENTRIES) return reject(new Error(`${label}文件数量超过 2000`));
      if (unsafeZipEntry(entry.fileName)) return reject(new Error(`${label}包含不安全路径`));
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (mode === 0o120000) return reject(new Error(`${label}不能包含符号链接`));
      total += entry.uncompressedSize;
      if (total > MAX_UNPACKED) return reject(new Error(`${label}解压后超过 100 MB`));
      const output = resolve(destination, normalize(entry.fileName));
      if (!output.startsWith(`${resolve(destination)}${sep}`)) return reject(new Error(`${label}路径越界`));
      if (entry.fileName.endsWith("/")) { void mkdir(output, { recursive: true }).then(() => zip.readEntry(), reject); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return reject(error ?? new Error("无法读取压缩包内容"));
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
