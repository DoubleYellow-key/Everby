export const ACTION_INTENTS = [
  "idle", "greet", "happy", "encourage", "think", "work", "wait", "celebrate", "tired", "confused"
] as const;

export type ActionIntent = (typeof ACTION_INTENTS)[number];
export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

export interface AgentDecision {
  actionIntent: ActionIntent;
  mood: string;
  memoryCandidates: string[];
  todoOperations: TodoOperation[];
}

export type TodoRepeat = "none" | "daily";
export type TodoSource = "manual" | "chat";

export interface TodoItem {
  id: string;
  title: string;
  notes: string;
  dueAt: number | null;
  remindAt: number | null;
  repeat: TodoRepeat;
  source: TodoSource;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  lastRemindedAt: number | null;
}

export interface CreateTodoInput {
  title: string;
  notes?: string;
  dueAt?: number | null;
  remindAt?: number | null;
  repeat?: TodoRepeat;
}

export interface UpdateTodoInput {
  title?: string;
  notes?: string;
  dueAt?: number | null;
  remindAt?: number | null;
  repeat?: TodoRepeat;
  completed?: boolean;
}

export type TodoOperation =
  | { type: "create"; title: string; notes?: string; dueAt?: number | null; remindAt?: number | null; repeat?: TodoRepeat }
  | { type: "complete"; title: string };

export interface PersonaProfile {
  petId: string;
  name: string;
  background: string;
  speakingStyle: string;
  userAddress: string;
  boundaries: string;
}

/** 角色作者在 pet.json 里声明的人设默认值（全部可选）；用户手动修改的人设永远优先于它。 */
export type PetPersonaDefaults = Partial<Pick<PersonaProfile, "background" | "speakingStyle" | "userAddress" | "boundaries">>;

export interface ModelSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  configured: boolean;
}

export interface EmbeddingSettings {
  baseUrl: string;
  model: string;
  configured: boolean;
}

export interface AgentCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  embedding: boolean;
}

export type AgentStatus = "unconfigured" | "ready" | "degraded" | "busy" | "error";

export type ActionRuleEvent = "pet_click" | "conversation_intent" | "reminder";
export type PetActionSource = "state" | "pet_click" | "conversation" | "reminder" | "preview" | "drag" | "system";
export interface PetActionRequest {
  type?: "play";
  actionId: string;
  source: PetActionSource;
  priority: number;
  durationSeconds: number;
  ruleId?: string;
  triggeredAt?: number;
}

export interface PetActionSignal {
  type: "event";
  event: ActionRuleEvent;
  intent?: ActionIntent;
  source: "pet_click" | "conversation" | "reminder" | "system";
}
export type PetActionInput = PetActionRequest | PetActionSignal | string;
export interface PetPresence { locked: boolean }

export interface ActionRuleTrigger {
  type: "event";
  event: ActionRuleEvent;
  intent?: ActionIntent;
  probability: number;
  cooldownSeconds: number;
}

export interface ActionRule {
  id: string;
  petId: string;
  name: string;
  actionId: string;
  enabled: boolean;
  durationSeconds: number;
  trigger: ActionRuleTrigger;
  createdAt: number;
  updatedAt: number;
  lastTriggeredAt: number | null;
}

export type CreateActionRuleInput = Pick<ActionRule, "name" | "actionId" | "enabled" | "durationSeconds" | "trigger">;
export type UpdateActionRuleInput = Partial<CreateActionRuleInput>;

export type ActionMode = string;
export interface ActionProfileItem { actionId: string; weight: number }
export interface ActionEventBinding { actionId: string; durationSeconds: number }
export type ActionProfileEvents = Partial<Record<ActionRuleEvent, ActionEventBinding>>;
export interface ActionProfile {
  petId: string;
  mode: ActionMode;
  name: string;
  activityRatio: number;
  strategy: "weighted" | "fixed";
  items: ActionProfileItem[];
  fallbackActionId: string;
  actionDurationSeconds: number;
  defaultDurationMinutes: number;
  eventActions: ActionProfileEvents;
  updatedAt: number;
}
export type CreateActionProfileInput = Pick<ActionProfile, "name" | "activityRatio" | "strategy" | "items" | "fallbackActionId" | "actionDurationSeconds" | "defaultDurationMinutes" | "eventActions">;
export type UpdateActionProfileInput = CreateActionProfileInput;
export interface ActionModeSession {
  petId: string;
  mode: ActionMode;
  source: "manual" | "conversation" | "system";
  startedAt: number;
  endsAt: number | null;
}

export interface MemoryItem {
  id: string;
  type: "preference" | "identity" | "goal" | "project" | "habit" | "relationship" | "commitment";
  content: string;
  sourceMessageId: string | null;
  confidence: number;
  embeddingModel: string | null;
  createdAt: number;
  updatedAt: number;
  accessedAt: number;
  indexed: boolean;
}

