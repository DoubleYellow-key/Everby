import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

from everby_agent.memory.filters import is_safe_memory
from everby_agent.persistence.database import AgentRepository
from everby_agent.persona import build_persona_context, suppress_unsolicited_self_intro
from everby_agent.runtime import checkpoint_database_path
from everby_agent.schemas.protocol import RpcRequest
from everby_agent.workflows.reminder_copy import compose_reminder_copy
from everby_agent.workflows.scheduler import AgentScheduler


class ProtocolV2Tests(unittest.TestCase):
    def test_checkpoint_database_is_isolated_from_domain_writes(self):
        self.assertEqual(checkpoint_database_path(Path("everby.db")), Path("everby.db.checkpoints"))

    def test_rejects_incompatible_protocol(self):
        with self.assertRaises(ValidationError):
            RpcRequest.model_validate({"id": "1", "protocolVersion": 1, "method": "agent.snapshot", "params": {}})

    def test_accepts_protocol_v2(self):
        request = RpcRequest.model_validate({"id": "1", "protocolVersion": 2, "method": "agent.snapshot", "params": {}})
        self.assertEqual(request.protocol_version, 2)


class AgentRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.path = Path(__file__).parent / f".agent-{uuid.uuid4()}.db"
        self.repo = AgentRepository(self.path)

    def tearDown(self):
        self.repo.close()
        for suffix in ("", "-wal", "-shm"):
            candidate = Path(str(self.path) + suffix)
            if candidate.exists():
                candidate.unlink()

    def test_isolates_messages_and_todos_by_pet(self):
        self.repo.add_message("daily", "user", "daily message")
        self.repo.add_message("nova", "user", "nova message")
        self.repo.create_todo("daily", "daily todo")
        self.repo.create_todo("nova", "nova todo")
        self.assertEqual([item["content"] for item in self.repo.list_messages("daily")], ["daily message"])
        self.assertEqual([item["title"] for item in self.repo.list_todos("nova")], ["nova todo"])

    def test_todo_writes_are_idempotent_and_deduplicated(self):
        first = self.repo.create_todo("daily", "  Write weekly report  ", run_id="run", tool_call_id="call")
        retried = self.repo.create_todo("daily", "ignored", run_id="run", tool_call_id="call")
        duplicate = self.repo.create_todo("daily", "write weekly report")
        self.assertEqual(first["id"], retried["id"])
        self.assertEqual(first["id"], duplicate["id"])
        self.assertEqual(len(self.repo.list_todos("daily")), 1)

    def test_duplicate_todo_fills_in_missing_schedule(self):
        first = self.repo.create_todo("daily", "完成小程序新需求")
        enriched = self.repo.create_todo("daily", "完成小程序新需求", due_at=1_800_000_000_000)
        self.assertEqual(first["id"], enriched["id"])
        self.assertEqual(enriched["dueAt"], 1_800_000_000_000)

    def test_todos_with_the_same_timestamp_keep_newest_first_order(self):
        with patch("everby_agent.persistence.database._now_ms", return_value=1_000):
            self.repo.create_todo("daily", "First")
            self.repo.create_todo("daily", "Second")
        self.assertEqual([item["title"] for item in self.repo.list_todos("daily")], ["Second", "First"])

    def test_messages_with_the_same_timestamp_keep_conversation_order(self):
        self.repo.add_message("daily", "user", "First", created_at=1_000)
        self.repo.add_message("daily", "assistant", "Second", created_at=1_000)
        self.assertEqual([item["content"] for item in self.repo.list_messages("daily")], ["First", "Second"])

    def test_hybrid_memory_search_uses_fts_and_vector_results(self):
        self.repo.remember("daily", "preference", "The user likes jasmine tea", vector=[1.0, 0.0], confidence=0.9)
        self.repo.remember("daily", "project", "Everby uses a Python agent", vector=[0.0, 1.0], confidence=0.8)
        results = self.repo.search_memories("daily", "jasmine", query_vector=[0.0, 1.0], limit=2)
        self.assertEqual({item["content"] for item in results}, {
            "The user likes jasmine tea", "Everby uses a Python agent"
        })

    def test_similar_memory_merges_instead_of_duplicating(self):
        first = self.repo.remember("daily", "preference", "Likes green tea", vector=[1.0, 0.0])
        merged = self.repo.remember("daily", "preference", "Really likes green tea", vector=[0.99, 0.01])
        self.assertEqual(first["id"], merged["id"])
        self.assertEqual(len(self.repo.list_memories("daily")), 1)

    def test_default_persona_is_reserved_and_aloof(self):
        persona = self.repo.get_persona("daily")
        self.assertIn("高冷", persona["speakingStyle"])
        self.assertIn("不主动自我介绍", persona["speakingStyle"])

    def test_migrates_only_legacy_persona_style(self):
        self.repo.update_persona("daily", {
            "name": "Daily",
            "speakingStyle": "像熟悉的朋友一样自然简洁。",
            "userAddress": "凯",
        })
        migrated = self.repo.migrate_legacy_persona_defaults("daily")
        self.assertIn("高冷", migrated["speakingStyle"])
        self.assertEqual(migrated["userAddress"], "凯")

        self.repo.update_persona("daily", {"speakingStyle": "活泼健谈"})
        preserved = self.repo.migrate_legacy_persona_defaults("daily")
        self.assertEqual(preserved["speakingStyle"], "活泼健谈")


