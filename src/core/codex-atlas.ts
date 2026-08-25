import type { ActionIntent, AppSettings, PetAnimation, PetRuntime } from "../shared/contracts";
import { defaultActionProfiles } from "./action-profiles";

const FRAME_COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6] as const;
interface AtlasAction {
  id: string;
  label: string;
  loop: boolean;
  intents: ActionIntent[];
  durationMs: number;
  columns?: number[];
  frameDurationsMs?: number[];
}

const ACTIONS: AtlasAction[] = [
  { id: "idle", label: "待机", loop: true, intents: ["idle"], durationMs: 220 },
  { id: "run-right", label: "向右走", loop: true, intents: [], durationMs: 140 },
  { id: "run-left", label: "向左走", loop: true, intents: [], durationMs: 140 },
  { id: "wave", label: "挥手", loop: false, intents: ["greet", "happy"], durationMs: 320 },
  { id: "jump", label: "开心跳跃", loop: false, intents: ["celebrate", "happy", "encourage"], durationMs: 190 },
  { id: "failed", label: "失落", loop: false, intents: ["confused"], durationMs: 220 },
  { id: "stretch", label: "伸展", loop: false, intents: ["tired"], durationMs: 300, columns: [0, 1, 2, 3, 4, 4, 3, 5], frameDurationsMs: [280, 280, 300, 320, 650, 220, 260, 420] },
  { id: "working", label: "专注工作", loop: true, intents: ["work", "encourage"], durationMs: 400, columns: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1] },
  { id: "review", label: "思考检查", loop: true, intents: ["think", "wait", "work"], durationMs: 220 }
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
  remindersEnabled: true,
  taskAssistantEnabled: true,
  quietHoursStart: "23:00",
  quietHoursEnd: "08:00"
};

export function createCodexRuntime(input: { id: string; name: string; description: string; sheetUrl: string; settings?: AppSettings; actionRules?: PetRuntime["actionRules"]; actionProfiles?: PetRuntime["actionProfiles"]; actionMode?: PetRuntime["actionMode"] }): PetRuntime {
  const animations: PetAnimation[] = ACTIONS.map((action, row) => ({
    id: action.id,
    label: action.label,
    loop: action.loop,
    intents: action.intents,
    weight: 1,
    source: "base",
    enabled: true,
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
    actionRules: input.actionRules ?? [],
    actionProfiles: input.actionProfiles ?? defaultActionProfiles(input.id),
    actionMode: input.actionMode ?? { petId: input.id, mode: "normal", source: "system", startedAt: Date.now(), endsAt: null },
    settings: input.settings ?? DEFAULT_SETTINGS
  };
}
