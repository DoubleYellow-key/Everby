import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./database";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("AppDatabase desktop-domain ownership", () => {
  it("persists desktop, chat model and embedding settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "souldesk-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    database.updateSettings({ paused: true, scale: 1.25 });
    database.updateModel({ model: "local-chat" }, true);
    database.updateEmbedding({ model: "local-embedding" }, true);
    expect(database.getSettings()).toMatchObject({ paused: true, scale: 1.25 });
    expect(database.getModel()).toMatchObject({ model: "local-chat", configured: true });
    expect(database.getEmbedding()).toMatchObject({ model: "local-embedding", configured: true });
    database.close();
  });

  it("persists active pet and motion pack metadata", () => {
    const directory = mkdtempSync(join(tmpdir(), "souldesk-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    database.setActivePetId("boba");
    database.saveMotionPack({ packId: "focus", version: "1.0.0", name: "Focus", enabled: true, animationCount: 2 }, join(directory, "focus"));
    expect(database.getActivePetId()).toBe("boba");
    expect(database.listMotionPacks()).toEqual([{ packId: "focus", version: "1.0.0", name: "Focus", enabled: true, animationCount: 2 }]);
    database.close();
  });
});
