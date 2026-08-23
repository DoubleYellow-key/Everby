import { z } from "zod";
import { ACTION_INTENTS, type ActionIntent, type AgentDecision } from "../shared/contracts";

const decisionSchema = z.object({
  actionIntent: z.enum(ACTION_INTENTS),
  mood: z.string().trim().min(1).max(40),
  memoryCandidates: z.array(z.string().trim().min(1).max(240)).max(5).default([])
});

interface ActionCandidate { id: string; intents: readonly ActionIntent[]; weight?: number }
export interface LocalBehavior { id: "idle" | "run-left" | "run-right" | "stretch" | "working" | "review"; minDurationMs: number; maxDurationMs: number }

export function chooseLocalBehavior(roll: number, onRightHalf: boolean): LocalBehavior {
  if (roll < 0.08) return { id: onRightHalf ? "run-left" : "run-right", minDurationMs: 2_200, maxDurationMs: 3_500 };
  if (roll < 0.50) return { id: "working", minDurationMs: 8_000, maxDurationMs: 14_000 };
  if (roll < 0.70) return { id: "stretch", minDurationMs: 1_500, maxDurationMs: 1_500 };
  if (roll < 0.84) return { id: "review", minDurationMs: 4_000, maxDurationMs: 8_000 };
  return { id: "idle", minDurationMs: 5_000, maxDurationMs: 9_000 };
}

export function chooseAnimation(intent: ActionIntent, animations: ActionCandidate[], random = Math.random): string {
  const matches = animations.filter((animation) => animation.intents.includes(intent));
  const pool = matches.length > 0 ? matches : animations.filter((animation) => animation.id === "idle");
  if (pool.length === 0) return animations[0]?.id ?? "idle";
  const total = pool.reduce((sum, animation) => sum + (animation.weight ?? 1), 0);
  let cursor = random() * total;
  for (const animation of pool) {
    cursor -= animation.weight ?? 1;
    if (cursor <= 0) return animation.id;
  }
  return pool.at(-1)?.id ?? "idle";
}

export function resolveDecision(input: unknown): AgentDecision {
  const result = decisionSchema.safeParse(input);
  return result.success ? result.data : { actionIntent: "idle", mood: "calm", memoryCandidates: [] };
}
