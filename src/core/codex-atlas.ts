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
  { id: "idle", label: "待机", loop: true, intents: ["idle"], durationMs: 220, columns: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1] },
  { id: "run-right", label: "向右走", loop: true, intents: [], durationMs: 140 },
  { id: "run-left", label: "向左走", loop: true, intents: [], durationMs: 140 },
  { id: "wave", label: "挥手", loop: false, intents: ["greet", "happy"], durationMs: 220, columns: [0, 1, 2, 3, 2, 1, 0] },
  { id: "jump", label: "开心跳跃", loop: false, intents: ["celebrate", "happy", "encourage"], durationMs: 170, columns: [0, 1, 2, 3, 4, 3, 2, 1, 0] },
  { id: "failed", label: "失落", loop: false, intents: ["confused"], durationMs: 190, columns: [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0] },
  { id: "stretch", label: "伸展", loop: false, intents: ["tired"], durationMs: 300, columns: [0, 1, 2, 3, 4, 4, 3, 5], frameDurationsMs: [280, 280, 300, 320, 650, 220, 260, 420] },
  { id: "working", label: "专注工作", loop: true, intents: ["work", "encourage"], durationMs: 400, columns: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1] },
  { id: "review", label: "思考检查", loop: true, intents: ["think", "wait", "work"], durationMs: 240, columns: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1] }
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
  animations.find((animation) => animation.id === "stretch")?.frames.push({
    x: 0, y: 0, width: 192, height: 208, durationMs: 180
  });
  animations.push({
    id: "interaction",
    label: "互动回应",
    loop: false,
    intents: ["greet", "happy"],
    weight: 1,
    source: "base",
    enabled: true,
    frames: [
      [0, 0, 140],
      [3, 0, 160], [3, 1, 220], [3, 2, 240], [3, 3, 200], [3, 2, 180], [3, 1, 160], [3, 0, 140],
      [4, 0, 140], [4, 1, 150], [4, 2, 180], [4, 3, 210], [4, 4, 190], [4, 3, 170], [4, 2, 150], [4, 1, 140], [4, 0, 140],
      [0, 0, 160]
    ].map(([row, column, durationMs]) => ({
      x: column * 192, y: row * 208, width: 192, height: 208, durationMs
    }))
  });
  animations.push({
    id: "impatient", label: "不耐烦", loop: false, intents: ["confused", "wait"], weight: 1,
    source: "base", enabled: true,
    frames: [0, 1, 2, 3, 4, 5, 4, 3, 0].map((column, index) => ({
      x: column * 192, y: 5 * 208, width: 192, height: 208,
      durationMs: index === 5 ? 480 : index === 0 || index === 8 ? 180 : 220
    }))
  });
  animations.push({
    id: "acknowledge", label: "点头确认", loop: false, intents: ["greet", "encourage", "wait"], weight: 1,
    source: "base", enabled: true,
    frames: [0, 1, 2, 3, 2, 1, 0].map((column, index) => ({
      x: column * 192, y: 0, width: 192, height: 208, durationMs: index === 3 ? 260 : 150
    }))
  });
  animations.push({
    id: "double-wave", label: "双手回应", loop: false, intents: ["greet", "happy", "celebrate"], weight: 1,
    source: "base", enabled: true,
    frames: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0].map((column) => ({
      x: column * 192, y: 3 * 208, width: 192, height: 208, durationMs: column === 3 ? 180 : 130
    }))
  });
  animations.push({
    id: "deep-review", label: "深度检查", loop: true, intents: ["think", "work", "wait"], weight: 1,
    source: "base", enabled: true,
    frames: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1].map((column, index) => ({
      x: column * 192, y: 8 * 208, width: 192, height: 208, durationMs: index === 5 ? 420 : 260
    }))
  });

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
