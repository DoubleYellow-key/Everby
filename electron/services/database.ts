import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SETTINGS } from "../../src/core/codex-atlas";
import type { AppSettings, ChatMessage, CreateTodoInput, ModelSettings, MotionPackSummary, PersonaProfile, TodoItem, TodoSource, UpdateTodoInput } from "../../src/shared/contracts";

function defaultPersona(petId: string, name = petId, description = ""): PersonaProfile {
  return {
    petId,
    name,
    background: description || "一位聪明、自信、有行动力的桌面陪伴伙伴。",
    speakingStyle: "自然、简洁、温暖，避免空洞说教。",
    userAddress: "你",
    boundaries: "尊重隐私，不声称看到了未提供的屏幕内容，不替用户执行系统操作。"
  };
}

export const DEFAULT_MODEL: ModelSettings = { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", temperature: 0.7, configured: false };
type MemoryState = { summary: string; unsummarized: number };
type TodoRow = {
  id: string; title: string; notes: string; dueAt: number | null; remindAt: number | null; repeat: "none" | "daily";
  source: TodoSource; createdAt: number; updatedAt: number; completedAt: number | null; lastRemindedAt: number | null;
};

function nextDailyReminder(value: number, now: number): number {
  const next = new Date(value);
  while (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, pet_id TEXT NOT NULL DEFAULT 'daily', role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS motion_packs (pack_id TEXT PRIMARY KEY, version TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL, animation_count INTEGER NOT NULL, install_path TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        due_at INTEGER,
        remind_at INTEGER,
        repeat_rule TEXT NOT NULL DEFAULT 'none' CHECK(repeat_rule IN ('none', 'daily')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'chat')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        last_reminded_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS todos_reminder_idx ON todos(completed_at, remind_at, last_reminded_at);
    `);
    const messageColumns = this.db.prepare("PRAGMA table_info(messages)").all() as unknown as Array<{ name: string }>;
    if (!messageColumns.some((column) => column.name === "pet_id")) this.db.exec("ALTER TABLE messages ADD COLUMN pet_id TEXT NOT NULL DEFAULT 'daily'");
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

  private getMemoryState(petId: string): MemoryState {
    const empty = { summary: "", unsummarized: 0 };
    return this.getJson<MemoryState>(`memory:${petId}`, empty);
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

  getActivePetId(): string { return this.getJson("activePet", { id: "daily" }).id; }
  setActivePetId(petId: string): void { this.setJson("activePet", { id: petId }); }

  getPersona(petId = this.getActivePetId(), name = petId, description = ""): PersonaProfile {
    return this.getJson(`persona:${petId}`, defaultPersona(petId, name, description));
  }
  updatePersona(patch: Partial<PersonaProfile>): PersonaProfile {
    const petId = this.getActivePetId();
    const next = { ...this.getPersona(petId), ...patch, petId };
    this.setJson(`persona:${petId}`, next);
    return next;
  }

  addMessage(message: ChatMessage): void {
    const petId = this.getActivePetId();
    this.db.prepare("INSERT OR REPLACE INTO messages(id, pet_id, role, content, created_at) VALUES(?, ?, ?, ?, ?)").run(message.id, petId, message.role, message.content, message.createdAt);
    this.db.prepare("DELETE FROM messages WHERE pet_id = ? AND id NOT IN (SELECT id FROM messages WHERE pet_id = ? ORDER BY created_at DESC LIMIT 200)").run(petId, petId);
    const key = `memory:${petId}`;
    const memory = this.getMemoryState(petId);
    this.setJson(key, { ...memory, unsummarized: memory.unsummarized + 1 });
  }

  getMessages(limit = 200): ChatMessage[] {
    return (this.db.prepare("SELECT id, role, content, created_at AS createdAt FROM messages WHERE pet_id = ? ORDER BY created_at DESC LIMIT ?").all(this.getActivePetId(), limit) as unknown as ChatMessage[]).reverse();
  }

  clearMessages(): void { const petId = this.getActivePetId(); this.db.prepare("DELETE FROM messages WHERE pet_id = ?").run(petId); this.setJson(`memory:${petId}`, { summary: "", unsummarized: 0 }); }
  getMemorySummary(petId = this.getActivePetId()): string { return this.getMemoryState(petId).summary; }
  getUnsummarizedMessageCount(petId = this.getActivePetId()): number { return this.getMemoryState(petId).unsummarized; }
  setMemorySummary(summary: string, consumed = this.getUnsummarizedMessageCount(), petId = this.getActivePetId()): void {
    this.setJson(`memory:${petId}`, { summary, unsummarized: Math.max(0, this.getUnsummarizedMessageCount(petId) - consumed) });
  }

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

  private todoById(id: string): TodoItem | null {
    return (this.db.prepare(`SELECT id, title, notes, due_at AS dueAt, remind_at AS remindAt, repeat_rule AS repeat,
      source, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt, last_reminded_at AS lastRemindedAt
      FROM todos WHERE id = ?`).get(id) as unknown as TodoRow | undefined) ?? null;
  }

  listTodos(): TodoItem[] {
    return this.db.prepare(`SELECT id, title, notes, due_at AS dueAt, remind_at AS remindAt, repeat_rule AS repeat,
      source, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt, last_reminded_at AS lastRemindedAt
      FROM todos ORDER BY completed_at IS NOT NULL, COALESCE(remind_at, due_at, 9223372036854775807), created_at DESC`).all() as unknown as TodoItem[];
  }

  createTodo(input: CreateTodoInput, source: TodoSource = "manual", now = Date.now()): TodoItem {
    const id = crypto.randomUUID();
    this.db.prepare(`INSERT INTO todos(id, title, notes, due_at, remind_at, repeat_rule, source, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.title.trim(), input.notes?.trim() ?? "", input.dueAt ?? null, input.remindAt ?? null, input.repeat ?? "none", source, now, now
    );
    return this.todoById(id)!;
  }

  updateTodo(id: string, patch: UpdateTodoInput, now = Date.now()): TodoItem {
    const current = this.todoById(id);
    if (!current) throw new Error("计划不存在");
    const completedAt = patch.completed === undefined ? current.completedAt : patch.completed ? now : null;
    const reminderChanged = patch.remindAt !== undefined || patch.repeat !== undefined;
    this.db.prepare(`UPDATE todos SET title = ?, notes = ?, due_at = ?, remind_at = ?, repeat_rule = ?, updated_at = ?, completed_at = ?, last_reminded_at = ? WHERE id = ?`).run(
      patch.title?.trim() ?? current.title,
      patch.notes?.trim() ?? current.notes,
      patch.dueAt === undefined ? current.dueAt : patch.dueAt,
      patch.remindAt === undefined ? current.remindAt : patch.remindAt,
      patch.repeat ?? current.repeat,
      now,
      completedAt,
      reminderChanged ? null : current.lastRemindedAt,
      id
    );
    return this.todoById(id)!;
  }

  deleteTodo(id: string): void { this.db.prepare("DELETE FROM todos WHERE id = ?").run(id); }

  claimDueReminders(now = Date.now()): TodoItem[] {
    const due = this.db.prepare(`SELECT id, title, notes, due_at AS dueAt, remind_at AS remindAt, repeat_rule AS repeat,
      source, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt, last_reminded_at AS lastRemindedAt
      FROM todos WHERE completed_at IS NULL AND remind_at IS NOT NULL AND remind_at <= ?
      AND (repeat_rule = 'daily' OR last_reminded_at IS NULL) ORDER BY remind_at, created_at LIMIT 20`).all(now) as unknown as TodoItem[];
    for (const item of due) {
      const next = item.repeat === "daily" ? nextDailyReminder(item.remindAt!, now) : item.remindAt;
      this.db.prepare("UPDATE todos SET remind_at = ?, last_reminded_at = ?, updated_at = ? WHERE id = ?").run(next, now, now, item.id);
    }
    return due;
  }
}
