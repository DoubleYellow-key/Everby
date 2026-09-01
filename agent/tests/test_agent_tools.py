import unittest
from types import SimpleNamespace

from everby_agent.tools.companion import AgentContext, build_companion_tools, request_pet_action


class CompanionToolTests(unittest.TestCase):
    def test_exposes_only_the_scoped_companion_tools(self):
        names = {tool.name for tool in build_companion_tools()}
        self.assertEqual(names, {
            "get_current_time", "list_todos", "create_todo", "complete_todo",
            "search_memories", "remember_memory", "request_pet_action",
        })
        self.assertNotIn("delete_todo", names)
        self.assertNotIn("delete_memory", names)

    def test_adds_only_the_scoped_image_tool_when_vision_is_enabled(self):
        names = {tool.name for tool in build_companion_tools(include_vision=True)}
        self.assertEqual(names, {
            "get_current_time", "list_todos", "create_todo", "complete_todo",
            "search_memories", "remember_memory", "request_pet_action", "inspect_image",
        })

    def test_action_tool_accepts_semantic_intents_only_and_runs_once(self):
        schema = request_pet_action.args_schema.model_json_schema()
        self.assertIn("intent", schema["properties"])
        self.assertNotIn("action_id", schema["properties"])
        context = AgentContext(repository=None, pet_id="daily", run_id="run")  # type: ignore[arg-type]
        runtime = SimpleNamespace(context=context)
        result = request_pet_action.func(intent="tired", runtime=runtime)
        self.assertEqual(result, {"intent": "tired", "accepted": True})
        self.assertEqual(context.action_requests, [{"intent": "tired"}])
        with self.assertRaisesRegex(RuntimeError, "最多请求一次"):
            request_pet_action.func(intent="happy", runtime=runtime)

    def test_limits_vision_model_calls_per_turn(self):
        context = AgentContext(repository=None, pet_id="daily", run_id="run")  # type: ignore[arg-type]
        context.claim_vision()
        context.claim_vision()
        with self.assertRaisesRegex(RuntimeError, "最多执行两次"):
            context.claim_vision()


if __name__ == "__main__":
    unittest.main()
