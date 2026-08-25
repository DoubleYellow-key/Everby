import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS } from "../../src/core/codex-atlas";
import type { ActionMode, ActionModeSession, ActionProfile, ActionRule, AppSettings, CreateActionRuleInput, EmbeddingSettings, ModelSettings, MotionPackSummary, UpdateActionRuleInput } from "../../src/shared/contracts";

export const DEFAULT_MODEL: ModelSettings = { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", temperature: 0.7, configured: false };
export const DEFAULT_EMBEDDING: EmbeddingSettings = { baseUrl: "https://api.openai.com/v1", model: "text-embedding-3-small", configured: false };

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS motion_packs (pack_id TEXT PRIMARY KEY, version TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL, animation_count INTEGER NOT NULL, install_path TEXT NOT NULL);
    `);
    const motionColumns = this.db.prepare("PRAGMA table_info(motion_packs)").all() as Array<{ name: string }>;
    if (!motionColumns.some((column) => column.name === "target_pet_id")) this.db.exec("ALTER TABLE motion_packs ADD COLUMN target_pet_id TEXT NOT NULL DEFAULT 'daily'");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS action_rules (
        id TEXT PRIMARY KEY,
        pet_id TEXT NOT NULL,
        name TEXT NOT NULL,
        action_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL,
        trigger_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_triggered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS action_rules_pet_id ON action_rules(pet_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS action_rules_v2_archive (
        archive_id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, rule_json TEXT NOT NULL, archived_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_profiles (
        pet_id TEXT NOT NULL, mode TEXT NOT NULL, activity_ratio REAL NOT NULL, strategy TEXT NOT NULL,
        items_json TEXT NOT NULL, fallback_action_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY(pet_id, mode)
      );
      CREATE TABLE IF NOT EXISTS action_mode_sessions (
        pet_id TEXT PRIMARY KEY, mode TEXT NOT NULL, source TEXT NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER
      );
    `);
  }

  close(): void { this.db.close(); }

  private getJson<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try { return { ...fallback, ...JSON.parse(row.value) } as T; } catch { return fallback; }
  }

  private setJson(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }

  getSettings(): AppSettings { return this.getJson("settings", DEFAULT_SETTINGS); }
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...patch, scale: Math.min(2, Math.max(0.5, patch.scale ?? this.getSettings().scale)) };
    this.setJson("settings", next);
    return next;
  }

  getModel(): ModelSettings { return this.getJson("model", DEFAULT_MODEL); }
  updateModel(patch: Partial<Omit<ModelSettings, "configured">>, configured = this.getModel().configured): ModelSettings {
    const next = { ...this.getModel(), ...patch, configured };
    this.setJson("model", next);
    return next;
  }
  getEmbedding(): EmbeddingSettings { return this.getJson("embedding", DEFAULT_EMBEDDING); }
  updateEmbedding(patch: Partial<Omit<EmbeddingSettings, "configured">>, configured = this.getEmbedding().configured): EmbeddingSettings {
    const next = { ...this.getEmbedding(), ...patch, configured };
    this.setJson("embedding", next);
    return next;
  }

  getActivePetId(): string { return this.getJson("activePet", { id: "daily" }).id; }
  setActivePetId(petId: string): void { this.setJson("activePet", { id: petId }); }

  getInitializationVersion(name: string): number { return this.getJson(`initialization:${name}`, { version: 0 }).version; }
  setInitializationVersion(name: string, version: number): void { this.setJson(`initialization:${name}`, { version }); }

  listMotionPacks(targetPetId?: string): MotionPackSummary[] {
    const rows = targetPetId
      ? this.db.prepare("SELECT pack_id AS packId, version, name, target_pet_id AS targetPetId, enabled, animation_count AS animationCount FROM motion_packs WHERE target_pet_id = ? ORDER BY name").all(targetPetId)
      : this.db.prepare("SELECT pack_id AS packId, version, name, target_pet_id AS targetPetId, enabled, animation_count AS animationCount FROM motion_packs ORDER BY name").all();
    return rows.map((row: any) => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  saveMotionPack(pack: MotionPackSummary, installPath: string): void {
    this.db.prepare("INSERT INTO motion_packs(pack_id, version, name, enabled, animation_count, install_path, target_pet_id) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(pack_id) DO UPDATE SET version=excluded.version,name=excluded.name,enabled=excluded.enabled,animation_count=excluded.animation_count,install_path=excluded.install_path,target_pet_id=excluded.target_pet_id")
      .run(pack.packId, pack.version, pack.name, pack.enabled ? 1 : 0, pack.animationCount, installPath, pack.targetPetId);
  }

  setMotionPackEnabled(packId: string, enabled: boolean): void { this.db.prepare("UPDATE motion_packs SET enabled = ? WHERE pack_id = ?").run(enabled ? 1 : 0, packId); }
  getMotionPackPath(packId: string): string | null { return (this.db.prepare("SELECT install_path AS path FROM motion_packs WHERE pack_id = ?").get(packId) as { path: string } | undefined)?.path ?? null; }
  deleteMotionPack(packId: string): void { this.db.prepare("DELETE FROM motion_packs WHERE pack_id = ?").run(packId); }

  listActionRules(petId: string): ActionRule[] {
    return this.db.prepare("SELECT id, pet_id AS petId, name, action_id AS actionId, enabled, duration_seconds AS durationSeconds, trigger_json AS triggerJson, created_at AS createdAt, updated_at AS updatedAt, last_triggered_at AS lastTriggeredAt FROM action_rules WHERE pet_id = ? ORDER BY updated_at DESC")
      .all(petId).map((row: any) => {
        const { triggerJson, ...fields } = row;
        return { ...fields, enabled: Boolean(row.enabled), trigger: JSON.parse(triggerJson) };
      });
  }

  createActionRule(petId: string, input: CreateActionRuleInput, now = Date.now()): ActionRule {
    const rule: ActionRule = { id: randomUUID(), petId, ...input, createdAt: now, updatedAt: now, lastTriggeredAt: null };
    this.db.prepare("INSERT INTO action_rules(id, pet_id, name, action_id, enabled, duration_seconds, trigger_json, created_at, updated_at, last_triggered_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(rule.id, petId, rule.name, rule.actionId, rule.enabled ? 1 : 0, rule.durationSeconds, JSON.stringify(rule.trigger), now, now, null);
    return rule;
  }

  updateActionRule(petId: string, id: string, patch: UpdateActionRuleInput, now = Date.now()): ActionRule {
    const current = this.listActionRules(petId).find((rule) => rule.id === id);
    if (!current) throw new Error("动作规则不存在");
    const next: ActionRule = { ...current, ...patch, updatedAt: now };
    this.db.prepare("UPDATE action_rules SET name = ?, action_id = ?, enabled = ?, duration_seconds = ?, trigger_json = ?, updated_at = ? WHERE id = ? AND pet_id = ?")
      .run(next.name, next.actionId, next.enabled ? 1 : 0, next.durationSeconds, JSON.stringify(next.trigger), now, id, petId);
    return next;
  }

  deleteActionRule(petId: string, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM action_rules WHERE id = ? AND pet_id = ?").run(id, petId).changes) > 0;
  }

  recordActionRuleTrigger(petId: string, id: string, triggeredAt: number): void {
    this.db.prepare("UPDATE action_rules SET last_triggered_at = ? WHERE id = ? AND pet_id = ?").run(triggeredAt, id, petId);
  }

  listActionProfiles(petId: string): ActionProfile[] {
    return this.db.prepare("SELECT pet_id AS petId, mode, activity_ratio AS activityRatio, strategy, items_json AS itemsJson, fallback_action_id AS fallbackActionId, updated_at AS updatedAt FROM action_profiles WHERE pet_id = ? ORDER BY CASE mode WHEN 'normal' THEN 0 WHEN 'focus' THEN 1 ELSE 2 END")
      .all(petId).map((row: any) => {
        const { itemsJson, ...fields } = row;
        return { ...fields, items: JSON.parse(itemsJson) } as ActionProfile;
      });
  }

  saveActionProfile(profile: ActionProfile): ActionProfile {
    this.db.prepare("INSERT INTO action_profiles(pet_id,mode,activity_ratio,strategy,items_json,fallback_action_id,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(pet_id,mode) DO UPDATE SET activity_ratio=excluded.activity_ratio,strategy=excluded.strategy,items_json=excluded.items_json,fallback_action_id=excluded.fallback_action_id,updated_at=excluded.updated_at")
      .run(profile.petId, profile.mode, profile.activityRatio, profile.strategy, JSON.stringify(profile.items), profile.fallbackActionId, profile.updatedAt);
    return this.listActionProfiles(profile.petId).find((item) => item.mode === profile.mode)!;
  }

  getActionMode(petId: string, now = Date.now()): ActionModeSession {
    const row = this.db.prepare("SELECT pet_id AS petId, mode, source, started_at AS startedAt, ends_at AS endsAt FROM action_mode_sessions WHERE pet_id = ?").get(petId) as ActionModeSession | undefined;
    if (!row || (row.endsAt !== null && row.endsAt <= now)) {
      if (row) this.db.prepare("DELETE FROM action_mode_sessions WHERE pet_id = ?").run(petId);
      return { petId, mode: "normal", source: "system", startedAt: now, endsAt: null };
    }
    return row;
  }

  startActionMode(petId: string, mode: Exclude<ActionMode, "normal">, durationMinutes: number, source: "manual" | "conversation", now = Date.now()): ActionModeSession {
    const session: ActionModeSession = { petId, mode, source, startedAt: now, endsAt: now + durationMinutes * 60_000 };
    this.db.prepare("INSERT INTO action_mode_sessions(pet_id,mode,source,started_at,ends_at) VALUES(?,?,?,?,?) ON CONFLICT(pet_id) DO UPDATE SET mode=excluded.mode,source=excluded.source,started_at=excluded.started_at,ends_at=excluded.ends_at")
      .run(petId, mode, source, now, session.endsAt);
    return session;
  }

  stopActionMode(petId: string, now = Date.now()): ActionModeSession {
    this.db.prepare("DELETE FROM action_mode_sessions WHERE pet_id = ?").run(petId);
    return { petId, mode: "normal", source: "system", startedAt: now, endsAt: null };
  }

  migrateActionSystemV3(petId: string, rules: CreateActionRuleInput[], profiles: ActionProfile[], now = Date.now()): boolean {
    if (this.getInitializationVersion(`action-system:${petId}`) >= 3) {
      if (this.getInitializationVersion(`focus-seated:${petId}`) < 1) {
        const focus = this.listActionProfiles(petId).find((profile) => profile.mode === "focus");
        if (focus?.activityRatio === 0.7 && focus.items[0]?.actionId === "daily-focus-cycle") this.saveActionProfile({ ...focus, activityRatio: 0.9, updatedAt: now });
        this.setInitializationVersion(`focus-seated:${petId}`, 1);
      }
      return false;
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const rule of this.listActionRules(petId)) {
        this.db.prepare("INSERT OR IGNORE INTO action_rules_v2_archive(archive_id,pet_id,rule_json,archived_at) VALUES(?,?,?,?)")
          .run(`${petId}:${rule.id}`, petId, JSON.stringify(rule), now);
      }
      this.db.prepare("DELETE FROM action_rules WHERE pet_id = ?").run(petId);
      for (const rule of rules) this.createActionRule(petId, rule, now);
      for (const profile of profiles) this.saveActionProfile({ ...profile, petId, updatedAt: now });
      this.setJson(`initialization:action-system:${petId}`, { version: 3 });
      this.setInitializationVersion(`focus-seated:${petId}`, 1);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  archivedActionRuleCount(petId: string): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS count FROM action_rules_v2_archive WHERE pet_id = ?").get(petId) as { count: number }).count);
  }

}
