import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PetSummary } from "../../src/shared/contracts";

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

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
    return { id, name, description, source, directory, sheetFile };
  } catch { return null; }
}

export async function discoverPets(petdexRoot: string, bundledRoot: string): Promise<CatalogPet[]> {
  const [bundled, installed] = await Promise.all([scanPets(bundledRoot, "bundled"), scanPets(petdexRoot, "petdex")]);
  const pets = new Map<string, CatalogPet>();
  for (const pet of bundled) pets.set(pet.id, pet);
  for (const pet of installed) pets.set(pet.id, pet);
  return [...pets.values()].sort((left, right) => left.id === "daily" ? -1 : right.id === "daily" ? 1 : left.name.localeCompare(right.name));
}
