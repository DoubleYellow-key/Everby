import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

function copyMissing(source: string, target: string): void {
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, errorOnExist: false });
}

export function migrateSoulDeskUserData(legacyDirectory: string, everbyDirectory: string): void {
  if (!existsSync(legacyDirectory) || legacyDirectory === everbyDirectory) return;
  const ownedEntries = [
    ["souldesk.db", "everby.db"],
    ["souldesk.db-wal", "everby.db-wal"],
    ["souldesk.db-shm", "everby.db-shm"],
    ["api-key.bin", "api-key.bin"],
    ["embedding-api-key.bin", "embedding-api-key.bin"],
    ["motions", "motions"]
  ] as const;

  for (const [legacyName, everbyName] of ownedEntries) {
    const source = join(legacyDirectory, legacyName);
    if (existsSync(source)) copyMissing(source, join(everbyDirectory, everbyName));
  }
}
