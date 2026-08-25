import unittest

from everby_agent.graph.text_tool_compat import explicitly_requests_todo, parse_text_create_todos


class TextToolCompatibilityTests(unittest.TestCase):
    def test_maps_content_to_title_and_limits_writes(self):
        block = (
            '<|FunctionCallBegin|>['
            '{"name":"create_todo","parameters":{"content":"计划一"}},'
            '{"name":"create_todo","parameters":{"title":"计划二"}},'
            '{"name":"create_todo","parameters":{"title":"计划三"}}'
            ']<|FunctionCallEnd|>'
        )
        detected, calls = parse_text_create_todos(block)
        self.assertTrue(detected)
        self.assertEqual([call.title for call in calls], ["计划一", "计划二"])

    def test_requires_an_explicit_user_request(self):
        self.assertTrue(explicitly_requests_todo("新加俩个计划，完成迁移和新需求"))
        self.assertTrue(explicitly_requests_todo("提醒我下午开会"))
        self.assertFalse(explicitly_requests_todo("你觉得我这周该做什么？"))

    def test_rejects_unknown_or_invalid_text_calls(self):
        detected, calls = parse_text_create_todos(
            '<|FunctionCallBegin|>[{"name":"delete_todo","parameters":{"content":"全部"}}]<|FunctionCallEnd|>'
        )
        self.assertTrue(detected)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
