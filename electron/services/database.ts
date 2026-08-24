import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS } from "../../src/core/codex-atlas";
import type { ActionRule, AppSettings, CreateActionRuleInput, EmbeddingSettings, ModelSettings, MotionPackSummary, UpdateActionRuleInput } from "../../src/shared/contracts";

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

}
