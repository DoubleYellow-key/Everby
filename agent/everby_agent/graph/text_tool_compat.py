import json
import re
from typing import Any

from ..tools.companion import CreateTodoArgs

_CALL_BLOCK = re.compile(r"<\|FunctionCallBegin\|>(.*?)<\|FunctionCallEnd\|>", re.DOTALL)


def explicitly_requests_todo(user_input: str) -> bool:
    lowered = user_input.casefold()
    actions = ("添加", "新增", "新加", "创建", "加个", "加俩", "记下", "安排", "add", "create")
    objects = ("计划", "待办", "todo")
    return (any(word in lowered for word in actions) and any(word in lowered for word in objects)) or "提醒我" in lowered


def parse_text_create_todos(text: str) -> tuple[bool, list[CreateTodoArgs]]:
    detected = "<|FunctionCallBegin|>" in text or "<|FunctionCallEnd|>" in text
    parsed: list[CreateTodoArgs] = []
    for block in _CALL_BLOCK.findall(text):
        try:
            calls = json.loads(block)
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(calls, list):
            calls = [calls]
        for call in calls:
            if not isinstance(call, dict) or call.get("name") != "create_todo":
                continue
            parameters = call.get("parameters", call.get("arguments", {}))
            if not isinstance(parameters, dict):
                continue
            values: dict[str, Any] = {
                "title": parameters.get("title", parameters.get("content")),
                "notes": parameters.get("notes", ""),
                "due_at": parameters.get("due_at", parameters.get("dueAt")),
                "remind_at": parameters.get("remind_at", parameters.get("remindAt")),
                "repeat": parameters.get("repeat", "none"),
            }
            try:
                parsed.append(CreateTodoArgs.model_validate(values))
            except Exception:
                continue
            if len(parsed) == 2:
                return detected, parsed
    return detected, parsed
