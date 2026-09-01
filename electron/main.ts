import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { activeWindow } from "get-windows";
import sharp from "sharp";
import { z } from "zod";
import {
  app, BrowserWindow, dialog, ipcMain, Menu, Notification, protocol, safeStorage, screen, Tray, powerMonitor,
  type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle
} from "electron";
import { createCodexRuntime } from "../src/core/codex-atlas";
import { actionModeSchema, actionProfilePatchSchema, createActionProfileSchema, startActionModeSchema } from "../src/core/action-profile-schema";
import { defaultActionProfiles } from "../src/core/action-profiles";
import { DAILY_DEFAULT_ACTION_RULES } from "../src/core/default-action-rules";
import { createActionRuleSchema, updateActionRuleSchema } from "../src/core/action-rule-schema";
import { ACTION_INTENTS, type ActionIntent, type ActionModeSession, type AgentSnapshot, type AppSettings, type AppSnapshot, type ChatDelta, type ChatImageAttachment, type MotionCatalog, type PetActionRequest, type PetActionSignal, type PetActionSource, type PetRuntime, type PetSummary } from "../src/shared/contracts";
import { AppDatabase } from "./services/database";
import { migrateSoulDeskUserData } from "./services/brand-migration";
import { MotionService } from "./services/motion-service";
import { resolveAppIconPath } from "./services/app-icon";
import { discoverPets, type CatalogPet } from "./services/pet-catalog";
import { installPet } from "./services/pet-installer";
import { PythonAgentClient } from "./services/python-agent";
import { SecretStore } from "./services/secret-store";

const resourceSchemePrivileges = { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true };
protocol.registerSchemesAsPrivileged([
  { scheme: "everby", privileges: resourceSchemePrivileges },
  { scheme: "souldesk", privileges: resourceSchemePrivileges }
]);
const e2eUserData = process.env.EVERBY_E2E_USER_DATA || process.env.SOULDESK_E2E_USER_DATA;
const isE2E = process.env.EVERBY_E2E === "1" || process.env.SOULDESK_E2E === "1";
if (isE2E && e2eUserData) app.setPath("userData", resolve(e2eUserData));
app.setAppUserModelId("app.everby.companion");

let database: AppDatabase;
let motionService: MotionService;
let secretStore: SecretStore;
let embeddingSecretStore: SecretStore;
let visionSecretStore: SecretStore;
let agent: PythonAgentClient;
let managerWindow: BrowserWindow | null = null;
let petWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let actionModeTimer: ReturnType<typeof setTimeout> | null = null;
let currentAppName = "";
const requests = new Map<string, AbortController>();
let petCatalog: CatalogPet[] = [];
let agentSnapshot: AgentSnapshot = {
  petId: "daily", persona: { petId: "daily", name: "Daily", background: "", speakingStyle: "", userAddress: "你", boundaries: "" },
  messages: [], todos: [], memories: [], memorySummary: "", agentCapabilities: { streaming: false, toolCalling: false, embedding: false, vision: false },
  agentStatus: "unconfigured", embeddingStatus: "unconfigured"
};

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const preload = join(__dirname, "../preload/preload.js");

function appIconPath(): string {
  return resolveAppIconPath({
    appPath: app.getAppPath(), isPackaged: app.isPackaged,
    platform: process.platform, resourcesPath: process.resourcesPath
  });
}

function load(window: BrowserWindow, page: "manager" | "pet" | "chat"): void {
  if (rendererUrl) void window.loadURL(`${rendererUrl}/${page}.html`);
  else void window.loadFile(join(__dirname, `../renderer/${page}.html`));
}

function trusted(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const url = event.senderFrame?.url ?? "";
  if (!url.startsWith("file://") && !(rendererUrl && url.startsWith(rendererUrl))) throw new Error("拒绝不受信任的 IPC 调用");
}

