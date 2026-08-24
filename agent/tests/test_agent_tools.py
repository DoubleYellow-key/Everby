import unittest

from souldesk_agent.tools.companion import build_companion_tools


class CompanionToolTests(unittest.TestCase):
    def test_exposes_only_the_six_companion_tools(self):
        names = {tool.name for tool in build_companion_tools()}
        self.assertEqual(names, {
            "get_current_time", "list_todos", "create_todo", "complete_todo",
            "search_memories", "remember_memory",
        })
        self.assertNotIn("delete_todo", names)
        self.assertNotIn("delete_memory", names)


if __name__ == "__main__":
    unittest.main()
