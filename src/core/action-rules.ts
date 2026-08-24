import type { ActionIntent, ActionRule, ActionRuleEvent } from "../shared/contracts";

export interface ActionRuleEventInput { event: ActionRuleEvent; intent?: ActionIntent }

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function isRoutineRuleActive(rule: ActionRule, now: Date): boolean {
  if (!rule.enabled || rule.trigger.type !== "routine") return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutes(rule.trigger.startTime);
  const end = minutes(rule.trigger.endTime);
  let weekday = now.getDay();
  const active = start === end || start < end
    ? current >= start && current < end
    : current >= start || current < end;
  if (!active) return false;
  if (start > end && current < end) weekday = (weekday + 6) % 7;
  return rule.trigger.weekdays.includes(weekday);
}

export function nextRoutineTriggerAt(rule: ActionRule, random = Math.random): number {
  if (rule.trigger.type !== "routine") return Number.POSITIVE_INFINITY;
  const range = rule.trigger.maxIntervalMinutes - rule.trigger.minIntervalMinutes;
  const ratio = Math.min(1, Math.max(0, random()));
  const interval = rule.trigger.minIntervalMinutes + range * ratio;
  return (rule.lastTriggeredAt ?? rule.updatedAt) + interval * 60_000;
}

function eventMatches(rule: ActionRule, input: ActionRuleEventInput): boolean {
  if (!rule.enabled || rule.trigger.type !== "event" || rule.trigger.event !== input.event) return false;
  return input.event !== "conversation_intent" || !rule.trigger.intent || rule.trigger.intent === input.intent;
}

export function selectEventRule(
  rules: ActionRule[],
  input: ActionRuleEventInput,
  availableActionIds: ReadonlySet<string>,
  now: number,
  random = Math.random
): ActionRule | null {
  const candidates = rules
    .filter((rule) => eventMatches(rule, input) && availableActionIds.has(rule.actionId))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  for (const rule of candidates) {
    if (rule.trigger.type !== "event") continue;
    if (rule.lastTriggeredAt !== null && now - rule.lastTriggeredAt < rule.trigger.cooldownSeconds * 1_000) continue;
    if (rule.trigger.probability <= 0 || random() >= rule.trigger.probability) continue;
    return rule;
  }
  return null;
}
