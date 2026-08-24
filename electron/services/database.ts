import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS } from "../../src/core/codex-atlas";
import type { AppSettings, EmbeddingSettings, ModelSettings, MotionPackSummary } from "../../src/shared/contracts";

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

  listMotionPacks(): MotionPackSummary[] {
    return this.db.prepare("SELECT pack_id AS packId, version, name, enabled, animation_count AS animationCount FROM motion_packs ORDER BY name").all().map((row: any) => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  saveMotionPack(pack: MotionPackSummary, installPath: string): void {
    this.db.prepare("INSERT INTO motion_packs VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(pack_id) DO UPDATE SET version=excluded.version,name=excluded.name,enabled=excluded.enabled,animation_count=excluded.animation_count,install_path=excluded.install_path")
      .run(pack.packId, pack.version, pack.name, pack.enabled ? 1 : 0, pack.animationCount, installPath);
  }

  setMotionPackEnabled(packId: string, enabled: boolean): void { this.db.prepare("UPDATE motion_packs SET enabled = ? WHERE pack_id = ?").run(enabled ? 1 : 0, packId); }
  getMotionPackPath(packId: string): string | null { return (this.db.prepare("SELECT install_path AS path FROM motion_packs WHERE pack_id = ?").get(packId) as { path: string } | undefined)?.path ?? null; }
  deleteMotionPack(packId: string): void { this.db.prepare("DELETE FROM motion_packs WHERE pack_id = ?").run(packId); }

}