export interface AgentSnapshot {
  petId: string;
  persona: PersonaProfile;
  messages: ChatMessage[];
  todos: TodoItem[];
  memories: MemoryItem[];
  memorySummary: string;
  agentCapabilities: AgentCapabilities;
  agentStatus: AgentStatus;
  embeddingStatus: "unconfigured" | "ready" | "degraded" | "indexing";
}

export interface PresenceSettings {
  activeAppEnabled: boolean;
  proactiveEnabled: boolean;
  remindersEnabled: boolean;
  taskAssistantEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface AppSettings extends PresenceSettings {
  visible: boolean;
  paused: boolean;
  alwaysOnTop: boolean;
  scale: number;
  x: number | null;
  y: number | null;
}

export interface PetFrame { x: number; y: number; width: number; height: number; durationMs: number; src?: string }
export interface PetAnimation {
  id: string;
  label?: string;
  loop: boolean;
  weight: number;
  intents: ActionIntent[];
  frames: PetFrame[];
  source?: "base" | "extension";
  packId?: string;
  packName?: string;
  enabled?: boolean;
}
export interface PetRuntime {
  id: string;
  name: string;
  description: string;
  sheetUrl: string;
  canvas: { width: number; height: number; anchorX: number; anchorY: number };
  animations: PetAnimation[];
  actionRules: ActionRule[];
  actionProfiles: ActionProfile[];
  actionMode: ActionModeSession;
  settings: AppSettings;
}

export interface PetSummary {
  id: string;
  name: string;
  description: string;
  sheetUrl: string;
  source: "petdex" | "bundled";
  persona?: PetPersonaDefaults;
}

export interface MotionPackSummary { packId: string; version: string; name: string; targetPetId: string; enabled: boolean; animationCount: number }
export interface MotionCatalog { petId: string; actions: PetAnimation[] }
export interface AppSnapshot {
  activePetId: string;
  pets: PetSummary[];
  persona: PersonaProfile;
  model: ModelSettings;
  embedding: EmbeddingSettings;
  settings: AppSettings;
  messages: ChatMessage[];
  memorySummary: string;
  motionPacks: MotionPackSummary[];
  actionRules: ActionRule[];
  actionProfiles: ActionProfile[];
  actionMode: ActionModeSession;
  todos: TodoItem[];
  memories: MemoryItem[];
  agentCapabilities: AgentCapabilities;
  agentStatus: AgentStatus;
  embeddingStatus: AgentSnapshot["embeddingStatus"];
}

export interface ChatRequest { content: string }
export interface ChatDelta { requestId: string; delta: string; done: boolean; error?: string }

export interface EverbyApi {
  getSnapshot(): Promise<AppSnapshot>;
  getPetRuntime(): Promise<PetRuntime>;
  selectPet(petId: string): Promise<void>;
  importPet(): Promise<PetSummary | null>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  updatePersona(patch: Partial<PersonaProfile>): Promise<PersonaProfile>;
  updateModel(patch: Partial<Omit<ModelSettings, "configured">> & { apiKey?: string }): Promise<ModelSettings>;
  updateEmbedding(patch: Partial<Omit<EmbeddingSettings, "configured">> & { apiKey?: string }): Promise<EmbeddingSettings>;
  testModel(): Promise<{ ok: boolean; message: string }>;
  sendMessage(content: string): Promise<string>;
  stopMessage(requestId: string): Promise<void>;
  clearMessages(): Promise<void>;
  openChat(): Promise<void>;
  openManager(): Promise<void>;
  setPetInteractive(interactive: boolean): void;
  savePetPosition(x: number, y: number): Promise<void>;
  importMotion(): Promise<MotionPackSummary | null>;
  getMotionCatalog(): Promise<MotionCatalog>;
  setMotionEnabled(packId: string, enabled: boolean): Promise<void>;
  removeMotion(packId: string): Promise<void>;
  previewAction(actionId: string): Promise<void>;
  createActionRule(input: CreateActionRuleInput): Promise<ActionRule>;
  updateActionRule(id: string, patch: UpdateActionRuleInput): Promise<ActionRule>;
  deleteActionRule(id: string): Promise<void>;
  recordActionRuleTrigger(id: string, triggeredAt: number): Promise<void>;
  createActionProfile(input: CreateActionProfileInput): Promise<ActionProfile>;
  updateActionProfile(mode: ActionMode, patch: UpdateActionProfileInput): Promise<ActionProfile>;
  deleteActionProfile(mode: ActionMode): Promise<void>;
  startActionMode(mode: ActionMode): Promise<ActionModeSession>;
  stopActionMode(): Promise<ActionModeSession>;
  createTodo(input: CreateTodoInput): Promise<TodoItem>;
  updateTodo(id: string, patch: UpdateTodoInput): Promise<TodoItem>;
  deleteTodo(id: string): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  clearMemories(): Promise<void>;
  onChatDelta(callback: (delta: ChatDelta) => void): () => void;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onRuntime(callback: (runtime: PetRuntime) => void): () => void;
  onPetAction(callback: (request: PetActionInput) => void): () => void;
  onPetPresence(callback: (presence: PetPresence) => void): () => void;
  onPetSpeech(callback: (message: string) => void): () => void;
}
