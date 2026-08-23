import json
import time
from datetime import datetime
from typing import Any, Callable, Dict, Iterable, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ACTION_INTENTS = {
    "idle", "greet", "happy", "encourage", "think", "work", "wait",
    "celebrate", "tired", "confused",
}
TRANSIENT_STATUS = {429, 500, 502, 503, 504}


class AgentCancelled(Exception):
    pass


class CompatibleModel:
    def __init__(self, opener: Callable[..., Any] = urlopen) -> None:
        self._opener = opener

    @staticmethod
    def _endpoint(base_url: str) -> str:
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("模型地址必须使用 HTTP 或 HTTPS")
        return base_url.rstrip("/") + "/chat/completions"

    def _open(self, config: Dict[str, Any], payload: Dict[str, Any], timeout: float = 45) -> Any:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            self._endpoint(str(config.get("baseUrl", ""))), data=body, method="POST",
            headers={"content-type": "application/json", "authorization": "Bearer " + str(config.get("apiKey", ""))},
        )
        last_error: Optional[Exception] = None
        for attempt in range(2):
            try:
                return self._opener(request, timeout=timeout)
            except HTTPError as error:
                last_error = error
                if error.code not in TRANSIENT_STATUS or attempt == 1:
                    raise RuntimeError("模型服务返回 %s" % error.code) from error
            except (URLError, TimeoutError, OSError) as error:
                last_error = error
                if attempt == 1:
                    raise RuntimeError("无法连接模型服务") from error
            time.sleep(0.4)
        raise RuntimeError("无法连接模型服务") from last_error

    def stream_chat(
        self,
        config: Dict[str, Any],
        messages: List[Dict[str, str]],
        on_delta: Callable[[str], None],
        cancelled: Any,
    ) -> str:
        payload = {
            "model": str(config.get("model", "")),
            "temperature": float(config.get("temperature", 0.7)),
            "messages": messages,
            "stream": True,
        }
        reply: List[str] = []
        with self._open(config, payload) as response:
            for raw_line in response:
                if cancelled.is_set():
                    raise AgentCancelled()
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    event = json.loads(data)
                    delta = event.get("choices", [{}])[0].get("delta", {}).get("content")
                except (json.JSONDecodeError, IndexError, AttributeError, TypeError):
                    continue
                if isinstance(delta, str):
                    reply.append(delta)
                    on_delta(delta)
        return "".join(reply)

    def _json_completion(self, config: Dict[str, Any], messages: List[Dict[str, str]]) -> str:
        payload = {
            "model": str(config.get("model", "")), "temperature": 0.2, "stream": False,
            "response_format": {"type": "json_object"}, "messages": messages,
        }
        with self._open(config, payload) as response:
            value = json.loads(response.read().decode("utf-8"))
        try:
            content = value["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise RuntimeError("模型返回结构无效") from error
        return str(content)

    def plan(self, config: Dict[str, Any], transcript: str) -> Dict[str, Any]:
        content = self._json_completion(config, [
            {"role": "system", "content": (
                "Read the emotional tone of the conversation and choose a visible companion reaction. "
                "Return JSON only with actionIntent, mood, memoryCandidates, todoOperations. "
                "Use greet for a greeting, happy for warm positive emotion, celebrate for success, "
                "encourage for support, think for reflection, work for focused coding, wait when user input is needed, "
                "tired for a stretch or break, confused for frustration or uncertainty, and idle only when no reaction fits. "
                "todoOperations must be an array with at most 5 operations and must be empty unless the user explicitly asks to manage a plan. "
                "To add an item use {type:'create',title,notes?,dueAt?,remindAt?,repeat?}; dueAt and remindAt must be ISO 8601 with an explicit timezone, "
                "and repeat is none or daily. To mark an item done use {type:'complete',title}. Never invent, delete, or modify plans."
            )},
            {"role": "user", "content": transcript[-4000:]},
        ])
        fallback = {"actionIntent": "idle", "mood": "calm", "memoryCandidates": [], "todoOperations": []}
        try:
            decision = json.loads(content)
        except json.JSONDecodeError:
            return fallback
        if not isinstance(decision, dict) or decision.get("actionIntent") not in ACTION_INTENTS:
            return fallback
        mood = decision.get("mood") if isinstance(decision.get("mood"), str) else "calm"
        candidates = decision.get("memoryCandidates")
        if not isinstance(candidates, list):
            candidates = []
        operations = []
        raw_operations = decision.get("todoOperations")
        if isinstance(raw_operations, list):
            for operation in raw_operations[:5]:
                parsed = self._todo_operation(operation)
                if parsed is not None:
                    operations.append(parsed)
        return {
            "actionIntent": decision["actionIntent"],
            "mood": mood[:80],
            "memoryCandidates": [item[:500] for item in candidates[:8] if isinstance(item, str)],
            "todoOperations": operations,
        }

    @staticmethod
    def _todo_operation(value: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(value, dict) or value.get("type") not in {"create", "complete"}:
            return None
        title = value.get("title")
        if not isinstance(title, str) or not title.strip():
            return None
        if value["type"] == "complete":
            return {"type": "complete", "title": title.strip()[:160]}
        operation: Dict[str, Any] = {"type": "create", "title": title.strip()[:160]}
        notes = value.get("notes")
        if isinstance(notes, str) and notes.strip():
            operation["notes"] = notes.strip()[:500]
        for field in ("dueAt", "remindAt"):
            parsed = CompatibleModel._timestamp(value.get(field))
            if parsed is not None:
                operation[field] = parsed
        repeat = value.get("repeat")
        if repeat in {"none", "daily"}:
            operation["repeat"] = repeat
        return operation

    @staticmethod
    def _timestamp(value: Any) -> Optional[int]:
        if isinstance(value, (int, float)) and value >= 0:
            return int(value)
        if not isinstance(value, str):
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return None
            return int(parsed.timestamp() * 1000)
        except ValueError:
            return None

    def summarize(self, config: Dict[str, Any], previous: str, transcript: str) -> str:
        payload = {
            "model": str(config.get("model", "")), "temperature": 0.2, "stream": False,
            "messages": [
                {"role": "system", "content": "用不超过300字更新本地陪伴记忆摘要，只保留用户明确表达的偏好、身份信息、持续目标和重要约定，不推测敏感信息。只输出摘要。"},
                {"role": "user", "content": "旧摘要：%s\n最近对话：\n%s" % (previous or "无", transcript[-10000:])},
            ],
        }
        with self._open(config, payload) as response:
            value = json.loads(response.read().decode("utf-8"))
        try:
            return str(value["choices"][0]["message"]["content"]).strip()[:1000]
        except (KeyError, IndexError, TypeError) as error:
            raise RuntimeError("摘要返回结构无效") from error
