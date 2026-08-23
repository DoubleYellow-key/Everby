import type { PetFrame } from "../shared/contracts";

export function frameAtTime(frames: PetFrame[], elapsedMs: number, loop: boolean): number {
  if (frames.length === 0) return 0;
  const duration = frames.reduce((total, frame) => total + frame.durationMs, 0);
  const cursor = loop ? elapsedMs % duration : Math.min(elapsedMs, duration - 1);
  let accumulated = 0;
  for (let index = 0; index < frames.length; index += 1) {
    accumulated += frames[index].durationMs;
    if (cursor < accumulated) return index;
  }
  return frames.length - 1;
}
