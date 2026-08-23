import json
import sys
import threading
from typing import Any, Dict

from . import __version__
from .model import AgentCancelled, CompatibleModel


class AgentServer:
    def __init__(self) -> None:
        self._model = CompatibleModel()
        self._write_lock = threading.Lock()
        self._tasks: Dict[str, threading.Event] = {}
        self._tasks_lock = threading.Lock()

    def _write(self, value: Dict[str, Any]) -> None:
        with self._write_lock:
            sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    def _complete(self, request_id: str, result: Any) -> None:
        self._write({"id": request_id, "type": "result", "result": result})

    def _run(self, request: Dict[str, Any], cancelled: threading.Event) -> None:
        request_id = str(request["id"])
        method = request.get("method")
        params = request.get("params") if isinstance(request.get("params"), dict) else {}
        try:
            if method == "health":
                self._complete(request_id, {"ok": True, "runtime": "python", "version": __version__})
            elif method == "chat":
                result = self._model.stream_chat(
                    params.get("config", {}), params.get("messages", []),
                    lambda delta: self._write({"id": request_id, "type": "delta", "delta": delta}), cancelled,
                )
                if cancelled.is_set():
                    raise AgentCancelled()
                self._complete(request_id, result)
            elif method == "plan":
                self._complete(request_id, self._model.plan(params.get("config", {}), str(params.get("transcript", ""))))
            elif method == "summarize":
                self._complete(request_id, self._model.summarize(
                    params.get("config", {}), str(params.get("previous", "")), str(params.get("transcript", "")),
                ))
            else:
                raise ValueError("未知智能体方法")
        except AgentCancelled:
            self._write({"id": request_id, "type": "error", "error": "已停止生成", "cancelled": True})
        except Exception as error:
            self._write({"id": request_id, "type": "error", "error": str(error)[:500] or "智能体请求失败"})
        finally:
            with self._tasks_lock:
                self._tasks.pop(request_id, None)

    def handle(self, request: Dict[str, Any]) -> None:
        request_id = request.get("id")
        if not isinstance(request_id, str) or len(request_id) > 100:
            return
        if request.get("method") == "cancel":
            with self._tasks_lock:
                task = self._tasks.get(request_id)
            if task:
                task.set()
            return
        cancelled = threading.Event()
        with self._tasks_lock:
            self._tasks[request_id] = cancelled
        threading.Thread(target=self._run, args=(request, cancelled), daemon=True).start()

    def serve(self) -> None:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                if isinstance(request, dict):
                    self.handle(request)
            except json.JSONDecodeError:
                continue


def run() -> None:
    AgentServer().serve()
