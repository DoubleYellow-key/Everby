from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

_SCOPES = ("今天", "明天", "后天", "这周", "本周", "下周")


def _scopes(text: str) -> set[str]:
    found = {scope for scope in _SCOPES if scope in text}
    if "本周" in found:
        found.remove("本周")
        found.add("这周")
    return found


def infer_due_at(
    title: str,
    user_input: str,
    timezone: str,
    now: datetime | None = None,
) -> int | None:
    title_scopes = _scopes(title)
    scopes = title_scopes or _scopes(user_input)
    if len(scopes) != 1:
        return None

    try:
        zone = ZoneInfo(timezone)
    except Exception:
        zone = ZoneInfo("UTC")
    current = now.astimezone(zone) if now else datetime.now(zone)
    scope = next(iter(scopes))
    if scope == "今天":
        target = current.date()
    elif scope == "明天":
        target = current.date() + timedelta(days=1)
    elif scope == "后天":
        target = current.date() + timedelta(days=2)
    elif scope == "这周":
        target = current.date() + timedelta(days=6 - current.weekday())
    else:
        target = current.date() + timedelta(days=13 - current.weekday())
    due = datetime.combine(target, time(23, 59, 59, 999000), zone)
    return int(due.timestamp() * 1000)
