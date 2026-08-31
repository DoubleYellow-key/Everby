import type { PetFrame } from "../shared/contracts";

function timelinePosition(frames: PetFrame[], elapsedMs: number, loop: boolean): { index: number; elapsedInFrame: number } {
  if (frames.length === 0) return { index: 0, elapsedInFrame: 0 };
  const duration = frames.reduce((total, frame) => total + frame.durationMs, 0);
  if (duration <= 0) return { index: 0, elapsedInFrame: 0 };
  const cursor = loop ? Math.max(0, elapsedMs) % duration : Math.min(Math.max(0, elapsedMs), duration - 1);
  let accumulated = 0;
  for (let index = 0; index < frames.length; index += 1) {
    const startedAt = accumulated;
    accumulated += frames[index].durationMs;
    if (cursor < accumulated) return { index, elapsedInFrame: cursor - startedAt };
  }
  return { index: frames.length - 1, elapsedInFrame: frames.at(-1)?.durationMs ?? 0 };
}

export function frameAtTime(frames: PetFrame[], elapsedMs: number, loop: boolean): number {
  return timelinePosition(frames, elapsedMs, loop).index;
}
