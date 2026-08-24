import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { migrateSoulDeskUserData } from "./brand-migration";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Everby brand migration", () => {
  it("copies legacy user data and promotes the database name", () => {
    const root = mkdtempSync(join(tmpdir(), "everby-brand-migration-"));
    directories.push(root);
    const legacy = join(root, "SoulDesk");
    const target = join(root, "Everby");

    writeFileSync(join(root, "placeholder"), "root");
    expect(() => migrateSoulDeskUserData(legacy, target)).not.toThrow();
    expect(existsSync(target)).toBe(false);

    mkdirSync(join(legacy, "motions"), { recursive: true });
    writeFileSync(join(legacy, "souldesk.db"), "database");
    writeFileSync(join(legacy, "api-key.bin"), "secret");
    writeFileSync(join(legacy, "motions", "pack.json"), "motion");

    migrateSoulDeskUserData(legacy, target);

    expect(readFileSync(join(target, "everby.db"), "utf8")).toBe("database");
    expect(readFileSync(join(target, "api-key.bin"), "utf8")).toBe("secret");
    expect(readFileSync(join(target, "motions", "pack.json"), "utf8")).toBe("motion");
  });

  it("does not overwrite data already created by Everby", () => {
    const root = mkdtempSync(join(tmpdir(), "everby-brand-migration-"));
    directories.push(root);
    const legacy = join(root, "SoulDesk");
    const target = join(root, "Everby");
    mkdirSync(legacy, { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(legacy, "souldesk.db"), "legacy");
    writeFileSync(join(target, "everby.db"), "current");

    migrateSoulDeskUserData(legacy, target);

    expect(readFileSync(join(target, "everby.db"), "utf8")).toBe("current");
  });
});
