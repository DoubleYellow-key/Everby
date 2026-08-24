import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./database";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("AppDatabase desktop-domain ownership", () => {
  it("persists desktop, chat model and embedding settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
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
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    database.setActivePetId("boba");
    database.saveMotionPack({ packId: "focus", version: "1.0.0", name: "Focus", targetPetId: "boba", enabled: true, animationCount: 2 }, join(directory, "focus"));
    expect(database.getActivePetId()).toBe("boba");
    expect(database.listMotionPacks("boba")).toEqual([{ packId: "focus", version: "1.0.0", name: "Focus", targetPetId: "boba", enabled: true, animationCount: 2 }]);
    database.close();
  });

  it("persists action rules by pet and records the last trigger across restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const path = join(directory, "app.db");
    let database = new AppDatabase(path);
    const rule = database.createActionRule("daily", {
      name: "Morning wave", actionId: "wave", enabled: true, durationSeconds: 6,
      trigger: { type: "routine", weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "10:00", minIntervalMinutes: 15, maxIntervalMinutes: 30, probability: 0.8 }
    }, 1_000);
    database.createActionRule("boba", {
      name: "Click", actionId: "jump", enabled: true, durationSeconds: 4,
      trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 5 }
    }, 2_000);
    database.recordActionRuleTrigger("daily", rule.id, 3_000);
    database.close();

    database = new AppDatabase(path);
    expect(database.listActionRules("daily")).toHaveLength(1);
    expect(database.listActionRules("daily")[0]).toMatchObject({ name: "Morning wave", lastTriggeredAt: 3_000 });
    expect(database.listActionRules("boba")).toHaveLength(1);
    database.close();
  });

  it("updates and deletes only rules owned by the selected pet", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    const rule = database.createActionRule("daily", {
      name: "Click", actionId: "wave", enabled: true, durationSeconds: 4,
      trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 0 }
    });
    expect(() => database.updateActionRule("boba", rule.id, { enabled: false })).toThrow("动作规则不存在");
    expect(database.updateActionRule("daily", rule.id, { enabled: false }).enabled).toBe(false);
    expect(database.deleteActionRule("boba", rule.id)).toBe(false);
    expect(database.deleteActionRule("daily", rule.id)).toBe(true);
    database.close();
  });
});