const settingsPatchSchema = z.object({
  visible: z.boolean(), paused: z.boolean(), alwaysOnTop: z.boolean(), scale: z.number().min(0.5).max(2),
  x: z.number().nullable(), y: z.number().nullable(), activeAppEnabled: z.boolean(), proactiveEnabled: z.boolean(), remindersEnabled: z.boolean(), taskAssistantEnabled: z.boolean(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
}).partial().strict();
const personaPatchSchema = z.object({ name: z.string().trim().min(1).max(80), background: z.string().trim().max(2_000), speakingStyle: z.string().trim().max(1_000), userAddress: z.string().trim().max(40), boundaries: z.string().trim().max(2_000) }).partial().strict();
const modelPatchSchema = z.object({
  baseUrl: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "模型地址必须使用 HTTP 或 HTTPS"),
  model: z.string().trim().min(1).max(160), temperature: z.number().min(0).max(2), apiKey: z.string().max(2_000).optional()
}).partial().strict();
const embeddingPatchSchema = z.object({
  baseUrl: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "模型地址必须使用 HTTP 或 HTTPS"),
  model: z.string().trim().min(1).max(160), apiKey: z.string().max(2_000).optional()
}).partial().strict();
const visionPatchSchema = z.object({
  baseUrl: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "模型地址必须使用 HTTP 或 HTTPS"),
  model: z.string().trim().min(1).max(160), apiKey: z.string().max(2_000).optional()
}).partial().strict();
const chatImageSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/), name: z.string().min(1).max(160),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataUrl: z.string().min(32).max(3_000_000), size: z.number().int().positive().max(2_000_000)
}).strict().superRefine((value, context) => {
  if (!value.dataUrl.startsWith(`data:${value.mimeType};base64,`)) context.addIssue({ code: "custom", message: "图片数据格式无效" });
});
const chatImageSourceSchema = z.object({
  name: z.string().min(1).max(160), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataUrl: z.string().min(32).max(14_000_000), size: z.number().int().positive().max(10_000_000)
}).strict().superRefine((value, context) => {
  if (!value.dataUrl.startsWith(`data:${value.mimeType};base64,`)) context.addIssue({ code: "custom", message: "图片数据格式无效" });
});
const packIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const actionIdSchema = packIdSchema;
const todoIdSchema = z.string().uuid();
const todoCreateSchema = z.object({
  title: z.string().trim().min(1).max(160), notes: z.string().trim().max(500).optional(),
  dueAt: z.number().int().nonnegative().nullable().optional(), remindAt: z.number().int().nonnegative().nullable().optional(),
  repeat: z.enum(["none", "daily"]).optional()
}).strict();
const todoUpdateSchema = todoCreateSchema.partial().extend({ completed: z.boolean().optional() }).strict();

