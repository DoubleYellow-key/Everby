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
export interface PetAnimation { id: string; loop: boolean; weight: number; intents: ActionIntent[]; frames: PetFrame[] }
export interface PetRuntime {
  id: string;
  name: string;
  description: string;
  sheetUrl: string;
  canvas: { width: number; height: number; anchorX: number; anchorY: number };
  animations: PetAnimation[];
  settings: AppSettings;
}

export interface PetSummary {
  id: string;
  name: string;
  description: string;
  sheetUrl: string;
  source: "petdex" | "bundled";
}

export interface MotionPackSummary { packId: string; version: string; name: string; enabled: boolean; animationCount: number }
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
  todos: TodoItem[];
  memories: MemoryItem[];
  agentCapabilities: AgentCapabilities;
  agentStatus: AgentStatus;
  embeddingStatus: AgentSnapshot["embeddingStatus"];
}

export interface ChatRequest { content: string }
export interface ChatDelta { requestId: string; delta: string; done: boolean; error?: string }

export interface SoulDeskApi {
  getSnapshot(): Promise<AppSnapshot>;
  getPetRuntime(): Promise<PetRuntime>;
  selectPet(petId: string): Promise<void>;
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
  setMotionEnabled(packId: string, enabled: boolean): Promise<void>;
  removeMotion(packId: string): Promise<void>;
  createTodo(input: CreateTodoInput): Promise<TodoItem>;
  updateTodo(id: string, patch: UpdateTodoInput): Promise<TodoItem>;
  deleteTodo(id: string): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  clearMemories(): Promise<void>;
  onChatDelta(callback: (delta: ChatDelta) => void): () => void;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onRuntime(callback: (runtime: PetRuntime) => void): () => void;
  onPetAction(callback: (animationId: string) => void): () => void;
  onPetSpeech(callback: (message: string) => void): () => void;
}
