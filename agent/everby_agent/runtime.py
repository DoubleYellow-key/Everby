import asyncio
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Callable

import aiosqlite
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from .graph.companion import CompanionGraph
from .persistence.database import AgentRepository
from .workflows import AgentScheduler, MemoryCurator, compose_reminder_copy

os.environ.setdefault("LANGSMITH_TRACING", "false")
os.environ.setdefault("LANGGRAPH_STRICT_MSGPACK", "true")


def backup_and_reset_legacy(path: Path) -> Path | None:
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
        if "messages" in tables:
            source.execute("DELETE FROM messages")
        if "todos" in tables:
            source.execute("DELETE FROM todos")
        if "kv" in tables:
            source.execute("DELETE FROM kv WHERE key LIKE 'persona:%' OR key LIKE 'memory:%'")
        source.commit()
        return backup
    finally:
        source.close()


class AgentRuntime:
    def __init__(self, emit: Callable[[str, dict[str, Any], str | None], None]):
        self.emit = emit
        self.repository: AgentRepository | None = None
        self.chat_model: ChatOpenAI | None = None
        self.embeddings: OpenAIEmbeddings | None = None
        self.graph: CompanionGraph | None = None
        self.checkpoint_connection: aiosqlite.Connection | None = None
        self.checkpointer: AsyncSqliteSaver | None = None
        self.active_pet_id = "daily"
        self.active_pet_name = "Daily"
        self.active_pet_description = ""
        self.timezone = "Asia/Shanghai"
        self.capabilities = {"streaming": False, "toolCalling": False, "embedding": False}
        self.status = "unconfigured"
        self.tasks: dict[str, asyncio.Task[Any]] = {}
        self.scheduler: AgentScheduler | None = None
        self.curator: MemoryCurator | None = None

    async def configure(self, params: dict[str, Any]) -> dict[str, Any]:
        db_path = Path(str(params.get("databasePath", ""))).resolve()
        if not db_path.name:
            raise ValueError("databasePath is required")
        if self.repository and self.repository.path != db_path:
            await self.close()
        self.emit("agent_progress", {"node": "configure_backup"}, None)
        backup = backup_and_reset_legacy(db_path)
        self.emit("agent_progress", {"node": "configure_database"}, None)
        if self.repository is None:
            self.repository = AgentRepository(db_path)
            self.repository.db.execute("INSERT INTO agent_meta(key,value) VALUES('protocol_version','2') ON CONFLICT(key) DO UPDATE SET value='2'")
            self.repository.db.commit()
        self.active_pet_id = str(params.get("petId") or "daily")[:100]
        self.active_pet_name = str(params.get("petName") or self.active_pet_id)[:80]
        self.active_pet_description = str(params.get("petDescription") or "")[:2000]
        self.timezone = str(params.get("timezone") or "Asia/Shanghai")[:100]
        chat = params.get("chat") if isinstance(params.get("chat"), dict) else {}
        embedding = params.get("embedding") if isinstance(params.get("embedding"), dict) else {}
        self.chat_model = self._chat_model(chat) if chat.get("apiKey") and chat.get("model") else None
        self.embeddings = self._embeddings(embedding) if embedding.get("apiKey") and embedding.get("model") else None
        if self.chat_model and self.checkpointer is None:
            self.emit("agent_progress", {"node": "configure_checkpoint"}, None)
            self.checkpoint_connection = await aiosqlite.connect(db_path)
            self.checkpointer = AsyncSqliteSaver(self.checkpoint_connection, serde=JsonPlusSerializer(pickle_fallback=False))
            await self.checkpointer.setup()
        self.capabilities = {"streaming": bool(self.chat_model), "toolCalling": False, "embedding": bool(self.embeddings)}
        self.status = "ready" if self.chat_model else "unconfigured"
        if self.scheduler is None:
            self.scheduler = AgentScheduler(self.require_repository(), self.emit, self._compose_reminder)
            self.scheduler.start()
        if self.chat_model:
            if self.curator:
                await self.curator.close()
            self.curator = MemoryCurator(self.require_repository(), self.chat_model,
                                         self.embeddings.embed_query if self.embeddings else None, self.emit)
        self._rebuild_graph()
        self.emit("agent_progress", {"node": "configure_done"}, None)
        return {"ok": True, "backupPath": str(backup) if backup else None, "capabilities": self.capabilities, "status": self.status}

    @staticmethod
    def _chat_model(config: dict[str, Any]) -> ChatOpenAI:
        return ChatOpenAI(base_url=str(config.get("baseUrl", "")).rstrip("/"), api_key=str(config["apiKey"]),
                          model=str(config["model"]), temperature=float(config.get("temperature", 0.7)),
                          timeout=45, max_retries=1, streaming=True)

    @staticmethod
    def _embeddings(config: dict[str, Any]) -> OpenAIEmbeddings:
        return OpenAIEmbeddings(base_url=str(config.get("baseUrl", "")).rstrip("/"), api_key=str(config["apiKey"]),
                                model=str(config["model"]), timeout=20, max_retries=1)

    def _rebuild_graph(self) -> None:
        if self.repository and self.chat_model:
            embed = self.embeddings.embed_query if self.embeddings and self.capabilities["embedding"] else None
            self.graph = CompanionGraph(self.repository, self.chat_model, dict(self.capabilities), self.checkpointer, embed, self.timezone, self.emit)
        else:
            self.graph = None

    def require_repository(self) -> AgentRepository:
        if not self.repository:
            raise RuntimeError("runtime.configure must be called first")
        return self.repository

    async def _compose_reminder(self, pet_id: str, todos: list[dict[str, Any]]) -> str | None:
        if not self.chat_model or self.tasks:
            return None
        persona = self.require_repository().get_persona(
            pet_id,
            self.active_pet_name if pet_id == self.active_pet_id else pet_id,
            self.active_pet_description if pet_id == self.active_pet_id else "",
        )
        return await compose_reminder_copy(self.chat_model, persona, todos)

    async def probe(self) -> dict[str, Any]:
        if not self.chat_model:
            self.capabilities = {"streaming": False, "toolCalling": False, "embedding": False}
            return self.capabilities
        streaming = tool_calling = embedding = False
        try:
            async for chunk in self.chat_model.astream("Reply with OK"):
                streaming = streaming or bool(chunk.content)
        except Exception:
            pass
        try:
            probe_tool = {"type": "function", "function": {"name": "capability_probe", "description": "Capability probe", "parameters": {"type": "object", "properties": {}}}}
            response = await self.chat_model.bind_tools([probe_tool], tool_choice="capability_probe").ainvoke("Run the capability probe")
            tool_calling = bool(response.tool_calls)
        except Exception:
            pass
        if self.embeddings:
            try:
                embedding = bool(await self.embeddings.aembed_query("capability probe"))
            except Exception:
                pass
        self.capabilities = {"streaming": streaming, "toolCalling": tool_calling, "embedding": embedding}
        self.status = "ready" if streaming else "degraded"
        self._rebuild_graph()
        self.emit("state_changed", {"capabilities": self.capabilities, "status": self.status}, None)
        return self.capabilities

    async def chat(self, request_id: str, params: dict[str, Any]) -> dict[str, Any]:
        if not self.graph:
            raise RuntimeError("聊天模型尚未配置")
        pet_id = str(params.get("petId") or self.active_pet_id)
        content = str(params.get("content") or "").strip()
        if not content or len(content) > 4000:
            raise ValueError("消息内容无效")
        self.emit("agent_progress", {"node": "load_context"}, request_id)
        task = asyncio.create_task(self.graph.invoke(pet_id, request_id, content))
        self.tasks[request_id] = task
        try:
            result = await task
            reply = result.get("reply", "")
            self.emit("assistant_delta", {"delta": reply}, request_id)
            self.emit("pet_action", {"actionIntent": result.get("action_intent", "idle")}, request_id)
            self.emit("assistant_done", {"content": reply, "capabilities": self.capabilities}, request_id)
            if self.curator and self.capabilities.get("toolCalling"):
                self.curator.enqueue(pet_id)
            return {"content": reply, "actionIntent": result.get("action_intent", "idle"), "capabilities": self.capabilities}
        finally:
            self.tasks.pop(request_id, None)

    def cancel(self, target_id: str) -> bool:
        task = self.tasks.get(target_id)
        if task:
            task.cancel()
            return True
        return False

    def snapshot(self, pet_id: str | None = None) -> dict[str, Any]:
        repo = self.require_repository()
        pet = pet_id or self.active_pet_id
        memories = repo.list_memories(pet)
        default_name = self.active_pet_name if pet == self.active_pet_id else pet
        default_description = self.active_pet_description if pet == self.active_pet_id else ""
        return {"petId": pet, "persona": repo.get_persona(pet, default_name, default_description), "messages": repo.list_messages(pet),
                "todos": repo.list_todos(pet), "memories": memories,
                "memorySummary": "\n".join(item["content"] for item in memories[:8]),
                "agentCapabilities": self.capabilities, "agentStatus": self.status,
                "embeddingStatus": "ready" if self.capabilities["embedding"] else ("unconfigured" if not self.embeddings else "degraded")}

    def update_presence(self, params: dict[str, Any]) -> None:
        if self.scheduler:
            self.scheduler.update_presence(str(params.get("petId") or self.active_pet_id),
                                           dict(params.get("settings") or {}), str(params.get("idleState") or "active"))

    async def close(self) -> None:
        for task in self.tasks.values():
            task.cancel()
        self.tasks.clear()
        if self.curator:
            await self.curator.close(); self.curator = None
        if self.scheduler:
            await self.scheduler.close(); self.scheduler = None
        if self.checkpoint_connection:
            await self.checkpoint_connection.close()
            self.checkpoint_connection = None
        if self.repository:
            self.repository.close()
            self.repository = None
