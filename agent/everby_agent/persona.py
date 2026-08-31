import re
from typing import Any


IDENTITY_QUESTIONS = ("你是谁", "你叫什么", "叫什么名字", "介绍一下自己", "自我介绍")


def build_persona_context(persona: dict[str, Any]) -> str:
    name = str(persona.get("name") or "Everby")
    return (
        "以下是你持续保持的角色设定，不是让你复述的开场白：\n"
        f"- 名字：{name}\n"
        f"- 角色背景：{persona.get('background') or '桌面陪伴伙伴'}\n"
        f"- 说话风格：{persona.get('speakingStyle') or '克制、自然、简洁'}\n"
        f"- 对用户的称呼：{persona.get('userAddress') or '你'}\n"
        f"- 行为边界：{persona.get('boundaries') or '尊重隐私'}\n"
        f"不要主动说“我是 {name}”，不要在每轮开头重复姓名或用户称呼。"
        "只有用户明确询问你的身份或要求自我介绍时，才简短介绍一次。"
    )


def suppress_unsolicited_self_intro(reply: str, persona_name: str, user_address: str, user_input: str) -> str:
    if any(question in user_input for question in IDENTITY_QUESTIONS):
        return reply
    name = persona_name.strip()
    if not name:
        return reply
    address = user_address.strip()
    address_prefix = rf"(?:{re.escape(address)}\s*[，,：:]\s*)?" if address else ""
    pattern = (
        rf"^\s*{address_prefix}(?:(?:嗨|嘿|你好)\s*[，,。！!]?\s*)?"
        rf"(?:我是|这里是)\s*{re.escape(name)}\s*(?:呀|啊|哦|哟|呢)?\s*[，,。！!：:]*\s*"
    )
    cleaned = re.sub(pattern, "", reply, count=1, flags=re.IGNORECASE).strip()
    return cleaned if cleaned else reply
