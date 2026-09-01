import json
import math
import re
import sqlite3
import struct
import time
import uuid
from pathlib import Path
from typing import Any, Iterable, Sequence

from ..memory.filters import is_safe_memory

MEMORY_TYPES = {"preference", "identity", "goal", "project", "habit", "relationship", "commitment"}
DEFAULT_PERSONA_BACKGROUND = "一位桌面陪伴伙伴，关心用户，回应专注可靠。"
DEFAULT_PERSONA_STYLE = "克制、自然、简洁。不主动自我介绍，不重复称呼，关心通过准确回应和行动体现。"
DEFAULT_PERSONA_BOUNDARIES = "尊重隐私，不假装看到了未提供的信息；不使用虚假的热情或套话。"
# 旧版本合成过的默认人设值：命中说明该字段从未被用户真正编辑过，可安全重写为当前角色自己的默认
LEGACY_PERSONA_BACKGROUNDS = {
    "一位聪明、自然、温暖的桌面陪伴伙伴。",
    "一位冷静、可靠、略显高冷的桌面陪伴伙伴。关心用户，但不刻意表现热络。",
}
LEGACY_PERSONA_STYLES = {
    "",
    "像熟悉的朋友一样自然简洁。",
    "高冷、克制、简短。少用语气词、感叹号和卖萌表达；不主动自我介绍，不重复称呼，关心通过准确回应和行动体现。",
}
# 与 src/shared/contracts.ts 的 personaPatchSchema 上限对齐
PERSONA_FIELD_CAPS = {"background": 2000, "speakingStyle": 1000, "userAddress": 40, "boundaries": 2000}


def sanitize_persona_defaults(value: Any) -> dict[str, str]:
    """pet.json 声明的 persona 默认值是外部数据：只接受非空字符串并按上限截断。"""
    if not isinstance(value, dict):
        return {}
    return {
        key: field.strip()[:cap]
        for key, cap in PERSONA_FIELD_CAPS.items()
        if isinstance((field := value.get(key)), str) and field.strip()
    }


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalized(value: str) -> str:
    return " ".join(value.casefold().split())


def _pack_vector(vector: Sequence[float] | None) -> bytes | None:
    if not vector:
        return None
    return struct.pack(f"<{len(vector)}f", *vector)


def _unpack_vector(value: bytes | None) -> list[float] | None:
    if not value:
        return None
    return list(struct.unpack(f"<{len(value) // 4}f", value))


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        return -1.0
    denominator = math.sqrt(sum(x * x for x in left)) * math.sqrt(sum(x * x for x in right))
    return sum(x * y for x, y in zip(left, right)) / denominator if denominator else -1.0


