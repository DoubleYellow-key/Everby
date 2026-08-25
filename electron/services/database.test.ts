import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./database";
import { defaultActionProfiles } from "../../src/core/action-profiles";
import { DAILY_DEFAULT_ACTION_RULES } from "../../src/core/default-action-rules";

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
      trigger: { type: "event", event: "conversation_intent", intent: "greet", probability: 0.8, cooldownSeconds: 5 }
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

  it("persists one-time initialization versions", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const path = join(directory, "app.db");
    let database = new AppDatabase(path);
    expect(database.getInitializationVersion("daily-actions")).toBe(0);
    database.setInitializationVersion("daily-actions", 1);
    database.close();

    database = new AppDatabase(path);
    expect(database.getInitializationVersion("daily-actions")).toBe(1);
    database.close();
  });

  it("archives legacy rules and initializes v3 profiles exactly once", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    database.createActionRule("daily", { name: "Legacy", actionId: "working", enabled: true, durationSeconds: 30, trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 0 } });
    expect(database.migrateActionSystemV3("daily", DAILY_DEFAULT_ACTION_RULES, defaultActionProfiles("daily", 5_000), 5_000)).toBe(true);
    expect(database.archivedActionRuleCount("daily")).toBe(1);
    expect(database.listActionRules("daily").map((rule) => rule.name)).not.toContain("Legacy");
    expect(database.listActionProfiles("daily").map((profile) => profile.mode)).toEqual(["normal", "focus", "rest"]);
    expect(database.migrateActionSystemV3("daily", [], [], 6_000)).toBe(false);
    expect(database.archivedActionRuleCount("daily")).toBe(1);
    database.close();
  });

  it("persists mode sessions and expires them by wall-clock time", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const path = join(directory, "app.db");
    let database = new AppDatabase(path);
    database.startActionMode("daily", "focus", 25, "manual", 1_000);
    database.close();
    database = new AppDatabase(path);
    expect(database.getActionMode("daily", 2_000)).toMatchObject({ mode: "focus", source: "manual", endsAt: 1_501_000 });
    expect(database.getActionMode("daily", 1_501_001).mode).toBe("normal");
    database.close();
  });

  it("upgrades the original short focus profile to longer seated sessions once", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    const focus = defaultActionProfiles("daily", 1_000).find((profile) => profile.mode === "focus")!;
    database.saveActionProfile({ ...focus, activityRatio: 0.7 });
    database.setInitializationVersion("action-system:daily", 3);
    expect(database.migrateActionSystemV3("daily", [], [], 2_000)).toBe(false);
    expect(database.listActionProfiles("daily")[0].activityRatio).toBe(0.9);
    database.saveActionProfile({ ...focus, activityRatio: 0.8, updatedAt: 3_000 });
    database.migrateActionSystemV3("daily", [], [], 4_000);
    expect(database.listActionProfiles("daily")[0].activityRatio).toBe(0.8);
    database.close();
  });
});