function desktopBounds(): Rectangle {
  const areas = screen.getAllDisplays().map((display) => display.workArea);
  const left = Math.min(...areas.map((area) => area.x)); const top = Math.min(...areas.map((area) => area.y));
  const right = Math.max(...areas.map((area) => area.x + area.width)); const bottom = Math.max(...areas.map((area) => area.y + area.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function createManagerWindow(): BrowserWindow {
  if (managerWindow) { managerWindow.show(); managerWindow.focus(); return managerWindow; }
  const window = new BrowserWindow({
    width: 1120, height: 760, minWidth: 900, minHeight: 620, title: "Everby",
    backgroundColor: "#fffaf0", show: false, icon: appIconPath(),
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => { managerWindow = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  load(window, "manager");
  managerWindow = window;
  return window;
}

function createChatWindow(): BrowserWindow {
  if (chatWindow) return chatWindow;
  const window = new BrowserWindow({
    width: 380, height: 560, minWidth: 340, minHeight: 180, frame: false, transparent: true,
    show: false, skipTaskbar: true, alwaysOnTop: true, resizable: true, icon: appIconPath(),
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  window.on("blur", () => { if (!window.webContents.isDevToolsOpened()) window.hide(); });
  window.on("closed", () => { chatWindow = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  load(window, "chat");
  chatWindow = window;
  return window;
}

function openChat(): void {
  const window = createChatWindow();
  const desktop = desktopBounds();
  const settings = database.getSettings();
  const petX = desktop.x + (settings.x ?? desktop.width - 260);
  const petY = desktop.y + (settings.y ?? desktop.height - 250);
  const area = screen.getDisplayNearestPoint({ x: petX, y: petY }).workArea;
  const x = Math.max(area.x, Math.min(area.x + area.width - 380, petX - 200));
  const y = Math.max(area.y, Math.min(area.y + area.height - 560, petY - 520));
  window.setBounds({ x, y, width: 380, height: 560 });
  window.show();
  window.focus();
}

function createPetWindow(): BrowserWindow {
  if (petWindow) return petWindow;
  const area = desktopBounds();
  const window = new BrowserWindow({
    ...area, frame: false, transparent: true, backgroundColor: "#00000000", show: false,
    focusable: false, skipTaskbar: true, hasShadow: false, resizable: false, alwaysOnTop: true,
    icon: appIconPath(),
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.setAlwaysOnTop(true, "floating");
  window.on("closed", () => { petWindow = null; });
  load(window, "pet");
  window.once("ready-to-show", () => { if (database.getSettings().visible) window.showInactive(); });
  petWindow = window;
  return window;
}

function bundledPetRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, "pets") : join(app.getAppPath(), "resources/runtime-pets");
}

function petdexRoot(): string {
  return process.env.EVERBY_PETDEX_ROOT || process.env.SOULDESK_PETDEX_ROOT || join(homedir(), ".petdex", "pets");
}

function petSheetUrl(pet: CatalogPet): string {
  return `everby://pet/${encodeURIComponent(pet.id)}/${encodeURIComponent(pet.sheetFile)}?source=${pet.source}`;
}

async function refreshPetCatalog(): Promise<void> {
  petCatalog = await discoverPets(petdexRoot(), bundledPetRoot());
  if (petCatalog.length === 0) throw new Error("没有找到可用的桌宠资源");
  if (!petCatalog.some((pet) => pet.id === database.getActivePetId())) database.setActivePetId(petCatalog[0].id);
}

function activePet(): CatalogPet {
  return petCatalog.find((pet) => pet.id === database.getActivePetId()) ?? petCatalog[0];
}

async function runtimePayload(): Promise<PetRuntime> {
  const pet = activePet();
  const runtime = createCodexRuntime({
    id: pet.id,
    name: pet.name,
    description: pet.description,
    sheetUrl: petSheetUrl(pet),
    settings: database.getSettings(),
    actionRules: database.listActionRules(pet.id), actionProfiles: database.listActionProfiles(pet.id), actionMode: database.getActionMode(pet.id)
  });
  if (pet.id === "daily" && pet.source === "bundled") {
    runtime.animations.push({
      id: "drag", label: "拖动", loop: true, weight: 1, intents: [], source: "base", enabled: true,
      frames: Array.from({ length: 8 }, (_, index) => ({
        x: 0, y: 0, width: 192, height: 208, durationMs: 150,
        src: `everby://pet/${encodeURIComponent(pet.id)}/motions/drag/${String(index).padStart(2, "0")}.png?source=${pet.source}`
      }))
    });
  }
  for (const pack of database.listMotionPacks(pet.id).filter((item) => item.enabled)) {
    const path = database.getMotionPackPath(pack.packId);
    if (path) runtime.animations.push(...await motionService.loadAnimations(path, pack.packId, pet.id, pack.name, true));
  }
  return runtime;
}

async function reconcileMotionPackTargets(): Promise<void> {
  for (const pack of database.listMotionPacks()) {
    const path = database.getMotionPackPath(pack.packId);
    if (!path) continue;
    try {
      const manifest = await motionService.readManifest(path);
      if (pack.targetPetId !== manifest.targetPetId) database.saveMotionPack({ ...pack, targetPetId: manifest.targetPetId }, path);
    } catch { /* Invalid legacy packs remain removable from settings. */ }
  }
}

async function motionCatalog(): Promise<MotionCatalog> {
  const pet = activePet();
  const base = createCodexRuntime({ id: pet.id, name: pet.name, description: pet.description, sheetUrl: petSheetUrl(pet), settings: database.getSettings(), actionProfiles: database.listActionProfiles(pet.id), actionMode: database.getActionMode(pet.id) });
  if (pet.id === "daily" && pet.source === "bundled") {
    base.animations.push({
      id: "drag", label: "拖动", loop: true, weight: 1, intents: [], source: "base", enabled: true,
      frames: Array.from({ length: 8 }, (_, index) => ({ x: 0, y: 0, width: 192, height: 208, durationMs: 150, src: `everby://pet/${encodeURIComponent(pet.id)}/motions/drag/${String(index).padStart(2, "0")}.png?source=${pet.source}` }))
    });
  }
  for (const pack of database.listMotionPacks(pet.id)) {
    const path = database.getMotionPackPath(pack.packId);
    if (path) base.animations.push(...await motionService.loadAnimations(path, pack.packId, pet.id, pack.name, pack.enabled));
  }
  return { petId: pet.id, actions: base.animations };
}

function snapshot(): AppSnapshot {
  const pet = activePet();
  const pets: PetSummary[] = petCatalog.map((item) => ({ id: item.id, name: item.name, description: item.description, source: item.source, sheetUrl: petSheetUrl(item), ...(item.persona ? { persona: item.persona } : {}) }));
  return {
    activePetId: pet.id, pets, persona: agentSnapshot.persona, model: database.getModel(), embedding: database.getEmbedding(), vision: database.getVision(), settings: database.getSettings(),
    messages: agentSnapshot.messages, memorySummary: agentSnapshot.memorySummary, motionPacks: database.listMotionPacks(pet.id), actionRules: database.listActionRules(pet.id),
    actionProfiles: database.listActionProfiles(pet.id), actionMode: database.getActionMode(pet.id), todos: agentSnapshot.todos,
    memories: agentSnapshot.memories, agentCapabilities: agentSnapshot.agentCapabilities, agentStatus: agentSnapshot.agentStatus,
    embeddingStatus: agentSnapshot.embeddingStatus
  };
}

async function configureAgent(): Promise<void> {
  const model = database.getModel(); const embedding = database.getEmbedding(); const vision = database.getVision();
  const pet = activePet();
  const [apiKey, embeddingApiKey, visionApiKey] = await Promise.all([secretStore.getApiKey(), embeddingSecretStore.getApiKey(), visionSecretStore.getApiKey()]);
  await agent.health();
  await agent.configure({
    databasePath: join(app.getPath("userData"), "everby.db"), petId: pet.id, petName: pet.name, petDescription: pet.description,
    petPersona: pet.persona ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    chat: { ...model, apiKey: apiKey ?? "" }, embedding: { ...embedding, apiKey: embeddingApiKey ?? "" },
    vision: { ...vision, apiKey: visionApiKey ?? "" }
  });
  agentSnapshot = await agent.snapshot(database.getActivePetId());
}

async function refreshAgentSnapshot(): Promise<void> {
  agentSnapshot = await agent.snapshot(database.getActivePetId());
}

function sendAll(channel: string, payload: unknown): void {
  for (const window of [managerWindow, chatWindow, petWindow]) if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function validIntent(value: unknown): ActionIntent {
  return typeof value === "string" && ACTION_INTENTS.includes(value as ActionIntent) ? value as ActionIntent : "idle";
}

async function dispatchActionIntent(intentValue: unknown, source: PetActionSource, event: PetActionSignal["event"] = "conversation_intent"): Promise<void> {
  const intent = validIntent(intentValue);
  const signalSource = source === "pet_click" || source === "conversation" || source === "reminder" ? source : "system";
  sendAll("pet:action", { type: "event", event, intent, source: signalSource } satisfies PetActionSignal);
}

function broadcastSnapshot(): void {
  sendAll("app:snapshot-changed", snapshot());
}

async function broadcast(): Promise<void> {
  await refreshAgentSnapshot();
  broadcastSnapshot();
  sendAll("pet:runtime-changed", await runtimePayload());
}

async function runChat(requestId: string, content: string, attachments: ChatImageAttachment[] = []): Promise<void> {
  const petId = database.getActivePetId();
  const controller = new AbortController();
  requests.set(requestId, controller);
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const emit = (delta: ChatDelta) => sendAll("chat:delta", delta);
  try {
    if (!database.getModel().configured) throw new Error("请先在模型设置中配置 API");
    await dispatchActionIntent("think", "conversation");
    const result = await agent.streamReply({
      petId, content, attachments, signal: controller.signal,
      onDelta: (delta) => emit({ requestId, delta, done: false }),
      onProgress: (status) => emit({ requestId, delta: "", done: false, status })
    });
    if (!result.content.trim()) throw new Error("模型没有返回文字");
    if (database.getActivePetId() !== petId) throw new DOMException("角色已切换", "AbortError");
    emit({ requestId, delta: "", done: true });
    await refreshAgentSnapshot(); broadcastSnapshot();
    await dispatchActionIntent(result.actionIntent, "conversation");
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "已停止生成" : error instanceof Error ? error.message : "对话失败";
    emit({ requestId, delta: "", done: true, error: message });
    await dispatchActionIntent("confused", "conversation");
  } finally { clearTimeout(timeout); requests.delete(requestId); }
}

async function normalizeChatImageBuffer(input: Buffer, name: string): Promise<ChatImageAttachment> {
  if (input.byteLength > 10_000_000) throw new Error(`${name} 超过 10 MB`);
  const image = sharp(input, { animated: false, limitInputPixels: 40_000_000 }).rotate();
  const metadata = await image.metadata();
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new Error(`${name} 不是支持的图片格式`);
  let output = await image.resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality: 84, progressive: true }).toBuffer();
  if (output.byteLength > 2_000_000) {
    output = await sharp(input, { animated: false, limitInputPixels: 40_000_000 }).rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 72, progressive: true }).toBuffer();
  }
  if (output.byteLength > 2_000_000) throw new Error(`${name} 压缩后仍超过 2 MB`);
  return {
    id: crypto.randomUUID(), name: `${basename(name, extname(name))}.jpg`, mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${output.toString("base64")}`, size: output.byteLength
  };
}

async function normalizeChatImage(file: string): Promise<ChatImageAttachment> {
  return normalizeChatImageBuffer(await readFile(file), basename(file));
}

async function installMotionForPet(path: string, petId: string, enabled = true): Promise<ReturnType<AppDatabase["listMotionPacks"]>[number]> {
  const baseIds = new Set(["idle", "run-right", "run-left", "wave", "jump", "failed", "stretch", "working", "review", "interaction", "impatient", "acknowledge", "double-wave", "deep-review"]);
  if (petId === "daily") baseIds.add("drag");
  const installed = await motionService.install(path, baseIds, petId);
  const summary = { packId: installed.manifest.packId, version: installed.manifest.version, name: installed.manifest.name, targetPetId: installed.manifest.targetPetId, enabled, animationCount: installed.manifest.animations.length };
  database.saveMotionPack(summary, installed.path);
  return summary;
}

async function installMotion(path: string): Promise<ReturnType<AppDatabase["listMotionPacks"]>[number]> {
  const summary = await installMotionForPet(path, activePet().id);
  await broadcast();
  return summary;
}

async function initializeActionSystem(): Promise<void> {
  const dailyRoutines = database.listMotionPacks("daily").find((pack) => pack.packId === "daily-routines");
  if (!dailyRoutines || dailyRoutines.version === "1.0.0") {
    const archive = app.isPackaged
      ? join(process.resourcesPath, "motion-examples", "daily-routines.soulmotion")
      : join(app.getAppPath(), "examples/motions/daily-routines.soulmotion");
    await installMotionForPet(archive, "daily", dailyRoutines?.enabled ?? true);
  }
  for (const petId of new Set(["daily", database.getActivePetId()])) {
    database.migrateActionSystemV3(petId, DAILY_DEFAULT_ACTION_RULES, defaultActionProfiles(petId));
    database.migrateClickInteractionV1(petId);
    database.migrateActionStatesV1(petId, defaultActionProfiles(petId)[0]);
  }
  scheduleActionModeExpiry(database.getActionMode(database.getActivePetId()));
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const petId = database.getActivePetId();
  const mode = database.getActionMode(petId);
  const customStates = database.listActionProfiles(petId).filter((profile) => profile.mode !== "normal");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开对话", click: openChat },
    { label: "设置", click: () => createManagerWindow() },
    { type: "separator" },
    { label: "切换状态", enabled: customStates.length > 0, submenu: customStates.map((profile) => ({ label: profile.name, click: () => void setActionMode(profile.mode, "manual") })) },
    { label: "结束当前模式", enabled: mode.mode !== "normal", click: () => void stopActionMode() },
    { type: "separator" },
    { label: "退出 Everby", click: () => app.quit() }
  ]));
}

function scheduleActionModeExpiry(session: ActionModeSession): void {
  if (actionModeTimer) clearTimeout(actionModeTimer);
  actionModeTimer = null;
  if (session.endsAt === null) return;
  actionModeTimer = setTimeout(() => {
    database.stopActionMode(session.petId);
    sendAll("pet:speech", "计时结束，回到常态陪伴。");
    refreshTrayMenu();
    void broadcast();
  }, Math.max(1, session.endsAt - Date.now()));
}

async function setActionMode(mode: string, source: "manual" | "conversation"): Promise<ActionModeSession> {
  const petId = database.getActivePetId();
  const profile = database.listActionProfiles(petId).find((item) => item.mode === mode);
  if (!profile || profile.mode === "normal") throw new Error("状态不存在");
  const session = database.startActionMode(petId, mode, profile.defaultDurationMinutes, source);
  scheduleActionModeExpiry(session);
  sendAll("pet:speech", profile.defaultDurationMinutes > 0 ? `已进入${profile.name}，持续 ${profile.defaultDurationMinutes} 分钟。` : `已进入${profile.name}。`);
  refreshTrayMenu();
  await broadcast();
  return session;
}

async function stopActionMode(): Promise<ActionModeSession> {
  const session = database.stopActionMode(database.getActivePetId());
  scheduleActionModeExpiry(session);
  sendAll("pet:speech", "已回到常态陪伴。");
  refreshTrayMenu();
  await broadcast();
  return session;
}

function registerIpc(): void {
  ipcMain.handle("app:snapshot", (event) => { trusted(event); return snapshot(); });
  ipcMain.handle("pet:runtime", async (event) => { trusted(event); return runtimePayload(); });
  ipcMain.handle("pet:select", async (event, petId: unknown) => {
    trusted(event);
    const id = packIdSchema.parse(petId);
    if (!petCatalog.some((pet) => pet.id === id)) throw new Error("角色不存在或资源不可用");
    for (const controller of requests.values()) controller.abort();
    database.setActivePetId(id);
    database.migrateActionSystemV3(id, DAILY_DEFAULT_ACTION_RULES, defaultActionProfiles(id));
    database.migrateClickInteractionV1(id);
    database.migrateActionStatesV1(id, defaultActionProfiles(id)[0]);
    await configureAgent();
    scheduleActionModeExpiry(database.getActionMode(id));
    refreshTrayMenu();
    await broadcast();
  });
  ipcMain.handle("pet:import", async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog({ properties: ["openFile", "openDirectory"], filters: [{ name: "Everby 角色包", extensions: ["zip"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const installed = await installPet(result.filePaths[0], petdexRoot());
    await refreshPetCatalog();
    await broadcast();
    return petCatalog.find((pet) => pet.id === installed.id) ?? null;
  });
  ipcMain.handle("window:open-chat", (event) => { trusted(event); openChat(); });  ipcMain.handle("window:open-manager", (event) => { trusted(event); createManagerWindow(); });
  ipcMain.on("pet:interactive", (event, interactive: unknown) => { trusted(event); if (typeof interactive !== "boolean") return; petWindow?.setIgnoreMouseEvents(!interactive, { forward: true }); });
  ipcMain.handle("pet:position", async (event, x: unknown, y: unknown) => { trusted(event); if (typeof x !== "number" || typeof y !== "number") throw new Error("位置无效"); database.updateSettings({ x, y }); await broadcast(); });
  ipcMain.handle("settings:update", async (event, patch: Partial<AppSettings>) => {
    trusted(event); const settings = database.updateSettings(settingsPatchSchema.parse(patch)); petWindow?.setAlwaysOnTop(settings.alwaysOnTop); settings.visible ? petWindow?.showInactive() : petWindow?.hide(); await broadcast(); return settings;
  });
  ipcMain.handle("persona:update", async (event, patch) => { trusted(event); const value = await agent.updatePersona(database.getActivePetId(), personaPatchSchema.parse(patch)); await broadcast(); return value; });
  ipcMain.handle("model:update", async (event, patch) => {
    trusted(event); const { apiKey, ...modelPatch } = modelPatchSchema.parse(patch ?? {}); if (apiKey?.trim()) await secretStore.setApiKey(apiKey.trim()); const value = database.updateModel(modelPatch, Boolean(apiKey?.trim()) || database.getModel().configured); await configureAgent(); await broadcast(); return value;
  });
  ipcMain.handle("embedding:update", async (event, patch) => {
    trusted(event); const { apiKey, ...embeddingPatch } = embeddingPatchSchema.parse(patch ?? {}); if (apiKey?.trim()) await embeddingSecretStore.setApiKey(apiKey.trim());
    const value = database.updateEmbedding(embeddingPatch, Boolean(apiKey?.trim()) || database.getEmbedding().configured); await configureAgent(); await broadcast(); return value;
  });
  ipcMain.handle("vision:update", async (event, patch) => {
    trusted(event); const { apiKey, ...visionPatch } = visionPatchSchema.parse(patch ?? {}); if (apiKey?.trim()) await visionSecretStore.setApiKey(apiKey.trim());
    const value = database.updateVision(visionPatch, Boolean(apiKey?.trim()) || database.getVision().configured); await configureAgent(); await broadcast(); return value;
  });
  ipcMain.handle("model:test", async (event) => {
    trusted(event); const key = await secretStore.getApiKey(); if (!key) return { ok: false, message: "尚未保存 API Key" };
    try { const capabilities = await agent.probe(); await refreshAgentSnapshot(); broadcastSnapshot(); return { ok: capabilities.streaming, message: capabilities.toolCalling ? "连接成功，工具调用可用" : "聊天可用，但当前模型不支持工具调用" }; } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "连接失败" }; }
  });
  ipcMain.handle("vision:test", async (event) => {
    trusted(event); const key = await visionSecretStore.getApiKey(); if (!key) return { ok: false, message: "尚未保存视觉模型 API Key" };
    try { const result = await agent.probeVision(); await refreshAgentSnapshot(); broadcastSnapshot(); return { ok: result.vision, message: result.message }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : "视觉模型连接失败" }; }
  });
  ipcMain.handle("chat:select-images", async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp"] }]
    });
    if (result.canceled) return [];
    if (result.filePaths.length > 3) throw new Error("每次最多选择 3 张图片");
    return Promise.all(result.filePaths.map(normalizeChatImage));
  });
  ipcMain.handle("chat:prepare-images", async (event, rawImages: unknown) => {
    trusted(event);
    const images = z.array(chatImageSourceSchema).max(3).parse(rawImages);
    return Promise.all(images.map((image) => {
      const encoded = image.dataUrl.slice(image.dataUrl.indexOf(",") + 1);
      const input = Buffer.from(encoded, "base64");
      if (input.byteLength !== image.size) throw new Error(`${image.name} 的图片数据不完整`);
      return normalizeChatImageBuffer(input, image.name);
    }));
  });
  ipcMain.handle("chat:send", (event, content: unknown, rawAttachments: unknown = []) => {
    trusted(event);
    if (typeof content !== "string" || content.length > 4_000) throw new Error("消息内容无效");
    const attachments = z.array(chatImageSchema).max(3).parse(rawAttachments);
    const trimmed = content.trim();
    if (!trimmed && attachments.length === 0) throw new Error("消息内容无效");
    const id = crypto.randomUUID(); void runChat(id, trimmed || "请看看我附加的图片。", attachments); return id;
  });
  ipcMain.handle("chat:stop", (event, id: unknown) => { trusted(event); if (typeof id === "string") requests.get(id)?.abort(); });
  ipcMain.handle("chat:clear", async (event) => { trusted(event); await agent.clearConversation(database.getActivePetId()); await broadcast(); });
  ipcMain.handle("motion:import", async (event) => { trusted(event); const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Everby 动作扩展", extensions: ["soulmotion"] }] }); return result.canceled || !result.filePaths[0] ? null : installMotion(result.filePaths[0]); });
  ipcMain.handle("motion:catalog", async (event) => { trusted(event); return motionCatalog(); });
  ipcMain.handle("motion:enabled", async (event, packId: unknown, enabled: unknown) => { trusted(event); const id = packIdSchema.parse(packId); if (typeof enabled !== "boolean") throw new Error("扩展状态无效"); database.setMotionPackEnabled(id, enabled); await broadcast(); });
  ipcMain.handle("motion:remove", async (event, packId: unknown) => { trusted(event); const id = packIdSchema.parse(packId); const path = database.getMotionPackPath(id); database.deleteMotionPack(id); if (path) await rm(path, { recursive: true, force: true }); await broadcast(); });
  ipcMain.handle("motion:preview", async (event, actionId: unknown) => {
    trusted(event); const id = actionIdSchema.parse(actionId); const runtime = await runtimePayload();
    if (!runtime.animations.some((animation) => animation.id === id)) throw new Error("动作当前不可用");
    sendAll("pet:action", { actionId: id, source: "preview", priority: 90, durationSeconds: 8 } satisfies PetActionRequest);
  });
  ipcMain.handle("action-rule:create", async (event, input: unknown) => {
    trusted(event); const value = createActionRuleSchema.parse(input); const catalog = await motionCatalog();
    if (!catalog.actions.some((action) => action.id === value.actionId)) throw new Error("动作不存在或不适用于当前角色");
    const rule = database.createActionRule(database.getActivePetId(), value); await broadcast(); return rule;
  });
  ipcMain.handle("action-rule:update", async (event, id: unknown, patch: unknown) => {
    trusted(event); const ruleId = todoIdSchema.parse(id); const value = updateActionRuleSchema.parse(patch);
    if (value.actionId) { const catalog = await motionCatalog(); if (!catalog.actions.some((action) => action.id === value.actionId)) throw new Error("动作不存在或不适用于当前角色"); }
    const rule = database.updateActionRule(database.getActivePetId(), ruleId, value); await broadcast(); return rule;
  });
  ipcMain.handle("action-rule:delete", async (event, id: unknown) => { trusted(event); database.deleteActionRule(database.getActivePetId(), todoIdSchema.parse(id)); await broadcast(); });
  ipcMain.handle("action-rule:triggered", (event, id: unknown, triggeredAt: unknown) => {
    trusted(event); if (typeof triggeredAt !== "number" || !Number.isSafeInteger(triggeredAt) || triggeredAt < 0) throw new Error("触发时间无效");
    database.recordActionRuleTrigger(database.getActivePetId(), todoIdSchema.parse(id), triggeredAt);
  });
  ipcMain.handle("action-profile:update", async (event, mode: unknown, patch: unknown) => {
    trusted(event); const petId = database.getActivePetId(); const selectedMode = actionModeSchema.parse(mode); const value = actionProfilePatchSchema.parse(patch);
    const catalog = await motionCatalog(); const ids = new Set(catalog.actions.map((action) => action.id));
    if (![value.fallbackActionId, ...value.items.map((item) => item.actionId), ...Object.values(value.eventActions).map((binding) => binding.actionId)].every((id) => ids.has(id))) throw new Error("状态引用了不可用动作");
    const profile = database.updateActionProfile(petId, selectedMode, value); refreshTrayMenu(); await broadcast(); return profile;
  });
  ipcMain.handle("action-profile:create", async (event, input: unknown) => {
    trusted(event); const value = createActionProfileSchema.parse(input); const catalog = await motionCatalog(); const ids = new Set(catalog.actions.map((action) => action.id));
    if (![value.fallbackActionId, ...value.items.map((item) => item.actionId), ...Object.values(value.eventActions).map((binding) => binding.actionId)].every((id) => ids.has(id))) throw new Error("状态引用了不可用动作");
    const profile = database.createActionProfile(database.getActivePetId(), value); refreshTrayMenu(); await broadcast(); return profile;
  });
  ipcMain.handle("action-profile:delete", async (event, mode: unknown) => {
    trusted(event); const petId = database.getActivePetId(); database.deleteActionProfile(petId, actionModeSchema.parse(mode));
    scheduleActionModeExpiry(database.getActionMode(petId)); refreshTrayMenu(); await broadcast();
  });
  ipcMain.handle("action-mode:start", async (event, input: unknown) => {
    trusted(event); const value = startActionModeSchema.parse(input); return setActionMode(value.mode, "manual");
  });
  ipcMain.handle("action-mode:stop", async (event) => { trusted(event); return stopActionMode(); });
  ipcMain.handle("todo:create", async (event, input: unknown) => { trusted(event); const todo = await agent.createTodo(database.getActivePetId(), todoCreateSchema.parse(input)); await broadcast(); return todo; });
  ipcMain.handle("todo:update", async (event, id: unknown, patch: unknown) => { trusted(event); const todo = await agent.updateTodo(database.getActivePetId(), todoIdSchema.parse(id), todoUpdateSchema.parse(patch)); await broadcast(); return todo; });
  ipcMain.handle("todo:delete", async (event, id: unknown) => { trusted(event); await agent.deleteTodo(database.getActivePetId(), todoIdSchema.parse(id)); await broadcast(); });
  ipcMain.handle("memory:delete", async (event, id: unknown) => { trusted(event); await agent.deleteMemory(database.getActivePetId(), todoIdSchema.parse(id)); await broadcast(); });
  ipcMain.handle("memory:clear", async (event) => { trusted(event); await agent.clearMemories(database.getActivePetId()); await broadcast(); });
}

function createTray(): void {
  tray = new Tray(appIconPath());
  tray.setToolTip("Everby");
  refreshTrayMenu();
  tray.on("click", openChat);
}

async function initialize(): Promise<void> {
  const userData = app.getPath("userData");
  if (process.platform === "darwin") app.dock?.setIcon(appIconPath());
  if (!isE2E) migrateSoulDeskUserData(join(app.getPath("appData"), "SoulDesk"), userData);
  agent = new PythonAgentClient({ packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath });
  database = new AppDatabase(join(userData, "everby.db"));
  motionService = new MotionService(join(userData, "motions"));
  await reconcileMotionPackTargets();
  await mkdir(userData, { recursive: true });
  secretStore = new SecretStore(join(userData, "api-key.bin"), {
    encrypt: async (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result
  });
  embeddingSecretStore = new SecretStore(join(userData, "embedding-api-key.bin"), {
    encrypt: async (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result
  });
  visionSecretStore = new SecretStore(join(userData, "vision-api-key.bin"), {
    encrypt: async (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result
  });
  await refreshPetCatalog();
  await configureAgent();
  await initializeActionSystem();
  agent.onEvent((event) => {
    if (event.type === "pet_action" && !event.requestId && typeof event.data.actionIntent === "string") {
      void dispatchActionIntent(event.data.actionIntent, "system");
    }
    if (event.type === "notification_requested" && typeof event.data.message === "string") {
      sendAll("pet:speech", event.data.message);
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: typeof event.data.title === "string" ? event.data.title : "Everby 提醒",
          body: event.data.message, icon: appIconPath(), silent: false, timeoutType: "never"
        });
        notification.on("click", openChat); notification.show();
      }
      void dispatchActionIntent("encourage", "reminder", "reminder");
    }
    if (event.type === "companion_message" && typeof event.data.message === "string") {
      sendAll("pet:speech", event.data.message);
      void dispatchActionIntent(event.data.kind === "task_review" ? "encourage" : "greet", "system");
    }
    if (["state_changed", "tool_finished"].includes(event.type)) void refreshAgentSnapshot().then(broadcastSnapshot).catch(() => undefined);
  });

  const handleResourceRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    let file: string;
    if (url.hostname === "pet") {
      const [petId, ...parts] = decodeURIComponent(url.pathname.slice(1)).split("/");
      const pet = petCatalog.find((item) => item.id === petId);
      if (!pet) return new Response("Not found", { status: 404 });
      const root = resolve(pet.directory); file = resolve(root, parts.join("/"));
      if (!file.startsWith(`${root}${sep}`)) return new Response("Forbidden", { status: 403 });
    }
    else if (url.hostname === "motion") {
      const [packId, ...parts] = decodeURIComponent(url.pathname.slice(1)).split("/");
      const root = database.getMotionPackPath(packId);
      if (!root) return new Response("Not found", { status: 404 });
      const resolvedRoot = resolve(root);
      file = resolve(resolvedRoot, parts.join("/"));
      if (!file.startsWith(`${resolvedRoot}${sep}`)) return new Response("Forbidden", { status: 403 });
    } else return new Response("Not found", { status: 404 });
    try {
      const bytes = await readFile(file);
      const contentType = file.endsWith(".webp") ? "image/webp" : file.endsWith(".png") ? "image/png" : "application/octet-stream";
      return new Response(new Uint8Array(bytes), { headers: { "content-type": contentType, "access-control-allow-origin": "*" } });
    } catch { return new Response("Not found", { status: 404 }); }
  };
  protocol.handle("everby", handleResourceRequest);
  protocol.handle("souldesk", handleResourceRequest);

  registerIpc();
  createPetWindow();
  createChatWindow();
  createManagerWindow();
  createTray();
  const resizePetWindow = () => petWindow?.setBounds(desktopBounds());
  screen.on("display-added", resizePetWindow); screen.on("display-removed", resizePetWindow); screen.on("display-metrics-changed", resizePetWindow);
  setInterval(() => {
    const idleState = powerMonitor.getSystemIdleState(60);
    const settings = database.getSettings();
    sendAll("pet:presence", { locked: idleState === "locked" });
    const updateAgentPresence = () => void agent.call("runtime.presence", {
      petId: database.getActivePetId(), activeAppName: currentAppName, idleState, settings
    }).catch(() => undefined);
    if (!settings.activeAppEnabled || idleState === "locked") {
      currentAppName = "";
      updateAgentPresence();
      return;
    }
    void activeWindow({ accessibilityPermission: false, screenRecordingPermission: false }).then((value) => {
      currentAppName = value?.owner.name === "Everby" ? "" : value?.owner.name ?? "";
      updateAgentPresence();
    }).catch(() => { currentAppName = ""; updateAgentPresence(); });
  }, 15_000).unref();
}

app.whenReady().then(initialize);
app.on("activate", () => createManagerWindow());
app.on("window-all-closed", () => { if (process.platform !== "darwin") managerWindow = null; });
app.on("before-quit", () => { for (const controller of requests.values()) controller.abort(); agent?.close(); database?.close(); });
