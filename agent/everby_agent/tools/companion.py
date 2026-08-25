from dataclasses import dataclass, field
from datetime import datetime
from _thread import LockType
import threading
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from langchain.tools import ToolRuntime, tool
from pydantic import BaseModel, Field

from ..persistence.database import AgentRepository
from .natural_time import infer_due_at


@dataclass
class AgentContext:
    repository: AgentRepository
    pet_id: str
    run_id: str
    timezone: str = "Asia/Shanghai"
    embed_query: Any = None
    emit: Any = None
    write_count: list[int] = field(default_factory=lambda: [0])
    listed_todos: list[bool] = field(default_factory=lambda: [False])
    operation_lock: LockType = field(default_factory=threading.Lock)
    user_input: str = ""

    def claim_write(self) -> None:
        if self.write_count[0] >= 2:
            raise RuntimeError("本轮最多执行两个写操作")
        self.write_count[0] += 1

    def tool_event(self, event_type: str, name: str, **data: Any) -> None:
        if self.emit:
            self.emit(event_type, {"toolName": name, **data}, self.run_id)


def _execute(runtime: ToolRuntime[AgentContext], name: str, operation: Any) -> Any:
    runtime.context.tool_event("tool_started", name)
    try:
        result = operation()
        runtime.context.tool_event("tool_finished", name, ok=True)
        return result
    except Exception:
        runtime.context.tool_event("tool_finished", name, ok=False)
        raise


class CreateTodoArgs(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    notes: str = Field(default="", max_length=500)
    due_at: int | None = Field(default=None, description="UTC Unix timestamp in milliseconds")
    remind_at: int | None = Field(default=None, description="UTC Unix timestamp in milliseconds")
    repeat: Literal["none", "daily"] = "none"


class CompleteTodoArgs(BaseModel):
    todo_id: str = Field(min_length=1, description="Exact ID returned by list_todos")


class SearchMemoryArgs(BaseModel):
    query: str = Field(min_length=1, max_length=500)


class RememberMemoryArgs(BaseModel):
    memory_type: Literal["preference", "identity", "goal", "project", "habit", "relationship", "commitment"]
    content: str = Field(min_length=8, max_length=1000)
    confidence: float = Field(default=1.0, ge=0, le=1)


@tool
def get_current_time(runtime: ToolRuntime[AgentContext]) -> dict[str, Any]:
    """Get the user's current local date, time, timezone, and Unix timestamp."""
    try:
        zone = ZoneInfo(runtime.context.timezone)
    except Exception:
        zone = ZoneInfo("UTC")
    def operation() -> dict[str, Any]:
        now = datetime.now(zone)
        return {"iso": now.isoformat(), "timezone": str(zone), "timestampMs": int(now.timestamp() * 1000)}
    return _execute(runtime, "get_current_time", operation)


@tool
def list_todos(runtime: ToolRuntime[AgentContext]) -> list[dict[str, Any]]:
    """List the current pet's todos. Use this before completing a todo to obtain its exact ID."""
    def operation() -> list[dict[str, Any]]:
        with runtime.context.operation_lock:
            runtime.context.listed_todos[0] = True
            return runtime.context.repository.list_todos(runtime.context.pet_id)
    return _execute(runtime, "list_todos", operation)


@tool(args_schema=CreateTodoArgs)
def create_todo(title: str, notes: str = "", due_at: int | None = None, remind_at: int | None = None,
                repeat: str = "none", runtime: ToolRuntime[AgentContext] = None) -> dict[str, Any]:
    """Create a todo only when explicitly requested. Preserve stated dates in due_at; duplicate active titles are reused."""
    assert runtime is not None
    def operation() -> dict[str, Any]:
        with runtime.context.operation_lock:
            runtime.context.claim_write()
            resolved_due_at = due_at if due_at is not None else infer_due_at(
                title, runtime.context.user_input, runtime.context.timezone,
            )
            return runtime.context.repository.create_todo(
            runtime.context.pet_id, title, notes, resolved_due_at, remind_at, repeat, "chat",
            runtime.context.run_id, runtime.tool_call_id,
            )
    return _execute(runtime, "create_todo", operation)


@tool(args_schema=CompleteTodoArgs)
def complete_todo(todo_id: str, runtime: ToolRuntime[AgentContext] = None) -> dict[str, Any]:
    """Complete a todo by its exact ID. Call list_todos first; never guess an ID."""
    assert runtime is not None
    def operation() -> dict[str, Any]:
        with runtime.context.operation_lock:
            if not runtime.context.listed_todos[0]:
                raise RuntimeError("完成待办前必须先调用 list_todos 取得准确 ID")
            runtime.context.claim_write()
            return runtime.context.repository.complete_todo(runtime.context.pet_id, todo_id, runtime.context.run_id, runtime.tool_call_id)
    return _execute(runtime, "complete_todo", operation)


@tool(args_schema=SearchMemoryArgs)
def search_memories(query: str, runtime: ToolRuntime[AgentContext] = None) -> list[dict[str, Any]]:
    """Search durable memories when recalled context is insufficient."""
    assert runtime is not None
    vector = runtime.context.embed_query(query) if runtime.context.embed_query else None
    def operation() -> list[dict[str, Any]]:
        with runtime.context.operation_lock:
            return runtime.context.repository.search_memories(runtime.context.pet_id, query, vector)
    return _execute(runtime, "search_memories", operation)


@tool(args_schema=RememberMemoryArgs)
def remember_memory(memory_type: str, content: str, confidence: float = 1.0,
                    runtime: ToolRuntime[AgentContext] = None) -> dict[str, Any]:
    """Store a durable fact only when the user explicitly asks you to remember it."""
    assert runtime is not None
    vector = runtime.context.embed_query(content) if runtime.context.embed_query else None
    def operation() -> dict[str, Any]:
        with runtime.context.operation_lock:
            runtime.context.claim_write()
            return runtime.context.repository.remember(runtime.context.pet_id, memory_type, content, confidence=confidence, vector=vector)
    return _execute(runtime, "remember_memory", operation)


def build_companion_tools():
    return [get_current_time, list_todos, create_todo, complete_todo, search_memories, remember_memory]
