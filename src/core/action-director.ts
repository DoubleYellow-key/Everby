import type { ActionIntent, ActionMode, ActionProfile, PetActionRequest, PetActionSource, PetAnimation } from "../shared/contracts";

const priorities: Record<PetActionSource, number> = { drag: 100, preview: 90, reminder: 80, conversation: 70, pet_click: 60, system: 50, state: 10 };
export function actionPriority(source: PetActionSource): number { return priorities[source]; }
export function automaticModeForIntent(mode: ActionMode, intent: ActionIntent): { mode: "rest"; durationMinutes: 10 } | null {
  return mode === "normal" && intent === "tired" ? { mode: "rest", durationMinutes: 10 } : null;
}

export interface DirectorSnapshot {
  mode: ActionMode;
  budgetSeconds: number;
  updatedAt: number;
  nextEligibleAt: number;
  lastActionId: string | null;
  lastActionAt: number | null;
}

export interface DirectorTickInput {
  now: number;
  profile: ActionProfile;
  animations: PetAnimation[];
  paused: boolean;
  locked: boolean;
  random?: () => number;
}

function durationSeconds(animation: PetAnimation, mode: ActionMode): number {
  if (!animation.loop) return animation.frames.reduce((sum, frame) => sum + frame.durationMs, 0) / 1_000;
  return mode === "focus" ? 180 : mode === "rest" ? 12 : 15;
}

function chooseWeighted(profile: ActionProfile, available: Map<string, PetAnimation>, state: DirectorSnapshot, now: number, random: () => number): PetAnimation | null {
  const candidates = profile.items.flatMap((item) => {
    const animation = available.get(item.actionId);
    return animation ? [{ animation, weight: item.weight }] : [];
  });
  const fallback = available.get(profile.fallbackActionId) ?? available.get("idle") ?? available.values().next().value ?? null;
  if (profile.strategy === "fixed") return candidates[0]?.animation ?? fallback;
  const filtered = candidates.length > 1 && state.lastActionId && state.lastActionAt !== null && now - state.lastActionAt < 30_000
    ? candidates.filter((item) => item.animation.id !== state.lastActionId)
    : candidates;
  if (filtered.length === 0) return fallback;
  const total = filtered.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.min(0.999999, Math.max(0, random())) * total;
  for (const item of filtered) {
    cursor -= item.weight;
    if (cursor < 0) return item.animation;
  }
  return filtered.at(-1)!.animation;
}

export function createDirectorState(now = 0): DirectorSnapshot {
  return { mode: "normal", budgetSeconds: 0, updatedAt: now, nextEligibleAt: now, lastActionId: null, lastActionAt: null };
}

export function switchDirectorMode(state: DirectorSnapshot, mode: ActionMode, profile: ActionProfile, now: number): DirectorSnapshot {
  const immediateDuration = mode === "focus" ? 180 : mode === "rest" ? 12 : 0;
  return {
    ...state, mode, updatedAt: now, nextEligibleAt: now,
    budgetSeconds: mode === "normal" ? 0 : Math.max(state.budgetSeconds, immediateDuration * (1 - profile.activityRatio))
  };
}

export function consumeDirectorActivity(state: DirectorSnapshot, duration: number): DirectorSnapshot {
  return { ...state, budgetSeconds: state.budgetSeconds - duration };
}

export function tickDirector(state: DirectorSnapshot, input: DirectorTickInput): { state: DirectorSnapshot; request: PetActionRequest | null } {
  const elapsed = Math.max(0, input.now - state.updatedAt) / 1_000;
  const accrued = Math.min(120, state.budgetSeconds + elapsed * input.profile.activityRatio);
  let next: DirectorSnapshot = { ...state, mode: input.profile.mode, budgetSeconds: accrued, updatedAt: input.now };
  if (input.paused || input.locked || input.now < state.nextEligibleAt) return { state: next, request: null };
  const available = new Map(input.animations.filter((item) => item.enabled !== false).map((item) => [item.id, item]));
  const animation = chooseWeighted(input.profile, available, state, input.now, input.random ?? Math.random);
  if (!animation || animation.id === "idle") return { state: next, request: null };
  const duration = durationSeconds(animation, input.profile.mode);
  if (accrued < duration * (1 - input.profile.activityRatio)) return { state: next, request: null };
  next = {
    ...next,
    budgetSeconds: accrued - duration,
    nextEligibleAt: input.now + duration * 1_000 + 2_000,
    lastActionId: animation.id,
    lastActionAt: input.now
  };
  return {
    state: next,
    request: { type: "play", actionId: animation.id, source: "state", priority: actionPriority("state"), durationSeconds: duration }
  };
}
