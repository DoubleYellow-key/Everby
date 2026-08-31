import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, AppSnapshot, ChatDelta, EmbeddingSettings, ModelSettings, PersonaProfile, PetActionInput, PetPresence, PetRuntime, EverbyApi } from "../src/shared/contracts";

const subscribe = <T>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api: EverbyApi = {
  getSnapshot: () => ipcRenderer.invoke("app:snapshot"),
  getPetRuntime: () => ipcRenderer.invoke("pet:runtime"),
  selectPet: (petId: string) => ipcRenderer.invoke("pet:select", petId),
  importPet: () => ipcRenderer.invoke("pet:import"),
  updateSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", patch),
  updatePersona: (patch: Partial<PersonaProfile>) => ipcRenderer.invoke("persona:update", patch),
  updateModel: (patch: Partial<Omit<ModelSettings, "configured">> & { apiKey?: string }) => ipcRenderer.invoke("model:update", patch),
  updateEmbedding: (patch: Partial<Omit<EmbeddingSettings, "configured">> & { apiKey?: string }) => ipcRenderer.invoke("embedding:update", patch),
  testModel: () => ipcRenderer.invoke("model:test"),
  sendMessage: (content: string) => ipcRenderer.invoke("chat:send", content),
  stopMessage: (requestId: string) => ipcRenderer.invoke("chat:stop", requestId),
  clearMessages: () => ipcRenderer.invoke("chat:clear"),
  openChat: () => ipcRenderer.invoke("window:open-chat"),
  openManager: () => ipcRenderer.invoke("window:open-manager"),
  setPetInteractive: (interactive: boolean) => ipcRenderer.send("pet:interactive", interactive),
  savePetPosition: (x: number, y: number) => ipcRenderer.invoke("pet:position", x, y),
  importMotion: () => ipcRenderer.invoke("motion:import"),
  getMotionCatalog: () => ipcRenderer.invoke("motion:catalog"),
  setMotionEnabled: (packId: string, enabled: boolean) => ipcRenderer.invoke("motion:enabled", packId, enabled),
  removeMotion: (packId: string) => ipcRenderer.invoke("motion:remove", packId),
  previewAction: (actionId: string) => ipcRenderer.invoke("motion:preview", actionId),
  createActionRule: (input) => ipcRenderer.invoke("action-rule:create", input),
  updateActionRule: (id, patch) => ipcRenderer.invoke("action-rule:update", id, patch),
  deleteActionRule: (id) => ipcRenderer.invoke("action-rule:delete", id),
  recordActionRuleTrigger: (id, triggeredAt) => ipcRenderer.invoke("action-rule:triggered", id, triggeredAt),
  createActionProfile: (input) => ipcRenderer.invoke("action-profile:create", input),
  updateActionProfile: (mode, patch) => ipcRenderer.invoke("action-profile:update", mode, patch),
  deleteActionProfile: (mode) => ipcRenderer.invoke("action-profile:delete", mode),
  startActionMode: (mode) => ipcRenderer.invoke("action-mode:start", { mode }),
  stopActionMode: () => ipcRenderer.invoke("action-mode:stop"),
  createTodo: (input) => ipcRenderer.invoke("todo:create", input),
  updateTodo: (id, patch) => ipcRenderer.invoke("todo:update", id, patch),
  deleteTodo: (id) => ipcRenderer.invoke("todo:delete", id),
  deleteMemory: (id) => ipcRenderer.invoke("memory:delete", id),
  clearMemories: () => ipcRenderer.invoke("memory:clear"),
  onChatDelta: (callback: (value: ChatDelta) => void) => subscribe("chat:delta", callback),
  onSnapshot: (callback: (value: AppSnapshot) => void) => subscribe("app:snapshot-changed", callback),
  onRuntime: (callback: (value: PetRuntime) => void) => subscribe("pet:runtime-changed", callback),
  onPetAction: (callback: (value: PetActionInput) => void) => subscribe("pet:action", callback),
  onPetPresence: (callback: (value: PetPresence) => void) => subscribe("pet:presence", callback),
  onPetSpeech: (callback: (value: string) => void) => subscribe("pet:speech", callback)
};

contextBridge.exposeInMainWorld("everby", api);
export type { EverbyApi };
