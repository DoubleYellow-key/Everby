import re

_SECRET_PATTERNS = (
    re.compile(r"\b(?:api[ _-]?key|password|passwd|secret|token|验证码)\b", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"\b\d{6}\b"),
)
_TRANSIENT_PATTERNS = ("哈哈", "天气", "早上好", "晚安", "你好", "吃了吗")


def is_safe_memory(content: str) -> bool:
    normalized = " ".join(content.split()).strip()
    if len(normalized) < 8 or len(normalized) > 1000:
        return False
    if any(pattern.search(normalized) for pattern in _SECRET_PATTERNS):
        return False
    if len(normalized) < 24 and any(term in normalized for term in _TRANSIENT_PATTERNS):
        return False
    return True
