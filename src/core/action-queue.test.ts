import { describe, expect, it } from "vitest";
import { enqueueAction, shouldInterruptAction, type QueuedAction } from "./action-queue";

const request = (actionId: string, priority: QueuedAction["priority"] = 10): QueuedAction => ({ actionId, source: "routine", priority, durationSeconds: 8 });

describe("action playback queue", () => {
  it("orders pending requests by priority while retaining FIFO order within a priority", () => {
    let queue = enqueueAction([], request("idle-a"));
    queue = enqueueAction(queue, request("chat", 70));
    queue = enqueueAction(queue, request("idle-b"));
    expect(queue.map((item) => item.actionId)).toEqual(["chat", "idle-a", "idle-b"]);
  });

  it("coalesces duplicates and keeps a bounded queue", () => {
    let queue: QueuedAction[] = [];
    for (let index = 0; index < 12; index += 1) queue = enqueueAction(queue, request(`action-${index}`), 8);
    queue = enqueueAction(queue, request("action-7"), 8);
    expect(queue).toHaveLength(8);
    expect(queue.filter((item) => item.actionId === "action-7")).toHaveLength(1);
  });

  it("only allows drag feedback to interrupt an active action", () => {
    expect(shouldInterruptAction("drag")).toBe(true);
    expect(shouldInterruptAction("conversation")).toBe(false);
    expect(shouldInterruptAction("reminder")).toBe(false);
  });
});
