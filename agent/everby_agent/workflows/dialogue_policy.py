import re
from dataclasses import dataclass
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage

from ..persona import IDENTITY_QUESTIONS, suppress_unsolicited_self_intro


DialogueMode = Literal["identity", "action", "support", "answer", "social", "respond"]
QualityRoute = Literal["accept", "repair", "rewrite"]


@dataclass(frozen=True)
class DialoguePlan:
    mode: DialogueMode
    objective: str
    allow_identity: bool = False

    def as_context(self) -> str:
        return f"本轮类型：{self.mode}\n回复目标：{self.objective}"


@dataclass(frozen=True)
class ReplyAssessment:
    violations: tuple[str, ...]
    route: QualityRoute


class DialoguePolicy:
    _action_patterns = (
        r"(?:帮我|替我).*(?:添加|创建|新建|完成|记住|提醒)",
        r"(?:添加|创建|新建|加)(?:一个|几个|俩个|两个)?.*(?:计划|待办|提醒)",
        r"(?:完成|标记完成).*(?:计划|待办)",
        r"(?:记住|提醒我)",
    )
    _support_terms = ("难过", "焦虑", "烦", "累", "压力", "失败", "崩溃", "不开心", "委屈")
    _answer_terms = ("为什么", "怎么", "如何", "什么", "哪里", "是否", "能不能", "吗", "？", "?")
    _social_terms = ("你好", "嗨", "早上好", "下午好", "晚上好", "晚安")
    _boilerplate_patterns = (
        r"有需要(?:的话)?(?:就)?随时(?:告诉我|跟我说|说)",
        r"有任何(?:需要|问题).*?随时(?:告诉我|跟我说)",
        r"之后.*?(?:随时说|告诉我就好)",
        r"我会(?:一直)?陪着你(?:的)?",
        r"别担心[，,]?我在(?:这里)?",
    )

    def plan(self, user_input: str) -> DialoguePlan:
        text = user_input.strip()
        if any(question in text for question in IDENTITY_QUESTIONS):
            return DialoguePlan("identity", "简短、直接回答身份问题，只介绍用户询问的部分。", True)
        if any(re.search(pattern, text) for pattern in self._action_patterns):
            return DialoguePlan("action", "优先完成用户明确要求的操作，再准确报告真实结果，不做额外推销。")
        if any(term in text for term in self._answer_terms):
            return DialoguePlan("answer", "直接回答问题，给出与用户原话相关的结论、原因或下一步。")
        if any(term in text for term in self._support_terms):
            return DialoguePlan("support", "先回应具体处境或情绪，再给一个贴合上下文的判断或可执行下一步。")
        if any(term in text for term in self._social_terms):
            return DialoguePlan("social", "自然回应当前招呼，不重新介绍身份，也不追加功能推销。")
        return DialoguePlan("respond", "紧扣用户刚说的内容回应，避免套话；没有必要时不主动扩展任务。")

    @staticmethod
    def _opening(text: str) -> str:
        opening = re.split(r"[，,。！？!?：:\n]", text.strip(), maxsplit=1)[0]
        return re.sub(r"\s+", "", opening).casefold()

    def _has_boilerplate(self, text: str) -> bool:
        return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in self._boilerplate_patterns)

    def assess(self, reply: str, plan: DialoguePlan, persona: dict[str, Any], recent_assistant: list[str],
               executed_tools: list[str] | None = None) -> ReplyAssessment:
        violations: list[str] = []
        name = str(persona.get("name") or "").strip()
        address = str(persona.get("userAddress") or "").strip()
        named_intro = bool(name and re.search(rf"(?:我是|这里是)\s*{re.escape(name)}", reply, flags=re.IGNORECASE))
        role_intro = bool(re.match(r"^\s*(?:我是(?:你的)?|作为你的).{0,8}(?:助手|伙伴|桌面宠物|陪伴)", reply))
        if not plan.allow_identity and (named_intro or role_intro):
            violations.append("unsolicited_identity")
        if address and address != "你" and address in reply:
            recently_used = any(address in item for item in recent_assistant[-3:])
            if recently_used or reply.count(address) > 1 or re.match(rf"^\s*{re.escape(address)}\s*[，,：:]", reply):
                violations.append("repeated_address")
        if self._has_boilerplate(reply):
            violations.append("boilerplate_closing")
        opening = self._opening(reply)
        if len(opening) >= 5 and any(opening == self._opening(item) for item in recent_assistant[-3:]):
            violations.append("repeated_opening")
        action_claim = re.search(r"(?:已经|已)(?:帮你)?(?:添加|创建|完成|记住|记录|设置)", reply)
        if plan.mode == "action" and action_claim and not executed_tools:
            violations.append("unverified_action_claim")
        substantive = re.sub(r"[\s，,。！？!?：:]", "", self.repair(reply, plan, persona))
        if len(substantive) < 3:
            violations.append("generic_only")
        semantic = {"boilerplate_closing", "repeated_opening", "generic_only", "unverified_action_claim"}
        route: QualityRoute = "rewrite" if semantic.intersection(violations) else ("repair" if violations else "accept")
        return ReplyAssessment(tuple(dict.fromkeys(violations)), route)

    def repair(self, reply: str, plan: DialoguePlan, persona: dict[str, Any]) -> str:
        text = reply.strip()
        name = str(persona.get("name") or "")
        address = str(persona.get("userAddress") or "").strip()
        if not plan.allow_identity:
            text = suppress_unsolicited_self_intro(text, name, address, "")
            text = re.sub(
                r"^\s*(?:我是(?:你的)?|作为你的).{0,8}(?:助手|伙伴|桌面宠物|陪伴)\s*[，,。！!：:]*\s*",
                "", text, count=1,
            )
        if address and address != "你":
            text = re.sub(rf"^\s*{re.escape(address)}\s*[，,：:]\s*", "", text, count=1)
        changed = True
        while changed:
            previous = text
            for pattern in self._boilerplate_patterns:
                text = re.sub(rf"\s*{pattern}[。！？!?\s]*$", "", text, flags=re.IGNORECASE).strip()
            changed = text != previous
        return text.strip(" ，,")

    async def rewrite(self, model: Any, reply: str, plan: DialoguePlan, persona: dict[str, Any],
                      violations: list[str] | None = None) -> str:
        style = str(persona.get("speakingStyle") or "克制、自然、简洁")
        evidence_rule = "未执行任何工具，不得声称操作已经完成。" if "unverified_action_claim" in (violations or []) else ""
        response = await model.ainvoke([
            SystemMessage(
                "你是回复编辑节点，不执行工具，也不添加新事实。根据本轮回复目标重写候选回复："
                "保留已完成操作的事实和关键内容；删除自我介绍、用户称呼、重复开场、空泛关心及功能推销；"
                f"{evidence_rule}语言风格为：{style}。只输出改写后的回复。"
            ),
            HumanMessage(f"{plan.as_context()}\n候选回复：{reply}"),
        ])
        content = response.content if isinstance(response.content, str) else str(response.content)
        return self.repair(content, plan, persona)
