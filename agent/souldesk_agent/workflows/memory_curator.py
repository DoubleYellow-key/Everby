import asyncio
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

from ..memory.filters import is_safe_memory
from ..persistence.database import AgentRepository


class MemoryCandidate(BaseModel):
    type: Literal["preference", "identity", "goal", "project", "habit", "relationship", "commitment"]
    content: str = Field(min_length=8, max_length=1000)
    confidence: float = Field(ge=0, le=1)
    source_message_id: str | None = None


class CuratedMemories(BaseModel):
    memories: list[MemoryCandidate] = Field(default_factory=list, max_length=8)


class MemoryCurator:
    def __init__(self, repository: AgentRepository, model: Any, embed_query: Callable[[str], list[float]] | None,
                 emit: Callable[[str, dict[str, Any], str | None], None]):
        self.repository = repository
        self.model = model
        self.embed_query = embed_query
        self.emit = emit
        self._tasks: dict[str, asyncio.Task[Any]] = {}

    def enqueue(self, pet_id: str) -> None:
        previous = self._tasks.pop(pet_id, None)
        if previous:
            previous.cancel()
        self._tasks[pet_id] = asyncio.create_task(self._curate_after_delay(pet_id))

    async def _curate_after_delay(self, pet_id: str) -> None:
        try:
            await asyncio.sleep(30)
            messages = self.repository.list_messages(pet_id, 6)
            transcript = "\n".join(f"[{item['id']}] {item['role']}: {item['content']}" for item in messages)
            prompt = (
                "从最近对话提取用户明确表达、未来仍有帮助的稳定事实。禁止凭据、密码、API Key、一次性闲聊，"
                "也禁止推测健康、政治、宗教、性取向等敏感属性。没有合适事实就返回空列表。\n" + transcript
            )
            result = await self.model.with_structured_output(CuratedMemories).ainvoke(prompt)
            for candidate in result.memories:
                if not is_safe_memory(candidate.content):
                    continue
                vector = None
                if self.embed_query:
                    try:
                        vector = await asyncio.to_thread(self.embed_query, candidate.content)
                    except Exception:
                        pass
                self.repository.remember(pet_id, candidate.type, candidate.content, candidate.source_message_id,
                                         candidate.confidence, vector)
            self.emit("state_changed", {"reason": "memory_curation"}, None)
        except asyncio.CancelledError:
            raise
        except Exception:
            return
        finally:
            self._tasks.pop(pet_id, None)

    async def close(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()
