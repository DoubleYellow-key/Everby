import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from .database import AgentRepository


def backup_legacy_database(path: Path) -> Path | None:
    if not path.exists() or path.stat().st_size == 0:
        return None
    source = sqlite3.connect(path)
    try:
        tables = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "agent_meta" in tables:
            marker = source.execute("SELECT value FROM agent_meta WHERE key='protocol_version'").fetchone()
            if marker and marker[0] == "2":
                return None
        backup = path.with_name(f"{path.stem}-pre-v2-{time.strftime('%Y%m%d-%H%M%S')}{path.suffix}.bak")
        destination = sqlite3.connect(backup)
        try:
            source.backup(destination)
        finally:
            destination.close()
        return backup
    finally:
        source.close()


def _tables(repository: AgentRepository) -> set[str]:
    return {row[0] for row in repository.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _json_rows(repository: AgentRepository, prefix: str) -> list[tuple[str, dict[str, Any]]]:
    rows: list[tuple[str, dict[str, Any]]] = []
    for key, value in repository.db.execute("SELECT key,value FROM kv WHERE key LIKE ?", (f"{prefix}%",)):
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(parsed, dict):
            rows.append((key.removeprefix(prefix), parsed))
    return rows


def migrate_legacy_data(repository: AgentRepository) -> bool:
    if repository.db.execute("SELECT 1 FROM agent_meta WHERE key='legacy_v1_migrated'").fetchone():
        return False
    tables = _tables(repository)
    migrated = False
    repository.db.execute("BEGIN IMMEDIATE")
    try:
        if "messages" in tables:
            columns = {row[1] for row in repository.db.execute("PRAGMA table_info(messages)")}
            pet_expression = "COALESCE(pet_id,'daily')" if "pet_id" in columns else "'daily'"
            repository.db.execute(f"""INSERT OR IGNORE INTO agent_messages(id,pet_id,epoch,role,content,created_at)
                SELECT id,{pet_expression},0,role,content,created_at FROM messages
                WHERE role IN ('user','assistant')""")
            migrated = migrated or repository.db.execute("SELECT EXISTS(SELECT 1 FROM messages)").fetchone()[0] == 1
        if "todos" in tables:
            for row in repository.db.execute("SELECT id,title,notes,due_at,remind_at,repeat_rule,source,created_at,updated_at,completed_at,last_reminded_at FROM todos"):
                title = " ".join(str(row[1]).split()).strip()[:160]
                if not title:
                    continue
                repository.db.execute("""INSERT OR IGNORE INTO agent_todos
                    (id,pet_id,title,normalized_title,notes,due_at,remind_at,repeat_rule,source,created_at,updated_at,completed_at,last_reminded_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                    row[0], "daily", title, title.casefold(), str(row[2] or "")[:500], row[3], row[4],
                    row[5] if row[5] in {"none", "daily"} else "none", row[6] if row[6] in {"manual", "chat"} else "manual",
                    row[7], row[8], row[9], row[10],
                ))
                migrated = True
        if "kv" in tables:
            for pet_id, persona in _json_rows(repository, "persona:"):
                repository.db.execute("INSERT OR IGNORE INTO agent_personas VALUES(?,?,?)", (
                    pet_id or "daily", json.dumps({**persona, "petId": pet_id or "daily"}, ensure_ascii=True), int(time.time() * 1000)
                ))
                migrated = True
            for pet_id, memory in _json_rows(repository, "memory:"):
                summary = str(memory.get("summary") or "").strip()
                if not summary:
                    continue
                memory_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"everby:legacy-summary:{pet_id}"))
                now = int(time.time() * 1000)
                repository.db.execute("INSERT OR IGNORE INTO agent_memories VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (
                    memory_id, pet_id or "daily", "project", summary[:1000], summary.casefold()[:1000], None,
                    0.8, None, None, now, now, now,
                ))
                repository.db.execute("INSERT OR IGNORE INTO agent_memory_fts(memory_id,pet_id,content) VALUES(?,?,?)", (memory_id, pet_id or "daily", summary[:1000]))
                migrated = True
        repository.db.execute("INSERT INTO agent_meta(key,value) VALUES('legacy_v1_migrated','1')")
        repository.db.execute("COMMIT")
        return migrated
    except Exception:
        repository.db.execute("ROLLBACK")
        raise
