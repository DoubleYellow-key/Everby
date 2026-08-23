import type { ActionIntent, AppSettings, PetAnimation, PetRuntime } from "../shared/contracts";

const FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6] as const;
interface AtlasAction {
  id: string;
  loop: boolean;
  intents: ActionIntent[];
  durationMs: number;
  columns?: number[];
  frameDurationsMs?: number[];
}

const ACTIONS: AtlasAction[] = [
  { id: "idle", loop: true, intents: ["idle"], durationMs: 220 },
  { id: "run-right", loop: true, intents: [], durationMs: 140 },
  { id: "run-left", loop: true, intents: [], durationMs: 140 },
  { id: "wave", loop: false, intents: ["greet", "happy"], durationMs: 320 },
  { id: "jump", loop: false, intents: ["celebrate", "happy", "encourage"], durationMs: 190 },
  { id: "failed", loop: false, intents: ["confused"], durationMs: 220 },
  { id: "stretch", loop: false, intents: ["tired"], durationMs: 300, columns: [0, 1, 2, 3, 4, 4, 3, 5], frameDurationsMs: [280, 280, 300, 320, 650, 220, 260, 420] },
  { id: "working", loop: true, intents: ["work", "encourage"], durationMs: 400, columns: [0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 0, 1] },
  { id: "review", loop: true, intents: ["think", "wait", "work"], durationMs: 220 }
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
    id: action.id,
    loop: action.loop,
    intents: action.intents,
    weight: 1,
    frames: (action.columns ?? Array.from({ length: FRAME_COUNTS[row] }, (_, column) => column)).map((column, frameIndex) => ({
      x: column * 192,
      y: row * 208,
      width: 192,
      height: 208,
      durationMs: action.frameDurationsMs?.[frameIndex] ?? action.durationMs
    }))
  }));

  return {
    ...input,
    canvas: { width: 192, height: 208, anchorX: 96, anchorY: 208 },
    animations,
    settings: input.settings ?? DEFAULT_SETTINGS
  };
}