class PersonaPromptTests(unittest.TestCase):
    def test_persona_context_is_configuration_not_an_intro_request(self):
        prompt = build_persona_context({
            "name": "Daily",
            "background": "冷静可靠",
            "speakingStyle": "高冷、克制、简短",
            "userAddress": "凯",
            "boundaries": "尊重隐私",
        })
        self.assertIn("高冷、克制、简短", prompt)
        self.assertIn("不是让你复述的开场白", prompt)
        self.assertIn("不要主动说“我是 Daily”", prompt)

    def test_removes_repeated_intro_unless_user_asks_for_identity(self):
        reply = "凯，我是Daily呀，已经到吃午饭的时间了。"
        self.assertEqual(
            suppress_unsolicited_self_intro(reply, "Daily", "凯", "提醒我吃饭"),
            "已经到吃午饭的时间了。",
        )
        self.assertEqual(
            suppress_unsolicited_self_intro(reply, "Daily", "凯", "你是谁？"),
            reply,
        )


class MemoryFilterTests(unittest.TestCase):
    def test_rejects_credentials_and_transient_smalltalk(self):
        self.assertFalse(is_safe_memory("My API key is sk-test-secret"))
        self.assertFalse(is_safe_memory("今天天气哈哈"))
        self.assertTrue(is_safe_memory("用户明确希望以后称呼她为小林"))


class SchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def test_reminder_uses_composed_copy_without_a_duplicate_pet_action(self):
        path = Path(__file__).parent / f".scheduler-{uuid.uuid4()}.db"
        repo = AgentRepository(path)
        events: list[tuple[str, dict]] = []

        async def compose(_pet_id: str, todos: list[dict]) -> str:
            self.assertEqual([item["title"] for item in todos], ["Stand up"])
            return "该起身活动一下啦，回来再继续。"

        try:
            repo.create_todo("daily", "Stand up", remind_at=1)
            scheduler = AgentScheduler(repo, lambda event, data, request_id: events.append((event, data)), compose)
            await scheduler.run_once()
            self.assertEqual([event for event, _data in events], ["notification_requested", "state_changed"])
            self.assertEqual(events[0][1]["message"], "该起身活动一下啦，回来再继续。")
            self.assertTrue(events[0][1]["generatedByModel"])
            self.assertEqual(repo.list_messages("daily")[-1]["content"], "该起身活动一下啦，回来再继续。")
        finally:
            repo.close()
            for suffix in ("", "-wal", "-shm"):
                candidate = Path(str(path) + suffix)
                if candidate.exists():
                    candidate.unlink()

    async def test_reminder_falls_back_when_composer_fails(self):
        path = Path(__file__).parent / f".scheduler-fallback-{uuid.uuid4()}.db"
        repo = AgentRepository(path)
        events: list[tuple[str, dict]] = []

        async def compose(_pet_id: str, _todos: list[dict]) -> str:
            raise RuntimeError("model unavailable")

        try:
            repo.create_todo("daily", "吃午饭", remind_at=1)
            scheduler = AgentScheduler(repo, lambda event, data, request_id: events.append((event, data)), compose)
            await scheduler.run_once()
            self.assertEqual(events[0][1]["message"], "提醒时间到了：吃午饭")
            self.assertFalse(events[0][1]["generatedByModel"])
        finally:
            repo.close()
            for suffix in ("", "-wal", "-shm"):
                candidate = Path(str(path) + suffix)
                if candidate.exists():
                    candidate.unlink()


class ReminderCopyTests(unittest.IsolatedAsyncioTestCase):
    async def test_calls_model_with_persona_and_due_items(self):
        class FakeModel:
            def __init__(self):
                self.messages = []

            async def ainvoke(self, messages):
                self.messages = messages
                return SimpleNamespace(content="小林，我是Daily呀，午饭时间到啦。\n先好好吃饭，工作回来再继续。")

        model = FakeModel()
        result = await compose_reminder_copy(
            model,
            {"name": "Daily", "speakingStyle": "像熟悉的朋友", "userAddress": "小林"},
            [{"title": "吃午饭", "notes": "别太晚"}],
        )

        self.assertEqual(result, "午饭时间到啦。 先好好吃饭，工作回来再继续。")
        prompt = "\n".join(str(message.content) for message in model.messages)
        self.assertIn("像熟悉的朋友", prompt)
        self.assertIn("吃午饭", prompt)
        self.assertIn("不要在提醒里自我介绍", prompt)


if __name__ == "__main__":
    unittest.main()
