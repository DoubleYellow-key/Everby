import asyncio
from collections.abc import Awaitable
from datetime import datetime, timezone
import random
import re
from typing import Any, Callable

from ..persistence.database import AgentRepository


class AgentScheduler:
    def __init__(
        self,
        repository: AgentRepository,
        emit: Callable[[str, dict[str, Any], str | None], None],
        compose_reminder: Callable[[str, list[dict[str, Any]]], Awaitable[str | None]] | None = None,
        compose_presence: Callable[[str, str, dict[str, Any]], Awaitable[str | None]] | None = None,
    ):
        self.repository = repository
        self.emit = emit
        self.compose_reminder = compose_reminder
        self.compose_presence = compose_presence
        self.pet_id = "daily"
        self.settings: dict[str, Any] = {"remindersEnabled": True}
        self.idle_state = "active"
        self.active_app_name = ""
        self.next_proactive_at: int | None = None
        self.last_task_review_at: int | None = None
        self.presence_day = ""
        self.proactive_count = 0
        self.task_review_count = 0
        self._task: asyncio.Task[Any] | None = None

    def update_presence(self, pet_id: str, settings: dict[str, Any], idle_state: str,
                        active_app_name: str = "", now: int | None = None) -> None:
        self.pet_id = pet_id
        self.settings = settings
        self.idle_state = idle_state
        self.active_app_name = active_app_name[:160]
        if self.next_proactive_at is None:
            self.next_proactive_at = (now or int(datetime.now().timestamp() * 1000)) + 60 * 60_000

    def start(self) -> None:
        if not self._task:
            self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(5)
            await self.run_once()
            await self.run_presence_once()

    @staticmethod
    def _local_datetime(timestamp_ms: int) -> datetime:
        try:
            return datetime.fromtimestamp(timestamp_ms / 1000).astimezone()
        except (OSError, OverflowError, ValueError):
            return datetime.fromtimestamp(timestamp_ms / 1000, timezone.utc)

    @staticmethod
    def _quiet_hours(settings: dict[str, Any], local_minutes: int) -> bool:
        def parse(value: Any, fallback: str) -> int:
            try:
                hours, minutes = str(value or fallback).split(":", 1)
                return int(hours) * 60 + int(minutes)
            except (TypeError, ValueError):
                hours, minutes = fallback.split(":")
                return int(hours) * 60 + int(minutes)
        start = parse(settings.get("quietHoursStart"), "23:00")
        end = parse(settings.get("quietHoursEnd"), "08:00")
        return start > end and (local_minutes >= start or local_minutes < end) or start < end and start <= local_minutes < end

    def _presence_todos(self, now: int) -> list[dict[str, Any]]:
        candidates: list[tuple[int, dict[str, Any]]] = []
        for item in self.repository.list_todos(self.pet_id):
            if item["completedAt"] is not None:
                continue
            times = [value for value in (item["dueAt"], item["remindAt"]) if value is not None]
            if not times:
                continue
            scheduled = min(times)
            if scheduled <= now + 2 * 60 * 60_000 and not (item["lastRemindedAt"] and now - item["lastRemindedAt"] < 30 * 60_000):
                candidates.append((scheduled, item))
        return [item for _scheduled, item in sorted(candidates, key=lambda value: value[0])[:8]]

    async def _emit_presence(self, kind: str, todos: list[dict[str, Any]], now: int) -> bool:
        if not self.compose_presence:
            return False
        context = {
            "localTime": self._local_datetime(now).isoformat(),
            "activeAppName": self.active_app_name,
            "todos": [{"title": item["title"], "dueAt": item["dueAt"], "remindAt": item["remindAt"]} for item in todos],
        }
        try:
            message = await asyncio.wait_for(self.compose_presence(kind, self.pet_id, context), timeout=8)
        except Exception:
            return False
        if not message or not message.strip():
            return False
        text = " ".join(message.split()).strip()[:240]
        if self.active_app_name:
            text = re.sub(re.escape(self.active_app_name), "当前应用", text, flags=re.IGNORECASE)
        self.repository.add_message(self.pet_id, "assistant", text)
        self.emit("companion_message", {"message": text, "kind": kind}, None)
        self.emit("state_changed", {"reason": kind}, None)
        return True

    async def run_presence_once(self, now: int | None = None, local_minutes: int | None = None) -> None:
        now = now or int(datetime.now().timestamp() * 1000)
        current = self._local_datetime(now)
        minutes = local_minutes if local_minutes is not None else current.hour * 60 + current.minute
        if self.idle_state == "locked" or self.settings.get("paused") or self._quiet_hours(self.settings, minutes):
            return
        day = current.date().isoformat()
        if day != self.presence_day:
            self.presence_day = day
            self.proactive_count = 0
            self.task_review_count = 0
        todos = self._presence_todos(now)
        task_due = self.last_task_review_at is None or now - self.last_task_review_at >= 30 * 60_000
        if self.settings.get("taskAssistantEnabled", True) and todos and task_due and self.task_review_count < 4:
            if await self._emit_presence("task_review", todos, now):
                self.last_task_review_at = now
                self.task_review_count += 1
                return
        if not self.settings.get("proactiveEnabled", True) or self.proactive_count >= 4:
            return
        if self.next_proactive_at is None:
            self.next_proactive_at = now + 60 * 60_000
            return
        if now >= self.next_proactive_at and await self._emit_presence("proactive", [], now):
            self.proactive_count += 1
            self.next_proactive_at = now + int((60 + random.random() * 60) * 60_000)

    @staticmethod
    def _fallback_message(due: list[dict[str, Any]]) -> str:
        names = [item["title"] for item in due[:3]]
        return f"提醒时间到了：{'、'.join(names)}" + (f"等 {len(due)} 项" if len(due) > 3 else "")

    async def run_once(self) -> None:
        if not self.settings.get("remindersEnabled", True) or self.idle_state == "locked":
            return
        due = self.repository.claim_due_reminders(self.pet_id)
        if not due:
            return
        message = self._fallback_message(due)
        generated_by_model = False
        if self.compose_reminder:
            try:
                composed = await asyncio.wait_for(self.compose_reminder(self.pet_id, due), timeout=8)
                if composed and composed.strip():
                    message = " ".join(composed.split()).strip()[:240]
                    generated_by_model = True
            except Exception:
                pass
        self.repository.add_message(self.pet_id, "assistant", message)
        self.emit("notification_requested", {
            "title": "Everby 提醒", "message": message, "generatedByModel": generated_by_model,
        }, None)
        self.emit("state_changed", {"reason": "reminder"}, None)

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
