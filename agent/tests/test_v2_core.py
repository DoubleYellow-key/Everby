import json
import sqlite3
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

from everby_agent.graph.companion import ReplyStreamHandler, format_memory_context, merge_recalled_memories, resolve_action_intent
from everby_agent.memory.filters import is_safe_memory
from everby_agent.persistence.database import AgentRepository, DEFAULT_PERSONA_BACKGROUND
from everby_agent.persistence.migration import migrate_legacy_data
from everby_agent.persona import build_persona_context, suppress_unsolicited_self_intro
from everby_agent.runtime import AgentRuntime, checkpoint_database_path
from everby_agent.schemas.protocol import RpcRequest
from everby_agent.workflows.reminder_copy import compose_presence_copy, compose_reminder_copy
from everby_agent.workflows.scheduler import AgentScheduler
from everby_agent.workflows.memory_curator import build_curation_prompt


class ProtocolV2Tests(unittest.TestCase):
    def test_checkpoint_database_is_isolated_from_domain_writes(self):
        self.assertEqual(checkpoint_database_path(Path("everby.db")), Path("everby-checkpoints.db"))

    def test_rejects_incompatible_protocol(self):
        with self.assertRaises(ValidationError):
            RpcRequest.model_validate({"id": "1", "protocolVersion": 1, "method": "agent.snapshot", "params": {}})

    def test_accepts_protocol_v2(self):
        request = RpcRequest.model_validate({"id": "1", "protocolVersion": 2, "method": "agent.snapshot", "params": {}})
        self.assertEqual(request.protocol_version, 2)


class ActionSelectionTests(unittest.TestCase):
    def test_tool_request_wins_and_keywords_remain_a_fallback(self):
        self.assertEqual(resolve_action_intent({"intent": "tired"}, "任务已经完成"), "tired")
        self.assertEqual(resolve_action_intent({"intent": "move"}, "保持不动"), "move")
        self.assertEqual(resolve_action_intent(None, "任务已经完成"), "celebrate")


class VisionProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_the_provider_error_instead_of_a_generic_failure(self):
        runtime = AgentRuntime(lambda *_args: None)
        runtime.vision_model = object()  # type: ignore[assignment]
        runtime._analyze_images = AsyncMock(side_effect=RuntimeError("model does not support image input"))  # type: ignore[method-assign]
        result = await runtime.probe_vision()
        self.assertFalse(result["vision"])
        self.assertIn("does not support image", result["message"])


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

    def test_delete_pet_data_removes_only_the_selected_pet(self):
        self.repo.add_message("nova", "user", "private message")
        self.repo.create_todo("nova", "private todo")
        self.repo.remember("nova", "preference", "Likes jasmine tea")
        self.repo.update_persona("nova", {"name": "Nova"})
        self.repo.clear_conversation("nova")
        self.repo.add_message("daily", "user", "keep me")

        self.repo.delete_pet_data("nova")

        self.assertEqual(self.repo.list_messages("nova"), [])
        self.assertEqual(self.repo.list_todos("nova"), [])
        self.assertEqual(self.repo.list_memories("nova"), [])
        self.assertEqual(self.repo.epoch("nova"), 0)
        self.assertEqual([item["content"] for item in self.repo.list_messages("daily")], ["keep me"])
        self.assertEqual(self.repo.db.execute("SELECT COUNT(*) FROM agent_personas WHERE pet_id='nova'").fetchone()[0], 0)

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

    def test_persists_only_structured_chat_image_attachments_with_the_user_message(self):
        attachment = {
            "id": "image-1", "name": "desk.jpg", "mimeType": "image/jpeg",
            "dataUrl": "data:image/jpeg;base64,YQ==", "size": 1,
        }
        self.repo.add_message("daily", "user", "这是什么？", attachments=[attachment])
        message = self.repo.list_messages("daily")[0]
        self.assertEqual(message["attachments"], [attachment])

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

    def test_migrates_legacy_visual_identity_memory_to_the_pet_subject(self):
        legacy = self.repo.remember(
            "doubao", "identity",
            "本次对话中提到的，内容为扎马尾、戴黄色发饰的女孩坐在黑色背景前椅子上用笔记本电脑的图中人物是豆包",
        )

        self.assertTrue(self.repo.migrate_pet_identity_memories("doubao", "豆包"))

        migrated = self.repo.memory_by_id("doubao", legacy["id"])
        self.assertEqual(migrated["subject"], "pet")
        self.assertEqual(
            migrated["content"],
            "豆包的角色形象：扎马尾、戴黄色发饰的女孩坐在黑色背景前椅子上用笔记本电脑",
        )

    def test_memory_subject_is_part_of_deduplication(self):
        user = self.repo.remember("daily", "identity", "喜欢安静地写代码", subject="user")
        pet = self.repo.remember("daily", "identity", "喜欢安静地写代码", subject="pet")
        self.assertNotEqual(user["id"], pet["id"])

    def test_visual_traits_can_link_a_pet_alias_to_the_current_role(self):
        legacy = self.repo.remember(
            "daily", "identity",
            "本次对话中提到的，内容为扎马尾、戴黄色发饰的女孩坐在椅子上用笔记本电脑的图中人物是豆包",
        )
        changed = self.repo.migrate_pet_identity_memories(
            "daily", "Daily", "一位戴细框眼镜、扎单马尾的程序员伙伴",
        )
        self.assertTrue(changed)
        migrated = self.repo.memory_by_id("daily", legacy["id"])
        self.assertEqual(migrated["subject"], "pet")
        self.assertTrue(migrated["content"].startswith("豆包（当前角色）的角色形象："))

    def test_default_persona_is_neutral_without_character_defaults(self):
        persona = self.repo.get_persona("daily")
        self.assertIn("克制、自然、简洁", persona["speakingStyle"])
        self.assertNotIn("高冷", persona["speakingStyle"])
        self.assertEqual(persona["userAddress"], "你")

    def test_character_persona_defaults_shape_synthesized_persona(self):
        daily = self.repo.get_persona("daily", "Daily", "", {
            "speakingStyle": "高冷、克制、简短。",
            "userAddress": "凯",
        })
        optimus = self.repo.get_persona("optimus", "Optimus", "", {
            "speakingStyle": "热血、简练，像机器人领袖一样说话。",
            "userAddress": "指挥官",
        })
        self.assertIn("高冷", daily["speakingStyle"])
        self.assertEqual(daily["userAddress"], "凯")
        self.assertIn("热血", optimus["speakingStyle"])
        self.assertEqual(optimus["userAddress"], "指挥官")
        self.assertNotEqual(daily["speakingStyle"], optimus["speakingStyle"])

    def test_persisted_user_persona_always_wins_over_character_defaults(self):
        defaults = {"speakingStyle": "热血、简练，像机器人领袖一样说话。"}
        self.repo.update_persona("optimus", {"speakingStyle": "温柔慢语"})
        self.assertEqual(self.repo.get_persona("optimus", "Optimus", "", defaults)["speakingStyle"], "温柔慢语")

    def test_background_priority_character_persona_then_description_then_neutral(self):
        described = self.repo.get_persona("fox", "小狐", "一只安静的狐狸")
        self.assertEqual(described["background"], "一只安静的狐狸")
        overridden = self.repo.get_persona("fox", "小狐", "一只安静的狐狸", {"background": "来自森林的守望者"})
        self.assertEqual(overridden["background"], "来自森林的守望者")
        bare = self.repo.get_persona("fox")
        self.assertEqual(bare["background"], DEFAULT_PERSONA_BACKGROUND)

    def test_migrates_legacy_persona_values_to_character_defaults(self):
        self.repo.update_persona("daily", {
            "name": "Daily",
            "speakingStyle": "像熟悉的朋友一样自然简洁。",
            "background": "一位聪明、自然、温暖的桌面陪伴伙伴。",
            "userAddress": "凯",
        })
        defaults = {"speakingStyle": "高冷、克制、简短。"}
        migrated = self.repo.migrate_legacy_persona_defaults("daily", defaults)
        self.assertEqual(migrated["speakingStyle"], "高冷、克制、简短。")
        self.assertEqual(migrated["background"], DEFAULT_PERSONA_BACKGROUND)
        self.assertEqual(migrated["userAddress"], "凯")

        self.repo.update_persona("daily", {"speakingStyle": "活泼健谈"})
        preserved = self.repo.migrate_legacy_persona_defaults("daily", defaults)
        self.assertEqual(preserved["speakingStyle"], "活泼健谈")

    def test_migrates_previous_aloof_default_to_character_defaults(self):
        # 老版本把 Daily 的高冷默认持久化给了所有角色；现在应重写为各角色自己的默认
        self.repo.update_persona("fox", {
            "speakingStyle": "高冷、克制、简短。少用语气词、感叹号和卖萌表达；不主动自我介绍，不重复称呼，关心通过准确回应和行动体现。",
        })
        migrated = self.repo.migrate_legacy_persona_defaults("fox", {"speakingStyle": "软绵绵，爱撒娇。"})
        self.assertEqual(migrated["speakingStyle"], "软绵绵，爱撒娇。")

    def test_persona_defaults_are_sanitized(self):
        persona = self.repo.get_persona("daily", "Daily", "", {
            "speakingStyle": "  " * 10,
            "userAddress": 42,
            "boundaries": "x" * 5000,
        })
        self.assertEqual(persona["userAddress"], "你")
        self.assertNotEqual(persona["speakingStyle"], "  " * 10)
        self.assertEqual(len(persona["boundaries"]), 2000)


