import { createWriteStream } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import yazl from "yazl";
import { installPet } from "./pet-installer";
import { discoverPets } from "./pet-catalog";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "everby-pet-test-"));
  directories.push(directory);
  return directory;
}

let sharedSheet: Buffer | null = null;

async function sheetBuffer(width = 1536, height = 1872): Promise<Buffer> {
  if (width === 1536 && height === 1872 && sharedSheet) return sharedSheet;
  const buffer = await sharp({ create: { width, height, channels: 4, background: { r: 120, g: 160, b: 200, alpha: 1 } } }).png().toBuffer();
  if (width === 1536 && height === 1872) sharedSheet = buffer;
  return buffer;
}

async function makePetFolder(parent: string, id: string, options?: { sheet?: Buffer; metadata?: string; sheetName?: string }): Promise<string> {
  const folder = join(parent, id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "pet.json"), options?.metadata ?? `${JSON.stringify({ id, displayName: id })}\n`);
  await writeFile(join(folder, options?.sheetName ?? "spritesheet.png"), options?.sheet ?? await sheetBuffer());
  return folder;
}

async function makeZip(parent: string, entries: Record<string, Buffer | string>): Promise<string> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(entries)) zip.addBuffer(typeof content === "string" ? Buffer.from(content, "utf8") : content, name);
  zip.end();
  const target = join(parent, "download.zip");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    zip.outputStream.pipe(createWriteStream(target)).on("close", resolvePromise).on("error", rejectPromise);
  });
  return target;
}

describe("installPet", () => {
  it("installs a valid pet folder into the Petdex root and discovers it", async () => {
    const directory = scratch();
    const petdexRoot = join(directory, "pets");
    const folder = await makePetFolder(directory, "nova");
    const installed = await installPet(folder, petdexRoot);
    expect(installed.id).toBe("nova");
    const pets = await discoverPets(petdexRoot, join(directory, "missing-bundled"));
    expect(pets.map((pet) => pet.id)).toEqual(["nova"]);
    expect(pets[0].source).toBe("petdex");
    expect(pets[0].name).toBe("nova");
  });

  it("accepts a lossless webp spritesheet like the bundled characters", async () => {
    const directory = scratch();
    const petdexRoot = join(directory, "pets");
    const folder = join(directory, "webp-pet");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "pet.json"), `${JSON.stringify({ id: "webp-pet", displayName: "Webp" })}\n`);
    await copyFile(resolve("resources/runtime-pets/daily/spritesheet.webp"), join(folder, "spritesheet.webp"));
    const installed = await installPet(folder, petdexRoot);
    expect(installed.id).toBe("webp-pet");
    expect((await discoverPets(petdexRoot, join(directory, "missing"))).map((pet) => pet.id)).toEqual(["webp-pet"]);
  });

  it("installs a zip whose pet lives in a single root folder", async () => {
    const directory = scratch();
    const zipPath = await makeZip(directory, {
      "robo/pet.json": `${JSON.stringify({ id: "robo", displayName: "Robo" })}\n`,
      "robo/spritesheet.png": await sheetBuffer()
    });
    const installed = await installPet(zipPath, join(directory, "pets"));
    expect(installed.id).toBe("robo");
  });

  it("installs a zip with files at the archive root, naming the pet after the zip", async () => {
    const directory = scratch();
    const zipPath = await makeZip(directory, {
      "pet.json": `${JSON.stringify({ id: "whatever", displayName: "Zip Root" })}\n`,
      "spritesheet.png": await sheetBuffer()
    });
    const installed = await installPet(zipPath, join(directory, "pets"));
    expect(installed.id).toBe("download");
  });

  it("rejects a pet.json that is not valid JSON", async () => {
    const directory = scratch();
    const folder = await makePetFolder(directory, "nova", { metadata: "{ not json" });
    await expect(installPet(folder, join(directory, "pets"))).rejects.toThrow("pet.json 不是合法 JSON");
  });

  it("rejects a spritesheet that does not cover the 8x9 grid", async () => {
    const directory = scratch();
    const folder = await makePetFolder(directory, "tiny", { sheet: await sheetBuffer(192, 208) });
    await expect(installPet(folder, join(directory, "pets"))).rejects.toThrow("不符合网格要求");
  });

  it("rejects a folder without a spritesheet", async () => {
    const directory = scratch();
    const folder = join(directory, "nosheet");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "pet.json"), "{}\n");
    await expect(installPet(folder, join(directory, "pets"))).rejects.toThrow("缺少 spritesheet");
  });

  it("rejects an id that is not filesystem-safe", async () => {
    const directory = scratch();
    const folder = await makePetFolder(directory, "坏角色");
    await expect(installPet(folder, join(directory, "pets"))).rejects.toThrow("不合法");
  });

  it("rejects a duplicate pet id without overwriting", async () => {
    const directory = scratch();
    const petdexRoot = join(directory, "pets");
    await installPet(await makePetFolder(directory, "nova"), petdexRoot);
    const second = await makePetFolder(join(directory, "again"), "nova");
    await expect(installPet(second, petdexRoot)).rejects.toThrow("已存在同名角色 nova");
  });

  it("rejects a zip containing an executable entry", async () => {
    const directory = scratch();
    const zipPath = await makeZip(directory, {
      "robo/pet.json": `${JSON.stringify({ id: "robo" })}\n`,
      "robo/spritesheet.png": await sheetBuffer(),
      "robo/payload.exe": "MZ"
    });
    await expect(installPet(zipPath, join(directory, "pets"))).rejects.toThrow("不安全路径");
  });

  it("rejects files that are not zip archives", async () => {
    const directory = scratch();
    const file = join(directory, "notes.txt");
    await writeFile(file, "hello");
    await expect(installPet(file, join(directory, "pets"))).rejects.toThrow("请选择角色文件夹或 .zip 压缩包");
  });
});
