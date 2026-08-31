import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PetPersonaDefaults, PetSummary } from "../../src/shared/contracts";

export const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

// 与 main.ts personaPatchSchema 的上限对齐；pet.json 是外部数据，非字符串/超长字段直接丢弃或截断
const PERSONA_FIELD_CAPS = { background: 2_000, speakingStyle: 1_000, userAddress: 40, boundaries: 2_000 } as const;

function parsePersonaDefaults(metadata: Record<string, unknown>): PetPersonaDefaults | undefined {
  if (!metadata.persona || typeof metadata.persona !== "object" || Array.isArray(metadata.persona)) return undefined;
  const raw = metadata.persona as Record<string, unknown>;
  const persona: PetPersonaDefaults = {};
  for (const [key, cap] of Object.entries(PERSONA_FIELD_CAPS) as [keyof PetPersonaDefaults, number][]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) persona[key] = value.trim().slice(0, cap);
  }
  return Object.keys(persona).length ? persona : undefined;
}

export interface CatalogPet extends Omit<PetSummary, "sheetUrl"> {
  directory: string;
  sheetFile: "spritesheet.webp" | "spritesheet.png";
}

async function scanPets(root: string, source: CatalogPet["source"]): Promise<CatalogPet[]> {
  const pets: CatalogPet[] = [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !SAFE_ID.test(entry.name)) continue;
      const pet = await readPet(join(root, entry.name), entry.name, source);
      if (pet) pets.push(pet);
    }
  } catch { /* Missing role roots are valid during first run. */ }
  return pets;
}

async function readPet(directory: string, id: string, source: CatalogPet["source"]): Promise<CatalogPet | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return null;
    const metadataPath = join(directory, "pet.json");
    const metadataInfo = await lstat(metadataPath);
    if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink() || metadataInfo.size > 128 * 1024) return null;
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
    const sheetFile = await Promise.all((["spritesheet.webp", "spritesheet.png"] as const).map(async (name) => {
      try {
        const info = await lstat(join(directory, name));
        return info.isFile() && !info.isSymbolicLink() ? name : null;
      } catch { return null; }
    })).then((items) => items.find(Boolean));
    if (!sheetFile) return null;
    const name = typeof metadata.displayName === "string" && metadata.displayName.trim() ? metadata.displayName.trim().slice(0, 80) : id;
    const description = typeof metadata.description === "string" ? metadata.description.trim().slice(0, 500) : "";
    const persona = parsePersonaDefaults(metadata);
    return { id, name, description, source, directory, sheetFile, ...(persona ? { persona } : {}) };
  } catch { return null; }
}

export async function discoverPets(petdexRoot: string, bundledRoot: string): Promise<CatalogPet[]> {
  const [bundled, installed] = await Promise.all([scanPets(bundledRoot, "bundled"), scanPets(petdexRoot, "petdex")]);
  const pets = new Map<string, CatalogPet>();
  for (const pet of bundled) pets.set(pet.id, pet);
  for (const pet of installed) pets.set(pet.id, pet);
  return [...pets.values()].sort((left, right) => left.id === "daily" ? -1 : right.id === "daily" ? 1 : left.name.localeCompare(right.name));
}