class AgentRepository:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=5000")
        self._setup()

    def _setup(self) -> None:
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS agent_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_messages(
          id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, epoch INTEGER NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS agent_messages_thread_idx ON agent_messages(pet_id, epoch, created_at);
        CREATE TABLE IF NOT EXISTS agent_todos(
          id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '', due_at INTEGER, remind_at INTEGER,
          repeat_rule TEXT NOT NULL DEFAULT 'none' CHECK(repeat_rule IN ('none','daily')),
          source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','chat')),
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER, last_reminded_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS agent_todos_pet_idx ON agent_todos(pet_id, completed_at, remind_at);
        CREATE TABLE IF NOT EXISTS agent_memories(
          id TEXT PRIMARY KEY, pet_id TEXT NOT NULL, memory_type TEXT NOT NULL, content TEXT NOT NULL,
          normalized_content TEXT NOT NULL, source_message_id TEXT, confidence REAL NOT NULL,
          vector BLOB, embedding_model TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          accessed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS agent_memories_pet_idx ON agent_memories(pet_id, memory_type, updated_at);
        CREATE VIRTUAL TABLE IF NOT EXISTS agent_memory_fts USING fts5(memory_id UNINDEXED, pet_id UNINDEXED, content, tokenize='unicode61');
        CREATE TABLE IF NOT EXISTS agent_tool_runs(
          operation_key TEXT PRIMARY KEY, tool_name TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_personas(pet_id TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_settings(pet_id TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
        """)
        message_columns = {row[1] for row in self.db.execute("PRAGMA table_info(agent_messages)")}
        if "attachments_json" not in message_columns:
            self.db.execute("ALTER TABLE agent_messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'")
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    def epoch(self, pet_id: str) -> int:
        row = self.db.execute("SELECT value FROM agent_meta WHERE key=?", (f"epoch:{pet_id}",)).fetchone()
        return int(row[0]) if row else 0

    def clear_conversation(self, pet_id: str) -> int:
        epoch = self.epoch(pet_id) + 1
        self.db.execute("INSERT INTO agent_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (f"epoch:{pet_id}", str(epoch)))
        self.db.commit()
        return epoch

    def delete_pet_data(self, pet_id: str) -> None:
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("DELETE FROM agent_memory_fts WHERE pet_id=?", (pet_id,))
            for table in ("agent_messages", "agent_todos", "agent_memories", "agent_personas", "agent_settings"):
                self.db.execute(f"DELETE FROM {table} WHERE pet_id=?", (pet_id,))
            self.db.execute("DELETE FROM agent_meta WHERE key=?", (f"epoch:{pet_id}",))
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def add_message(self, pet_id: str, role: str, content: str, message_id: str | None = None,
                    created_at: int | None = None, attachments: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        if role not in {"user", "assistant"}:
            raise ValueError("invalid message role")
        item = {"id": message_id or str(uuid.uuid4()), "role": role, "content": content,
                "createdAt": created_at or _now_ms(), "attachments": attachments or []}
        self.db.execute("INSERT OR REPLACE INTO agent_messages(id,pet_id,epoch,role,content,created_at,attachments_json) VALUES(?,?,?,?,?,?,?)",
                        (item["id"], pet_id, self.epoch(pet_id), role, content, item["createdAt"],
                         json.dumps(item["attachments"], ensure_ascii=True)))
        self.db.execute("DELETE FROM agent_messages WHERE pet_id=? AND epoch=? AND id NOT IN (SELECT id FROM agent_messages WHERE pet_id=? AND epoch=? ORDER BY created_at DESC, rowid DESC LIMIT 200)",
                        (pet_id, self.epoch(pet_id), pet_id, self.epoch(pet_id)))
        self.db.commit()
        return item

    def list_messages(self, pet_id: str, limit: int = 200) -> list[dict[str, Any]]:
        rows = self.db.execute("SELECT id,role,content,created_at AS createdAt,attachments_json AS attachmentsJson FROM agent_messages WHERE pet_id=? AND epoch=? ORDER BY created_at DESC, rowid DESC LIMIT ?",
                               (pet_id, self.epoch(pet_id), limit)).fetchall()
        result = []
        for row in reversed(rows):
            item = dict(row)
            item["attachments"] = json.loads(item.pop("attachmentsJson") or "[]")
            result.append(item)
        return result

    def _idempotent(self, run_id: str | None, tool_call_id: str | None) -> dict[str, Any] | None:
        if not run_id or not tool_call_id:
            return None
        row = self.db.execute("SELECT result_json FROM agent_tool_runs WHERE operation_key=?", (f"{run_id}:{tool_call_id}",)).fetchone()
        return json.loads(row[0]) if row else None

    def _save_operation(self, run_id: str | None, tool_call_id: str | None, name: str, result: dict[str, Any]) -> None:
        if run_id and tool_call_id:
            self.db.execute("INSERT OR IGNORE INTO agent_tool_runs VALUES(?,?,?,?)", (f"{run_id}:{tool_call_id}", name, json.dumps(result, ensure_ascii=True), _now_ms()))

    def create_todo(self, pet_id: str, title: str, notes: str = "", due_at: int | None = None, remind_at: int | None = None,
                    repeat: str = "none", source: str = "manual", run_id: str | None = None, tool_call_id: str | None = None) -> dict[str, Any]:
        previous = self._idempotent(run_id, tool_call_id)
        if previous:
            return previous
        title = " ".join(title.split()).strip()[:160]
        if not title or repeat not in {"none", "daily"} or source not in {"manual", "chat"}:
            raise ValueError("invalid todo")
        normalized = _normalized(title)
        row = self.db.execute("SELECT * FROM agent_todos WHERE pet_id=? AND normalized_title=? AND completed_at IS NULL", (pet_id, normalized)).fetchone()
        now = _now_ms()
        if row:
            self.db.execute(
                """UPDATE agent_todos SET
                   notes=CASE WHEN notes='' THEN ? ELSE notes END,
                   due_at=COALESCE(due_at,?), remind_at=COALESCE(remind_at,?),
                   repeat_rule=CASE WHEN repeat_rule='none' THEN ? ELSE repeat_rule END,
                   updated_at=? WHERE id=?""",
                (notes.strip()[:500], due_at, remind_at, repeat, now, row["id"]),
            )
            result = self.todo_by_id(pet_id, row["id"])
        else:
            todo_id = str(uuid.uuid4())
            self.db.execute("INSERT INTO agent_todos(id,pet_id,title,normalized_title,notes,due_at,remind_at,repeat_rule,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                            (todo_id, pet_id, title, normalized, notes.strip()[:500], due_at, remind_at, repeat, source, now, now))
            result = self.todo_by_id(pet_id, todo_id)
        self._save_operation(run_id, tool_call_id, "create_todo", result)
        self.db.commit()
        return result

    @staticmethod
    def _todo(row: sqlite3.Row) -> dict[str, Any]:
        return {"id": row["id"], "title": row["title"], "notes": row["notes"], "dueAt": row["due_at"], "remindAt": row["remind_at"],
                "repeat": row["repeat_rule"], "source": row["source"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
                "completedAt": row["completed_at"], "lastRemindedAt": row["last_reminded_at"]}

    def todo_by_id(self, pet_id: str, todo_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT * FROM agent_todos WHERE pet_id=? AND id=?", (pet_id, todo_id)).fetchone()
        if not row:
            raise KeyError("todo not found")
        return self._todo(row)

    def list_todos(self, pet_id: str) -> list[dict[str, Any]]:
        return [self._todo(row) for row in self.db.execute("SELECT * FROM agent_todos WHERE pet_id=? ORDER BY completed_at IS NOT NULL, COALESCE(remind_at,due_at,9223372036854775807), created_at DESC, rowid DESC", (pet_id,))]

    def update_todo(self, pet_id: str, todo_id: str, **patch: Any) -> dict[str, Any]:
        current = self.todo_by_id(pet_id, todo_id)
        completed = patch.get("completed")
        self.db.execute("UPDATE agent_todos SET title=?,normalized_title=?,notes=?,due_at=?,remind_at=?,repeat_rule=?,completed_at=?,updated_at=? WHERE pet_id=? AND id=?", (
            patch.get("title", current["title"]), _normalized(patch.get("title", current["title"])), patch.get("notes", current["notes"]),
            patch.get("dueAt", current["dueAt"]), patch.get("remindAt", current["remindAt"]), patch.get("repeat", current["repeat"]),
            current["completedAt"] if completed is None else (_now_ms() if completed else None), _now_ms(), pet_id, todo_id))
        self.db.commit()
        return self.todo_by_id(pet_id, todo_id)

    def delete_todo(self, pet_id: str, todo_id: str) -> None:
        self.db.execute("DELETE FROM agent_todos WHERE pet_id=? AND id=?", (pet_id, todo_id))
        self.db.commit()

    def complete_todo(self, pet_id: str, todo_id: str, run_id: str | None = None, tool_call_id: str | None = None) -> dict[str, Any]:
        previous = self._idempotent(run_id, tool_call_id)
        if previous:
            return previous
        result = self.update_todo(pet_id, todo_id, completed=True)
        self._save_operation(run_id, tool_call_id, "complete_todo", result)
        self.db.commit()
        return result

    def claim_due_reminders(self, pet_id: str, now: int | None = None) -> list[dict[str, Any]]:
        now = now or _now_ms()
        rows = self.db.execute("SELECT * FROM agent_todos WHERE pet_id=? AND completed_at IS NULL AND remind_at IS NOT NULL AND remind_at<=? AND (repeat_rule='daily' OR last_reminded_at IS NULL) ORDER BY remind_at LIMIT 20", (pet_id, now)).fetchall()
        results = [self._todo(row) for row in rows]
        for item in results:
            next_reminder = item["remindAt"]
            if item["repeat"] == "daily":
                while next_reminder <= now:
                    next_reminder += 24 * 60 * 60 * 1000
            self.db.execute("UPDATE agent_todos SET remind_at=?,last_reminded_at=?,updated_at=? WHERE id=?", (next_reminder, now, now, item["id"]))
        self.db.commit()
        return results

    def remember(self, pet_id: str, memory_type: str, content: str, source_message_id: str | None = None, confidence: float = 1.0,
                 vector: Sequence[float] | None = None, embedding_model: str | None = None) -> dict[str, Any]:
        if memory_type not in MEMORY_TYPES:
            raise ValueError("invalid memory type")
        content = " ".join(content.split()).strip()[:1000]
        if not is_safe_memory(content):
            raise ValueError("memory is unsafe or transient")
        existing = self.db.execute("SELECT * FROM agent_memories WHERE pet_id=? AND memory_type=?", (pet_id, memory_type)).fetchall()
        match = next((row for row in existing if row["normalized_content"] == _normalized(content)), None)
        if match is None and vector:
            match = next((row for row in existing if row["vector"] and _cosine(vector, _unpack_vector(row["vector"]) or []) >= 0.92), None)
        now = _now_ms()
        memory_id = match["id"] if match else str(uuid.uuid4())
        if match:
            self.db.execute("UPDATE agent_memories SET content=?,normalized_content=?,source_message_id=COALESCE(?,source_message_id),confidence=MAX(confidence,?),vector=COALESCE(?,vector),embedding_model=COALESCE(?,embedding_model),updated_at=?,accessed_at=? WHERE id=?",
                            (content, _normalized(content), source_message_id, confidence, _pack_vector(vector), embedding_model, now, now, memory_id))
            self.db.execute("DELETE FROM agent_memory_fts WHERE memory_id=?", (memory_id,))
        else:
            self.db.execute("INSERT INTO agent_memories VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                            (memory_id, pet_id, memory_type, content, _normalized(content), source_message_id, max(0, min(1, confidence)), _pack_vector(vector), embedding_model, now, now, now))
        self.db.execute("INSERT INTO agent_memory_fts(memory_id,pet_id,content) VALUES(?,?,?)", (memory_id, pet_id, content))
        self.db.commit()
        return self.memory_by_id(pet_id, memory_id)

    @staticmethod
    def _memory(row: sqlite3.Row) -> dict[str, Any]:
        return {"id": row["id"], "type": row["memory_type"], "content": row["content"], "sourceMessageId": row["source_message_id"],
                "confidence": row["confidence"], "embeddingModel": row["embedding_model"], "createdAt": row["created_at"],
                "updatedAt": row["updated_at"], "accessedAt": row["accessed_at"], "indexed": row["vector"] is not None}

    def memory_by_id(self, pet_id: str, memory_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT * FROM agent_memories WHERE pet_id=? AND id=?", (pet_id, memory_id)).fetchone()
        if not row:
            raise KeyError("memory not found")
        return self._memory(row)

    def list_memories(self, pet_id: str) -> list[dict[str, Any]]:
        return [self._memory(row) for row in self.db.execute("SELECT * FROM agent_memories WHERE pet_id=? ORDER BY updated_at DESC", (pet_id,))]

    def delete_memory(self, pet_id: str, memory_id: str) -> None:
        self.db.execute("DELETE FROM agent_memories WHERE pet_id=? AND id=?", (pet_id, memory_id))
        self.db.execute("DELETE FROM agent_memory_fts WHERE pet_id=? AND memory_id=?", (pet_id, memory_id))
        self.db.commit()

    def clear_memories(self, pet_id: str) -> None:
        self.db.execute("DELETE FROM agent_memories WHERE pet_id=?", (pet_id,))
        self.db.execute("DELETE FROM agent_memory_fts WHERE pet_id=?", (pet_id,))
        self.db.commit()

    def search_memories(self, pet_id: str, query: str, query_vector: Sequence[float] | None = None, limit: int = 5) -> list[dict[str, Any]]:
        lexical_ids: list[str] = []
        terms = re.findall(r"[\w\u4e00-\u9fff]+", query.casefold())
        if terms:
            match_query = " OR ".join(f'"{term}"' for term in terms[:12])
            try:
                lexical_ids = [row[0] for row in self.db.execute("SELECT memory_id FROM agent_memory_fts WHERE pet_id=? AND agent_memory_fts MATCH ? ORDER BY rank LIMIT 8", (pet_id, match_query))]
            except sqlite3.OperationalError:
                lexical_ids = []
        rows = self.db.execute("SELECT * FROM agent_memories WHERE pet_id=?", (pet_id,)).fetchall()
        vector_ids: list[str] = []
        if query_vector:
            ranked = sorted(((row["id"], _cosine(query_vector, _unpack_vector(row["vector"]) or [])) for row in rows if row["vector"]), key=lambda item: item[1], reverse=True)
            vector_ids = [item[0] for item in ranked[:8] if item[1] > -1]
        scores: dict[str, float] = {}
        for ranking in (lexical_ids, vector_ids):
            for rank, memory_id in enumerate(ranking, 1):
                scores[memory_id] = scores.get(memory_id, 0) + 1 / (60 + rank)
        selected = [memory_id for memory_id, _ in sorted(scores.items(), key=lambda item: item[1], reverse=True)[:limit]]
        if selected:
            self.db.executemany("UPDATE agent_memories SET accessed_at=? WHERE id=?", ((_now_ms(), item) for item in selected))
            self.db.commit()
        by_id = {row["id"]: self._memory(row) for row in rows}
        return [by_id[item] for item in selected]

    def get_persona(self, pet_id: str, name: str = "Daily", description: str = "",
                    defaults: dict[str, Any] | None = None) -> dict[str, Any]:
        row = self.db.execute("SELECT value_json FROM agent_personas WHERE pet_id=?", (pet_id,)).fetchone()
        if row:
            return json.loads(row[0])
        overrides = sanitize_persona_defaults(defaults)
        return {
            "petId": pet_id,
            "name": name,
            "background": overrides.get("background") or description or DEFAULT_PERSONA_BACKGROUND,
            "speakingStyle": overrides.get("speakingStyle") or DEFAULT_PERSONA_STYLE,
            "userAddress": overrides.get("userAddress") or "你",
            "boundaries": overrides.get("boundaries") or DEFAULT_PERSONA_BOUNDARIES,
        }

    def migrate_legacy_persona_defaults(self, pet_id: str, defaults: dict[str, Any] | None = None,
                                        description: str = "") -> dict[str, Any]:
        row = self.db.execute("SELECT value_json FROM agent_personas WHERE pet_id=?", (pet_id,)).fetchone()
        if not row:
            return self.get_persona(pet_id, description=description, defaults=defaults)
        value = json.loads(row[0])
        overrides = sanitize_persona_defaults(defaults)
        changed = False
        if value.get("speakingStyle", "") in LEGACY_PERSONA_STYLES:
            value["speakingStyle"] = overrides.get("speakingStyle") or DEFAULT_PERSONA_STYLE
            changed = True
        if value.get("background") in LEGACY_PERSONA_BACKGROUNDS:
            value["background"] = overrides.get("background") or description or DEFAULT_PERSONA_BACKGROUND
            changed = True
        if changed:
            return self.update_persona(pet_id, value)
        return value

    def update_persona(self, pet_id: str, patch: dict[str, Any], *, name: str = "Daily",
                       description: str = "", defaults: dict[str, Any] | None = None) -> dict[str, Any]:
        value = {**self.get_persona(pet_id, name, description, defaults), **patch, "petId": pet_id}
        self.db.execute("INSERT INTO agent_personas VALUES(?,?,?) ON CONFLICT(pet_id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", (pet_id, json.dumps(value, ensure_ascii=True), _now_ms()))
        self.db.commit()
        return value
