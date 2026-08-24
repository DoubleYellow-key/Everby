import asyncio
from typing import Any, Callable

from ..persistence.database import AgentRepository


class AgentScheduler:
    def __init__(self, repository: AgentRepository, emit: Callable[[str, dict[str, Any], str | None], None]):
        self.repository = repository
        self.emit = emit
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
            if not self.settings.get("remindersEnabled", True) or self.idle_state == "locked":
                continue
            due = self.repository.claim_due_reminders(self.pet_id)
            if not due:
                continue
            names = [item["title"] for item in due[:3]]
            message = f"提醒时间到了：{'、'.join(names)}" + (f"等 {len(due)} 项" if len(due) > 3 else "")
            self.repository.add_message(self.pet_id, "assistant", message)
            self.emit("notification_requested", {"title": "SoulDesk 提醒", "message": message}, None)
            self.emit("pet_action", {"actionIntent": "encourage"}, None)
            self.emit("state_changed", {"reason": "reminder"}, None)

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
