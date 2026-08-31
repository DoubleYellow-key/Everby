import unittest
from types import SimpleNamespace

from everby_agent.graph.companion import CompanionGraph
from everby_agent.workflows.dialogue_policy import DialoguePolicy


class DialoguePolicyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.policy = DialoguePolicy()
        self.persona = {"name": "Daily", "userAddress": "凯", "speakingStyle": "高冷、克制、简短"}

    def test_plans_identity_action_support_and_answer_turns(self):
        self.assertEqual(self.policy.plan("你是谁？").mode, "identity")
        self.assertTrue(self.policy.plan("你是谁？").allow_identity)
        self.assertEqual(self.policy.plan("帮我添加一个明天交报告的计划").mode, "action")
        self.assertEqual(self.policy.plan("我的计划有哪些？").mode, "answer")
        self.assertEqual(self.policy.plan("今天真的很累").mode, "support")
        self.assertEqual(self.policy.plan("为什么构建失败？").mode, "answer")

    def test_quality_gate_detects_intro_address_and_empty_companion_copy(self):
        plan = self.policy.plan("提醒我吃午饭")
        assessment = self.policy.assess(
            "凯，我是Daily呀，午饭时间到了。有需要随时告诉我。",
            plan,
            self.persona,
            [],
        )
        self.assertIn("unsolicited_identity", assessment.violations)
        self.assertIn("repeated_address", assessment.violations)
        self.assertIn("boilerplate_closing", assessment.violations)
        self.assertEqual(assessment.route, "rewrite")
        generic_intro = self.policy.assess(
            "我是你的桌面陪伴助手，今天想聊什么？", plan, self.persona, [],
        )
        self.assertIn("unsolicited_identity", generic_intro.violations)
        self.assertEqual(
            self.policy.repair("我是你的桌面陪伴助手，先看第一处错误。", plan, self.persona),
            "先看第一处错误。",
        )

    def test_identity_answer_is_allowed_but_repeated_opening_is_not(self):
        identity = self.policy.assess("我是 Daily。", self.policy.plan("你叫什么名字？"), self.persona, [])
        self.assertNotIn("unsolicited_identity", identity.violations)

        repeated = self.policy.assess(
            "先把报错日志发我。",
            self.policy.plan("还是失败"),
            self.persona,
            ["先把报错日志发我，我来定位。"],
        )
        self.assertIn("repeated_opening", repeated.violations)

    def test_action_claim_requires_tool_execution_evidence(self):
        plan = self.policy.plan("帮我添加一个明天交报告的计划")
        unverified = self.policy.assess("已经添加到计划里了。", plan, self.persona, [], [])
        verified = self.policy.assess("已经添加到计划里了。", plan, self.persona, [], ["create_todo"])
        self.assertIn("unverified_action_claim", unverified.violations)
        self.assertEqual(unverified.route, "rewrite")
        self.assertNotIn("unverified_action_claim", verified.violations)

    def test_surface_repair_preserves_the_concrete_response(self):
        repaired = self.policy.repair(
            "凯，我是Daily呀，午饭时间到了。有需要随时告诉我。",
            self.policy.plan("提醒我吃午饭"),
            self.persona,
        )
        self.assertEqual(repaired, "午饭时间到了。")

    async def test_semantic_rewrite_is_verified_and_cleaned(self):
        class FakeModel:
            async def ainvoke(self, messages):
                self.messages = messages
                return SimpleNamespace(content="凯，我是Daily。先看构建日志里的第一处错误。")

        model = FakeModel()
        result = await self.policy.rewrite(
            model,
            "我会陪着你的，有需要随时说。",
            self.policy.plan("构建还是失败"),
            self.persona,
        )
        self.assertEqual(result, "先看构建日志里的第一处错误。")
        self.assertIn("回复目标", "\n".join(str(message.content) for message in model.messages))

    async def test_companion_graph_routes_generated_copy_through_quality_nodes(self):
        class FakeRepository:
            @staticmethod
            def get_persona(_pet_id, _name, _description):
                return {"name": "Daily", "userAddress": "凯", "speakingStyle": "高冷、克制、简短"}

        graph = object.__new__(CompanionGraph)
        graph.repository = FakeRepository()
        graph.default_persona = {"name": "Daily", "description": ""}
        graph.dialogue_policy = DialoguePolicy()
        graph.emit = None

        state = {
            "pet_id": "daily",
            "user_input": "午饭时间到了吗？",
            "history": [],
            "reply": "凯，我是Daily，午饭时间到了。",
        }
        analyzed = await graph._analyze_turn(state)
        quality = await graph._quality_gate({**state, **analyzed})
        self.assertEqual(quality["quality_route"], "repair")
        repaired = await graph._repair_reply({**state, **analyzed, **quality})
        self.assertEqual(repaired["reply"], "午饭时间到了。")


if __name__ == "__main__":
    unittest.main()
