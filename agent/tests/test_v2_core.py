import unittest
import uuid
from pathlib import Path

from pydantic import ValidationError

from everby_agent.memory.filters import is_safe_memory
from everby_agent.persistence.database import AgentRepository
from everby_agent.schemas.protocol import RpcRequest
from everby_agent.workflows.scheduler import AgentScheduler


class ProtocolV2Tests(unittest.TestCase):
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


class MemoryFilterTests(unittest.TestCase):
    def test_rejects_credentials_and_transient_smalltalk(self):
        self.assertFalse(is_safe_memory("My API key is sk-test-secret"))
        self.assertFalse(is_safe_memory("今天天气哈哈"))
        self.assertTrue(is_safe_memory("用户明确希望以后称呼她为小林"))


class SchedulerTests(unittest.TestCase):
    def test_reminder_emits_one_notification_without_a_duplicate_pet_action(self):
        path = Path(__file__).parent / f".scheduler-{uuid.uuid4()}.db"
        repo = AgentRepository(path)
        events = []
        try:
            repo.create_todo("daily", "Stand up", remind_at=1)
            scheduler = AgentScheduler(repo, lambda event, data, request_id: events.append(event))
            scheduler.run_once()
            self.assertEqual(events, ["notification_requested", "state_changed"])
        finally:
            repo.close()
            for suffix in ("", "-wal", "-shm"):
                candidate = Path(str(path) + suffix)
                if candidate.exists():
                    candidate.unlink()


if __name__ == "__main__":
    unittest.main()
