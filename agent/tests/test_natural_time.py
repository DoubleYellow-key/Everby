import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from everby_agent.tools.natural_time import infer_due_at


class NaturalTimeTests(unittest.TestCase):
    def test_this_week_resolves_to_sunday_end_of_day(self):
        zone = ZoneInfo("Asia/Shanghai")
        now = datetime(2026, 8, 19, 10, 30, tzinfo=zone)
        due_at = infer_due_at("完成后端迁移", "这周完成后端迁移和新需求", "Asia/Shanghai", now)
        due = datetime.fromtimestamp(due_at / 1000, zone)
        self.assertEqual(due, datetime(2026, 8, 23, 23, 59, 59, 999000, tzinfo=zone))

    def test_single_context_scope_applies_to_each_created_todo(self):
        zone = ZoneInfo("Asia/Shanghai")
        now = datetime(2026, 8, 19, 10, 30, tzinfo=zone)
        first = infer_due_at("这周完成后端迁移", "这周完成后端迁移和新需求", "Asia/Shanghai", now)
        second = infer_due_at("完成新需求", "这周完成后端迁移和新需求", "Asia/Shanghai", now)
        self.assertEqual(first, second)

    def test_ambiguous_context_does_not_apply_one_time_to_every_todo(self):
        zone = ZoneInfo("Asia/Shanghai")
        now = datetime(2026, 8, 19, 10, 30, tzinfo=zone)
        self.assertIsNone(infer_due_at("完成新需求", "今天完成迁移，明天完成新需求", "Asia/Shanghai", now))


if __name__ == "__main__":
    unittest.main()
