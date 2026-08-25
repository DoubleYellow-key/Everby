import type { ActionIntent, ActionRule, ActionRuleEvent } from "../shared/contracts";

export interface ActionRuleEventInput { event: ActionRuleEvent; intent?: ActionIntent }

function eventMatches(rule: ActionRule, input: ActionRuleEventInput): boolean {
  if (!rule.enabled || rule.trigger.event !== input.event) return false;
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
    if (rule.lastTriggeredAt !== null && now - rule.lastTriggeredAt < rule.trigger.cooldownSeconds * 1_000) continue;
    if (rule.trigger.probability <= 0 || random() >= rule.trigger.probability) continue;
    return rule;
  }
  return null;
}
