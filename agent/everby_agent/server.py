import asyncio
import json
import sys
import threading
from typing import Any

from pydantic import ValidationError

from . import __version__
from .runtime import AgentRuntime
from .schemas.protocol import RpcEvent, RpcRequest, RpcResult


class AgentServer:
    def __init__(self) -> None:
        self._write_lock = threading.Lock()
        self._loop = asyncio.new_event_loop()
        self._runtime = AgentRuntime(self._emit)

    def _write(self, value: dict[str, Any]) -> None:
        with self._write_lock:
            sys.stdout.write(json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    def _emit(self, event_type: str, data: dict[str, Any], request_id: str | None) -> None:
        event = RpcEvent(type=event_type, requestId=request_id, data=data)
        self._write(event.model_dump(by_alias=True, exclude_none=True))

    async def _dispatch(self, request: RpcRequest) -> Any:
        method, params = request.method, request.params
        pet_id = str(params.get("petId") or self._runtime.active_pet_id)
        if method == "runtime.health":
            return {"ok": True, "runtime": "python", "version": __version__, "protocolVersion": 2}
        if method == "runtime.configure":
            return await self._runtime.configure(params)
        if method == "runtime.presence":
            self._runtime.update_presence(params)
            return {"ok": True}
        if method == "model.probe":
            return await self._runtime.probe()
        if method == "agent.chat":
            return await self._runtime.chat(request.id, params)
        if method == "agent.cancel":
            return {"cancelled": self._runtime.cancel(str(params.get("requestId") or ""))}
        repo = self._runtime.require_repository()
        if method == "agent.snapshot":
            return self._runtime.snapshot(pet_id)
        if method == "conversation.clear":
            return {"conversationEpoch": repo.clear_conversation(pet_id)}
        if method == "persona.update":
            return repo.update_persona(pet_id, dict(params.get("patch") or {}))
        if method == "todo.list":
            return repo.list_todos(pet_id)
        if method == "todo.create":
            values = dict(params.get("input") or {})
            return repo.create_todo(pet_id, values.pop("title"), notes=values.get("notes", ""), due_at=values.get("dueAt"),
                                    remind_at=values.get("remindAt"), repeat=values.get("repeat", "none"), source="manual")
        if method == "todo.update":
            return repo.update_todo(pet_id, str(params["id"]), **dict(params.get("patch") or {}))
        if method == "todo.delete":
            repo.delete_todo(pet_id, str(params["id"])); return {"ok": True}
        if method == "memory.list":
            return repo.list_memories(pet_id)
        if method == "memory.search":
            return repo.search_memories(pet_id, str(params.get("query") or ""))
        if method == "memory.delete":
            repo.delete_memory(pet_id, str(params["id"])); return {"ok": True}
        if method == "memory.clear":
            repo.clear_memories(pet_id); return {"ok": True}
        if method == "agentSettings.update":
            return {"ok": True}
        raise ValueError("未知智能体方法")

    async def _handle(self, request: RpcRequest) -> None:
        try:
            response = RpcResult(id=request.id, result=await self._dispatch(request))
        except asyncio.CancelledError:
            response = RpcResult(id=request.id, error={"code": "cancelled", "message": "已停止生成", "retryable": False})
        except (KeyError, ValueError) as error:
            response = RpcResult(id=request.id, error={"code": "invalid_request", "message": str(error)[:500], "retryable": False})
        except Exception as error:
            response = RpcResult(id=request.id, error={"code": "agent_error", "message": str(error)[:500] or "智能体请求失败", "retryable": True})
        self._write(response.model_dump(by_alias=True, exclude_none=True))

    def handle(self, value: dict[str, Any]) -> None:
        try:
            request = RpcRequest.model_validate(value)
        except ValidationError as error:
            request_id = value.get("id") if isinstance(value.get("id"), str) else "invalid"
            response = RpcResult(id=request_id, error={"code": "invalid_protocol", "message": str(error)[:500], "retryable": False})
            self._write(response.model_dump(by_alias=True, exclude_none=True)); return
        asyncio.run_coroutine_threadsafe(self._handle(request), self._loop)

    def serve(self) -> None:
        ready = threading.Event()
        thread = threading.Thread(target=self._loop.run_forever, daemon=True)
        thread.start()
        self._loop.call_soon_threadsafe(ready.set)
        ready.wait(timeout=5)
        try:
            for line in sys.stdin:
                try:
                    value = json.loads(line)
                    if isinstance(value, dict): self.handle(value)
                except json.JSONDecodeError as error:
                    self._emit("error", {"code": "invalid_json", "message": "请求不是有效 JSON", "retryable": False,
                                         "position": error.pos, "lineLength": len(line), "reason": error.msg}, None)
        finally:
            future = asyncio.run_coroutine_threadsafe(self._runtime.close(), self._loop)
            try: future.result(timeout=5)
            finally: self._loop.call_soon_threadsafe(self._loop.stop)


def run() -> None:
    AgentServer().serve()