class MemoryCuratorPromptTests(unittest.TestCase):
    def test_pet_identity_requires_user_confirmation_and_standalone_wording(self):
        prompt = build_curation_prompt(
            "doubao", {"name": "豆包", "background": "桌面角色"},
            [{"id": "m1", "role": "user", "content": "图里这个就是你，豆包"}],
        )
        self.assertIn("subject=pet", prompt)
        self.assertIn("当前角色“豆包”", prompt)
        self.assertIn("必须得到用户明确确认", prompt)
        self.assertIn("禁止写成“本次对话中提到的”", prompt)

    def test_pet_memories_are_explained_as_the_agents_own_identity(self):
        context = format_memory_context([
            {"id": "p1", "subject": "pet", "type": "identity", "content": "豆包的角色形象：扎马尾"},
            {"id": "u1", "subject": "user", "type": "preference", "content": "用户喜欢咖啡"},
        ])
        self.assertIn("这些事实描述的就是你自己", context)
        self.assertIn("关于用户的长期记忆", context)

    def test_pet_identity_is_recalled_even_when_the_query_matches_something_else(self):
        pet = {"id": "p1", "subject": "pet", "type": "identity", "content": "豆包的角色形象"}
        user = {"id": "u1", "subject": "user", "type": "project", "content": "用户的项目"}
        self.assertEqual(merge_recalled_memories([user], [pet, user]), [pet, user])


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
        self.assertIn("你就是这个角色本身", prompt)
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
    async def test_task_review_does_not_announce_pending_reminders_early(self):
        path = Path(__file__).parent / f".scheduler-pending-reminder-{uuid.uuid4()}.db"
        repo = AgentRepository(path)
        prompts: list[dict] = []

        async def compose_presence(kind: str, _pet_id: str, context: dict) -> str:
            prompts.append({"kind": kind, **context})
            return "周报还有一小时，先记着。"

        try:
            now = 1_800_000_000_000
            repo.create_todo("daily", "吃午饭", remind_at=now + 2 * 60 * 60_000, repeat="daily")
            repo.db.execute(
                "UPDATE agent_todos SET last_reminded_at=? WHERE pet_id=? AND normalized_title=?",
                (now - 24 * 60 * 60_000, "daily", "吃午饭"),
            )
            repo.db.commit()
            repo.create_todo("daily", "提交周报", due_at=now + 60 * 60_000)
            scheduler = AgentScheduler(
                repo, lambda _event, _data, _request_id: None, compose_presence=compose_presence,
            )
            scheduler.update_presence("daily", {
                "remindersEnabled": True, "proactiveEnabled": False, "taskAssistantEnabled": True,
                "quietHoursStart": "23:00", "quietHoursEnd": "08:00",
            }, "active", now=now)

            await scheduler.run_presence_once(now=now, local_minutes=10 * 60)

            self.assertEqual(len(prompts), 1)
            self.assertEqual([item["title"] for item in prompts[0]["todos"]], ["提交周报"])
            self.assertEqual(prompts[0]["todos"][0]["timing"], "upcoming")
            self.assertEqual(prompts[0]["todos"][0]["minutesUntil"], 60)
        finally:
            repo.close()
            for suffix in ("", "-wal", "-shm"):
                candidate = Path(str(path) + suffix)
                if candidate.exists():
                    candidate.unlink()

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
    async def test_replaces_false_due_claim_for_upcoming_task(self):
        class FakeModel:
            async def ainvoke(self, _messages):
                return SimpleNamespace(content="到提醒时间了，该提交周报了。")

        result = await compose_presence_copy(FakeModel(), {"name": "Daily"}, "task_review", {
            "localTime": "2026-09-01T09:30:00+08:00",
            "todos": [{"title": "提交周报", "dueAt": 1_800_000_000_000, "timing": "upcoming", "minutesUntil": 90}],
        })

        self.assertEqual(result, "“提交周报”还有约 1 小时 30 分钟，先记着。")

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
