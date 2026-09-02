import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./database";
import { defaultActionProfiles } from "../../src/core/action-profiles";
import { DAILY_DEFAULT_ACTION_RULES } from "../../src/core/default-action-rules";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("AppDatabase desktop-domain ownership", () => {
  it("persists desktop, chat, embedding and vision model settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    database.updateSettings({ paused: true, scale: 1.25 });
    database.updateModel({ model: "local-chat" }, true);
    database.updateEmbedding({ model: "local-embedding" }, true);
    database.updateVision({ model: "local-vision" }, true);
    expect(database.getSettings()).toMatchObject({ paused: true, scale: 1.25 });
    expect(database.getModel()).toMatchObject({ model: "local-chat", configured: true });
    expect(database.getEmbedding()).toMatchObject({ model: "local-embedding", configured: true });
    expect(database.getVision()).toMatchObject({ model: "local-vision", configured: true });
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

  it("isolates motion packs with the same ID by pet", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    database.saveMotionPack({ packId: "focus", version: "1.0.0", name: "Daily Focus", targetPetId: "daily", enabled: true, animationCount: 1 }, join(directory, "daily-focus"));
    database.saveMotionPack({ packId: "focus", version: "2.0.0", name: "Boba Focus", targetPetId: "boba", enabled: true, animationCount: 2 }, join(directory, "boba-focus"));

    expect(database.listMotionPacks()).toHaveLength(2);
    expect(database.getMotionPackPath("daily", "focus")).toBe(join(directory, "daily-focus"));
    expect(database.getMotionPackPath("boba", "focus")).toBe(join(directory, "boba-focus"));
    database.setMotionPackEnabled("daily", "focus", false);
    expect(database.listMotionPacks("daily")[0].enabled).toBe(false);
    expect(database.listMotionPacks("boba")[0].enabled).toBe(true);
    database.deleteMotionPack("daily", "focus");
    expect(database.listMotionPacks("daily")).toEqual([]);
    expect(database.listMotionPacks("boba")).toHaveLength(1);
    database.close();
  });

  it("migrates legacy globally keyed motion packs without losing metadata", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const path = join(directory, "app.db");
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE motion_packs (pack_id TEXT PRIMARY KEY, version TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL, animation_count INTEGER NOT NULL, install_path TEXT NOT NULL, target_pet_id TEXT NOT NULL)");
    legacy.prepare("INSERT INTO motion_packs VALUES (?, ?, ?, ?, ?, ?, ?)").run("focus", "1.0.0", "Focus", 1, 2, join(directory, "focus"), "boba");
    legacy.close();

    const database = new AppDatabase(path);
    expect(database.listMotionPacks("boba")).toEqual([{ packId: "focus", version: "1.0.0", name: "Focus", targetPetId: "boba", enabled: true, animationCount: 2 }]);
    database.saveMotionPack({ packId: "focus", version: "1.0.0", name: "Daily Focus", targetPetId: "daily", enabled: true, animationCount: 1 }, join(directory, "daily-focus"));
    expect(database.listMotionPacks()).toHaveLength(2);
    database.close();
  });

  it("deletes pet-owned action state while preserving reusable motion packs", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    database.saveMotionPack({ packId: "focus", version: "1.0.0", name: "Focus", targetPetId: "boba", enabled: true, animationCount: 2 }, join(directory, "focus"));
    database.createActionRule("boba", {
      name: "Click", actionId: "jump", enabled: true, durationSeconds: 4,
      trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 0 }
    });
    const profile = database.createActionProfile("boba", {
      name: "工作", activityRatio: 0.8, strategy: "fixed", items: [{ actionId: "working", weight: 1 }],
      fallbackActionId: "working", actionDurationSeconds: 90, defaultDurationMinutes: 25, eventActions: {}
    });
    database.startActionMode("boba", profile.mode, 25, "manual", 1_000);
    database.setInitializationVersion("action-system:boba", 3);

    database.deletePetData("boba");

    expect(database.listActionRules("boba")).toEqual([]);
    expect(database.listActionProfiles("boba")).toEqual([]);
    expect(database.getActionMode("boba", 2_000).mode).toBe("normal");
    expect(database.getInitializationVersion("action-system:boba")).toBe(0);
    expect(database.listMotionPacks("boba")).toHaveLength(1);
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
    expect(database.listActionProfiles("daily").map((profile) => profile.mode)).toEqual(["normal"]);
    expect(database.migrateActionSystemV3("daily", [], [], 6_000)).toBe(false);
    expect(database.archivedActionRuleCount("daily")).toBe(1);
    database.close();
  });

  it("persists mode sessions and expires them by wall-clock time", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const path = join(directory, "app.db");
    let database = new AppDatabase(path);
    const work = database.createActionProfile("daily", {
      name: "工作", activityRatio: 0.8, strategy: "fixed", items: [{ actionId: "working", weight: 1 }],
      fallbackActionId: "working", actionDurationSeconds: 90, defaultDurationMinutes: 25, eventActions: {}
    }, 500);
    database.startActionMode("daily", work.mode, 25, "manual", 1_000);
    database.close();
    database = new AppDatabase(path);
    expect(database.getActionMode("daily", 2_000)).toMatchObject({ mode: work.mode, source: "manual", endsAt: 1_501_000 });
    expect(database.getActionMode("daily", 1_501_001).mode).toBe("normal");
    database.close();
  });

  it("creates, updates and deletes custom states while protecting normal", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    database.saveActionProfile(defaultActionProfiles("daily", 1_000)[0]);
    const work = database.createActionProfile("daily", {
      name: "工作", activityRatio: 0.8, strategy: "fixed", items: [{ actionId: "working", weight: 1 }],
      fallbackActionId: "working", actionDurationSeconds: 90, defaultDurationMinutes: 45,
      eventActions: { pet_click: { actionId: "impatient", durationSeconds: 3 } }
    }, 2_000);
    expect(work.mode).toMatch(/^state-/);
    expect(database.updateActionProfile("daily", work.mode, { ...work, name: "深度工作", activityRatio: 0.85 }, 3_000).name).toBe("深度工作");
    expect(() => database.deleteActionProfile("daily", "normal")).toThrow("常规状态不能删除");
    expect(database.deleteActionProfile("daily", work.mode)).toBe(true);
    database.close();
  });

  it("archives fixed v3 profiles and leaves only the normal state", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    const normal = defaultActionProfiles("daily", 5_000)[0];
    database.saveActionProfile(normal);
    database.saveActionProfile({ ...normal, mode: "focus", name: "专注", defaultDurationMinutes: 45 });
    database.saveActionProfile({ ...normal, mode: "rest", name: "休息", defaultDurationMinutes: 10 });
    expect(database.migrateActionStatesV1("daily", normal, 6_000)).toBe(true);
    expect(database.listActionProfiles("daily").map((profile) => profile.mode)).toEqual(["normal"]);
    expect(database.archivedActionProfileCount("daily")).toBe(3);
    expect(database.migrateActionStatesV1("daily", normal, 7_000)).toBe(false);
    database.close();
  });

  it("upgrades only the untouched legacy click interaction rule", () => {
    const directory = mkdtempSync(join(tmpdir(), "everby-db-")); directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    const legacy = database.createActionRule("daily", {
      name: "点击时欢呼", actionId: "daily-cheer-combo", enabled: true, durationSeconds: 4,
      trigger: { type: "event", event: "pet_click", probability: 0.65, cooldownSeconds: 12 }
    });
    const custom = database.createActionRule("daily", {
      name: "我的点击动作", actionId: "stretch", enabled: true, durationSeconds: 6,
      trigger: { type: "event", event: "pet_click", probability: 1, cooldownSeconds: 3 }
    });
    expect(database.migrateClickInteractionV1("daily", 5_000)).toBe(true);
    expect(database.listActionRules("daily").find((rule) => rule.id === legacy.id)).toMatchObject({
      name: "点击互动", actionId: "interaction", durationSeconds: 3,
      trigger: { event: "pet_click", probability: 1, cooldownSeconds: 0 }
    });
    expect(database.listActionRules("daily").find((rule) => rule.id === custom.id)?.actionId).toBe("stretch");
    expect(database.migrateClickInteractionV1("daily", 6_000)).toBe(false);
    database.close();
  });
});
