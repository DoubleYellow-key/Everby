import type { PetActionSource } from "../shared/contracts";

export type ActionRequestSource = PetActionSource;

export interface QueuedAction {
  actionId: string;
  source: ActionRequestSource;
  priority: number;
  durationSeconds: number;
  ruleId?: string;
}

export function enqueueAction(queue: readonly QueuedAction[], request: QueuedAction, maximum = 8): QueuedAction[] {
  if (queue.some((item) => item.actionId === request.actionId && item.source === request.source)) return [...queue];
  const next = [...queue, request];
  next.sort((left, right) => right.priority - left.priority);
  return next.slice(0, maximum);
}

export function shouldInterruptAction(source: ActionRequestSource, currentSource?: ActionRequestSource): boolean {
  return source === "drag" || currentSource === "state" && source !== "state" || source === "preview" && currentSource !== "drag";
}
