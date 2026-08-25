import asyncio
from collections.abc import Awaitable
from typing import Any, Callable

from ..persistence.database import AgentRepository


class AgentScheduler:
    def __init__(
        self,
        repository: AgentRepository,
        emit: Callable[[str, dict[str, Any], str | None], None],
        compose_reminder: Callable[[str, list[dict[str, Any]]], Awaitable[str | None]] | None = None,
    ):
        self.repository = repository
        self.emit = emit
        self.compose_reminder = compose_reminder
        self.pet_id = "daily"
        self.settings: dict[str, Any] = {"remindersEnabled": True}
        self.idle_state = "active"
        self._task: asyncio.Task[Any] | None = None

    def update_presence(self, pet_id: str, settings: dict[str, Any], idle_state: str) -> None:
        self.pet_id = pet_id
        self.settings = settings
        self.idle_state = idle_state

    def start(self) -> None:
        if not self._task:
            self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(5)
            await self.run_once()

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
