import type { TodoItem } from "../shared/contracts";

const REVIEW_WINDOW_MS = 2 * 60 * 60_000;
const RECENT_REMINDER_COOLDOWN_MS = 30 * 60_000;

function scheduleTime(item: TodoItem): number | null {
  const values = [item.dueAt, item.remindAt].filter((value): value is number => value !== null);
  return values.length > 0 ? Math.min(...values) : null;
}

export function selectTodosForReview(items: TodoItem[], now = Date.now()): TodoItem[] {
  return items.filter((item) => {
    if (item.completedAt !== null) return false;
    if (item.lastRemindedAt !== null && now - item.lastRemindedAt < RECENT_REMINDER_COOLDOWN_MS) return false;
    const scheduled = scheduleTime(item);
    return scheduled !== null && scheduled <= now + REVIEW_WINDOW_MS;
  }).sort((left, right) => scheduleTime(left)! - scheduleTime(right)!).slice(0, 8);
}
