import json
import sqlite3
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

from everby_agent.graph.companion import ReplyStreamHandler
from everby_agent.memory.filters import is_safe_memory
from everby_agent.persistence.database import AgentRepository
from everby_agent.persistence.migration import migrate_legacy_data
from everby_agent.persona import build_persona_context, suppress_unsolicited_self_intro
from everby_agent.runtime import checkpoint_database_path
from everby_agent.schemas.protocol import RpcRequest
from everby_agent.workflows.reminder_copy import compose_reminder_copy
from everby_agent.workflows.scheduler import AgentScheduler


class ProtocolV2Tests(unittest.TestCase):
    def test_checkpoint_database_is_isolated_from_domain_writes(self):
        self.assertEqual(checkpoint_database_path(Path("everby.db")), Path("everby-checkpoints.db"))

    def test_rejects_incompatible_protocol(self):
        with self.assertRaises(ValidationError):
            RpcRequest.model_validate({"id": "1", "protocolVersion": 1, "method": "agent.snapshot", "params": {}})

    def test_accepts_protocol_v2(self):
        request = RpcRequest.model_validate({"id": "1", "protocolVersion": 2, "method": "agent.snapshot", "params": {}})
        self.assertEqual(request.protocol_version, 2)


class ReplyStreamHandlerTests(unittest.IsolatedAsyncioTestCase):
    async def test_hides_internal_summaries_and_split_text_tool_markers(self):
        events: list[str] = []
        handler = ReplyStreamHandler(lambda _event, data, _request_id: events.append(data["delta"]), "request")
        await handler.on_chat_model_start({}, [[]], run_id="summary", metadata={"lc_source": "summarization"})
        await handler.on_llm_new_token("内部摘要", run_id="summary")
        await handler.on_llm_end(None, run_id="summary")
        await handler.on_llm_new_token("正常回复", run_id="reply")
        self.assertEqual(events, ["正常回复"])

        marker_handler = ReplyStreamHandler(lambda _event, data, _request_id: events.append(data["delta"]), "request")
        await marker_handler.on_llm_new_token(" ", run_id="tool")
        await marker_handler.on_llm_new_token("<|FunctionCall", run_id="tool")
        await marker_handler.on_llm_new_token("Begin|>", run_id="tool")
        self.assertTrue(marker_handler.blocked)
        self.assertEqual(events, ["正常回复"])


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

    def test_migrates_legacy_messages_todos_persona_and_summary_without_deleting_source_rows(self):
        self.repo.close()
        connection = sqlite3.connect(self.path)
        connection.executescript("""
        CREATE TABLE messages(id TEXT PRIMARY KEY, pet_id TEXT, role TEXT, content TEXT, created_at INTEGER);
        CREATE TABLE todos(id TEXT PRIMARY KEY, title TEXT, notes TEXT, due_at INTEGER, remind_at INTEGER,
          repeat_rule TEXT, source TEXT, created_at INTEGER, updated_at INTEGER, completed_at INTEGER, last_reminded_at INTEGER);
        CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT);
        """)
        connection.execute("INSERT INTO messages VALUES('m1','daily','user','旧消息',1000)")
        connection.execute("INSERT INTO todos VALUES('t1','旧计划','备注',2000,1500,'none','chat',900,1000,NULL,NULL)")
        connection.execute("INSERT INTO kv VALUES('persona:daily',?)", (json.dumps({"petId": "daily", "name": "旧 Daily", "speakingStyle": "简洁"}),))
        connection.execute("INSERT INTO kv VALUES('memory:daily',?)", (json.dumps({"summary": "旧摘要", "unsummarized": 2}),))
        connection.commit(); connection.close()

        self.repo = AgentRepository(self.path)
        self.assertTrue(migrate_legacy_data(self.repo))
        self.assertEqual(self.repo.list_messages("daily")[0]["content"], "旧消息")
        self.assertEqual(self.repo.list_todos("daily")[0]["title"], "旧计划")
        self.assertEqual(self.repo.get_persona("daily")["name"], "旧 Daily")
        self.assertIn("旧摘要", [item["content"] for item in self.repo.list_memories("daily")])
        self.assertEqual(self.repo.db.execute("SELECT COUNT(*) FROM messages").fetchone()[0], 1)
        self.assertEqual(self.repo.db.execute("SELECT COUNT(*) FROM todos").fetchone()[0], 1)

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
    async def test_presence_features_respect_settings_quiet_hours_and_context(self):
        path = Path(__file__).parent / f".scheduler-presence-{uuid.uuid4()}.db"
        repo = AgentRepository(path)
        events: list[tuple[str, dict]] = []
        prompts: list[dict] = []

        async def compose_presence(kind: str, _pet_id: str, context: dict) -> str:
            prompts.append({"kind": kind, **context})
            return "Code 里的计划该看看啦" if kind == "task_review" else "休息一下吧"

        try:
            repo.create_todo("daily", "临近计划", due_at=2_000)
            scheduler = AgentScheduler(repo, lambda event, data, request_id: events.append((event, data)), compose_presence=compose_presence)
            scheduler.update_presence("daily", {
                "remindersEnabled": True, "proactiveEnabled": True, "taskAssistantEnabled": True,
                "quietHoursStart": "23:00", "quietHoursEnd": "08:00"
            }, "active", "Code", now=1_000)
            await scheduler.run_presence_once(now=3_601_000, local_minutes=12 * 60)
            await scheduler.run_presence_once(now=3_606_000, local_minutes=12 * 60)
            self.assertEqual({item["kind"] for item in prompts}, {"task_review", "proactive"})
            self.assertTrue(all(item["activeAppName"] == "Code" for item in prompts))
            self.assertNotIn("Code", repo.list_messages("daily")[0]["content"])

            prompts.clear()
            await scheduler.run_presence_once(now=7_200_000, local_minutes=23 * 60 + 30)
            self.assertEqual(prompts, [])
        finally:
            repo.close()
            for suffix in ("", "-wal", "-shm"):
                candidate = Path(str(path) + suffix)
                if candidate.exists(): candidate.unlink()

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
