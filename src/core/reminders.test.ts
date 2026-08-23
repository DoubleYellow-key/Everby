import { describe, expect, it } from "vitest";
import type { TodoItem } from "../shared/contracts";
import { selectTodosForReview } from "./reminders";

function todo(patch: Partial<TodoItem>): TodoItem {
  return {
    id: "todo", title: "任务", notes: "", dueAt: null, remindAt: null, repeat: "none", source: "manual",
    createdAt: 1, updatedAt: 1, completedAt: null, lastRemindedAt: null, ...patch
  };
}

describe("reminder review selection", () => {
  it("selects overdue and near-term work but ignores distant and completed items", () => {
    const now = 10_000;
    expect(selectTodosForReview([
      todo({ id: "overdue", dueAt: 9_000 }),
      todo({ id: "soon", remindAt: now + 60 * 60_000 }),
      todo({ id: "distant", dueAt: now + 3 * 60 * 60_000 }),
      todo({ id: "done", dueAt: 9_000, completedAt: 9_500 })
    ], now).map((item) => item.id)).toEqual(["overdue", "soon"]);
  });

  it("does not immediately repeat a reminder that just fired", () => {
    const now = 10_000;
    expect(selectTodosForReview([todo({ remindAt: 9_000, lastRemindedAt: now - 10 * 60_000 })], now)).toEqual([]);
  });
});
