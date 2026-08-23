import type { ActionIntent, AppSettings, PetAnimation, PetRuntime } from "../shared/contracts";

const FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6] as const;
const ACTIONS: Array<{ id: string; loop: boolean; intents: ActionIntent[]; durationMs: number }> = [
  { id: "idle", loop: true, intents: ["idle", "tired"], durationMs: 180 },
  { id: "run-right", loop: true, intents: ["idle"], durationMs: 110 },
  { id: "run-left", loop: true, intents: ["idle"], durationMs: 110 },
  { id: "wave", loop: false, intents: ["greet", "happy"], durationMs: 150 },
  { id: "jump", loop: false, intents: ["celebrate", "happy", "encourage"], durationMs: 130 },
  { id: "failed", loop: false, intents: ["confused", "tired"], durationMs: 160 },
  { id: "waiting", loop: true, intents: ["wait", "think"], durationMs: 170 },
  { id: "working", loop: true, intents: ["work", "encourage"], durationMs: 120 },
  { id: "review", loop: true, intents: ["think", "work"], durationMs: 160 }
];

export const DEFAULT_SETTINGS: AppSettings = {
  visible: true,
  paused: false,
  alwaysOnTop: true,
  scale: 1,
  x: null,
  y: null,
  activeAppEnabled: false,
  proactiveEnabled: true,
  quietHoursStart: "23:00",
  quietHoursEnd: "08:00"
};

export function createCodexRuntime(input: { id: string; name: string; description: string; sheetUrl: string; settings?: AppSettings }): PetRuntime {
  const animations: PetAnimation[] = ACTIONS.map((action, row) => ({
    ...action,
    weight: 1,
    frames: Array.from({ length: FRAME_COUNTS[row] }, (_, column) => ({
      x: column * 192,
      y: row * 208,
      width: 192,
      height: 208,
      durationMs: action.durationMs
    }))
  }));

  return {
    ...input,
    canvas: { width: 192, height: 208, anchorX: 96, anchorY: 208 },
    animations,
    settings: input.settings ?? DEFAULT_SETTINGS
  };
}
