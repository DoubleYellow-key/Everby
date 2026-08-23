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
}

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

export interface PresenceSettings {
  activeAppEnabled: boolean;
  proactiveEnabled: boolean;
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
  settings: AppSettings;
  messages: ChatMessage[];
  memorySummary: string;
  motionPacks: MotionPackSummary[];
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
  onChatDelta(callback: (delta: ChatDelta) => void): () => void;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onRuntime(callback: (runtime: PetRuntime) => void): () => void;
  onPetAction(callback: (animationId: string) => void): () => void;
  onPetSpeech(callback: (message: string) => void): () => void;
}
