import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPets } from "./pet-catalog";

const roots: string[] = [];
function root(): string { const value = mkdtempSync(join(tmpdir(), "everby-pets-")); roots.push(value); return value; }
async function pet(base: string, id: string, name: string, extension = "webp", extras: Record<string, unknown> = {}): Promise<void> {
  const directory = join(base, id); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "pet.json"), JSON.stringify({ displayName: name, description: `${name} description`, ...extras }));
  await writeFile(join(directory, `spritesheet.${extension}`), "image");
}

afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("discoverPets", () => {
  it("discovers all bundled roles and lets installed roles override them", async () => {
    const installed = root(); const bundled = root();
    await pet(installed, "boba", "Boba", "png"); await pet(bundled, "daily", "Daily"); await pet(bundled, "nova", "Nova");
    expect((await discoverPets(installed, bundled)).map(({ id, source }) => ({ id, source }))).toEqual([
      { id: "daily", source: "bundled" }, { id: "boba", source: "petdex" }, { id: "nova", source: "bundled" }
    ]);
    await pet(installed, "daily", "Installed Daily");
    const pets = await discoverPets(installed, bundled);
    expect(pets.filter(({ id }) => id === "daily")).toHaveLength(1);
    expect(pets[0]).toMatchObject({ id: "daily", name: "Installed Daily", source: "petdex" });
  });

  it("ignores unsafe or incomplete role directories", async () => {
    const installed = root(); const bundled = root();
    await pet(bundled, "daily", "Daily");
    await mkdir(join(installed, "broken"), { recursive: true });
    await writeFile(join(installed, "broken", "pet.json"), "{}");
    expect((await discoverPets(installed, bundled)).map(({ id }) => id)).toEqual(["daily"]);
  });

  it("parses a valid persona block from pet.json", async () => {
    const installed = root(); const bundled = root();
    await pet(bundled, "daily", "Daily");
    await pet(installed, "optimus", "Optimus", "webp", {
      persona: { speakingStyle: "热血、简练。", userAddress: "指挥官", boundaries: "不谈论同伴隐私。", background: "汽车人领袖。" }
    });
    const pets = await discoverPets(installed, bundled);
    const optimus = pets.find(({ id }) => id === "optimus");
    expect(optimus?.persona).toEqual({ speakingStyle: "热血、简练。", userAddress: "指挥官", boundaries: "不谈论同伴隐私。", background: "汽车人领袖。" });
    expect(pets.find(({ id }) => id === "daily")?.persona).toBeUndefined();
  });

  it("drops dirty persona fields and truncates oversize ones", async () => {
    const installed = root(); const bundled = root();
    await pet(installed, "dirty", "Dirty", "webp", {
      persona: {
        speakingStyle: "s".repeat(2_000),
        userAddress: 42,
        boundaries: "   ",
        background: "合理的背景",
        extra: "unknown key"
      }
    });
    const [dirty] = await discoverPets(installed, bundled);
    expect(dirty.persona).toEqual({ speakingStyle: "s".repeat(1_000), background: "合理的背景" });
  });

  it("omits persona when the block is not an object or has no usable fields", async () => {
    const installed = root(); const bundled = root();
    await pet(installed, "plain", "Plain", "webp", { persona: "not-an-object" });
    await pet(installed, "empty", "Empty", "webp", { persona: { speakingStyle: "" } });
    const pets = await discoverPets(installed, bundled);
    expect(pets.find(({ id }) => id === "plain")?.persona).toBeUndefined();
    expect(pets.find(({ id }) => id === "empty")?.persona).toBeUndefined();
  });
});
