import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { activeWindow } from "get-windows";
import { z } from "zod";
import {
  app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, screen, Tray, powerMonitor,
  type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle
} from "electron";
import { createCodexRuntime } from "../src/core/codex-atlas";
import { chooseAnimation } from "../src/core/behavior";
import type { AppSettings, AppSnapshot, ChatDelta, PetRuntime, PetSummary } from "../src/shared/contracts";
import { AppDatabase } from "./services/database";
import { MotionService } from "./services/motion-service";
import { discoverPets, type CatalogPet } from "./services/pet-catalog";
import { PythonAgentClient } from "./services/python-agent";
import { SecretStore } from "./services/secret-store";

protocol.registerSchemesAsPrivileged([{ scheme: "souldesk", privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.env.SOULDESK_E2E === "1" && process.env.SOULDESK_E2E_USER_DATA) app.setPath("userData", resolve(process.env.SOULDESK_E2E_USER_DATA));

let database: AppDatabase;
let motionService: MotionService;
let secretStore: SecretStore;
let agent: PythonAgentClient;
let managerWindow: BrowserWindow | null = null;
let petWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentAppName = "";
let lastBehaviorPlanAt = 0;
let nextProactiveAt = Date.now() + 60 * 60_000;
let proactiveDay = "";
let proactiveCount = 0;
const hourlyPlans: number[] = [];
const requests = new Map<string, AbortController>();
let petCatalog: CatalogPet[] = [];

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const preload = join(__dirname, "../preload/preload.js");

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
  x: z.number().nullable(), y: z.number().nullable(), activeAppEnabled: z.boolean(), proactiveEnabled: z.boolean(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
}).partial().strict();
const personaPatchSchema = z.object({ name: z.string().trim().min(1).max(80), background: z.string().trim().max(2_000), speakingStyle: z.string().trim().max(1_000), userAddress: z.string().trim().max(40), boundaries: z.string().trim().max(2_000) }).partial().strict();
const modelPatchSchema = z.object({
  baseUrl: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "模型地址必须使用 HTTP 或 HTTPS"),
  model: z.string().trim().min(1).max(160), temperature: z.number().min(0).max(2), apiKey: z.string().max(2_000).optional()
}).partial().strict();
const packIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);

function desktopBounds(): Rectangle {
  const areas = screen.getAllDisplays().map((display) => display.workArea);
  const left = Math.min(...areas.map((area) => area.x)); const top = Math.min(...areas.map((area) => area.y));
  const right = Math.max(...areas.map((area) => area.x + area.width)); const bottom = Math.max(...areas.map((area) => area.y + area.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function createManagerWindow(): BrowserWindow {
  if (managerWindow) { managerWindow.show(); managerWindow.focus(); return managerWindow; }
  const window = new BrowserWindow({
    width: 1120, height: 760, minWidth: 900, minHeight: 620, title: "SoulDesk",
    backgroundColor: "#fffaf0", show: false,
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
    show: false, skipTaskbar: true, alwaysOnTop: true, resizable: true,
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
  return process.env.SOULDESK_PETDEX_ROOT || join(homedir(), ".petdex", "pets");
}

function petSheetUrl(pet: CatalogPet): string {
  return `souldesk://pet/${encodeURIComponent(pet.id)}/${encodeURIComponent(pet.sheetFile)}?source=${pet.source}`;
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
    settings: database.getSettings()
  });
  for (const pack of database.listMotionPacks().filter((item) => item.enabled)) {
    const path = database.getMotionPackPath(pack.packId);
    if (path) runtime.animations.push(...await motionService.loadAnimations(path, pack.packId, pet.id));
  }
  return runtime;
}

function snapshot(): AppSnapshot {
  const pet = activePet();
  const pets: PetSummary[] = petCatalog.map((item) => ({ id: item.id, name: item.name, description: item.description, source: item.source, sheetUrl: petSheetUrl(item) }));
  return {
    activePetId: pet.id, pets, persona: database.getPersona(pet.id, pet.name, pet.description), model: database.getModel(), settings: database.getSettings(),
    messages: database.getMessages(), memorySummary: database.getMemorySummary(), motionPacks: database.listMotionPacks()
  };
}

function sendAll(channel: string, payload: unknown): void {
  for (const window of [managerWindow, chatWindow, petWindow]) if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

async function broadcast(): Promise<void> {
  sendAll("app:snapshot-changed", snapshot());
  sendAll("pet:runtime-changed", await runtimePayload());
}

async function runChat(requestId: string, content: string): Promise<void> {
  const petId = database.getActivePetId();
  const controller = new AbortController();
  requests.set(requestId, controller);
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const emit = (delta: ChatDelta) => sendAll("chat:delta", delta);
  try {
    const apiKey = await secretStore.getApiKey();
    const model = database.getModel();
    if (!apiKey || !model.configured) throw new Error("请先在模型设置中配置 API");
    const userMessage = { id: crypto.randomUUID(), role: "user" as const, content, createdAt: Date.now() };
    database.addMessage(userMessage);
    await broadcast();
    sendAll("pet:action", "review");
    const persona = database.getPersona();
    const system = [
      `你是桌面陪伴角色 ${persona.name}。`, persona.background, persona.speakingStyle,
      `称呼用户为：${persona.userAddress}。`, persona.boundaries,
      database.getMemorySummary() ? `长期记忆摘要：${database.getMemorySummary()}` : "",
      currentAppName ? `用户当前正在使用的应用：${currentAppName}。不要猜测应用中的具体内容。` : ""
    ].filter(Boolean).join("\n");
    const messages = [{ role: "system" as const, content: system }, ...database.getMessages(12).map((message) => ({ role: message.role, content: message.content }))];
    const reply = await agent.streamReply({ ...model, apiKey, messages, signal: controller.signal, onDelta: (delta) => emit({ requestId, delta, done: false }) });
    if (!reply.trim()) throw new Error("模型没有返回文字");
    if (database.getActivePetId() !== petId) throw new DOMException("角色已切换", "AbortError");
    database.addMessage({ id: crypto.randomUUID(), role: "assistant", content: reply, createdAt: Date.now() });
    const decision = await agent.planBehavior({ ...model, apiKey, transcript: `${content}\n${reply}`, signal: controller.signal })
      .catch(() => ({ actionIntent: "idle" as const, mood: "calm", memoryCandidates: [] }));
    const runtime = await runtimePayload();
    sendAll("pet:action", chooseAnimation(decision.actionIntent, runtime.animations));
    emit({ requestId, delta: "", done: true });
    if (database.getUnsummarizedMessageCount() >= 24) {
      void agent.summarize({ ...model, apiKey, previous: database.getMemorySummary(petId), transcript: database.getMessages(24).map((message) => `${message.role}: ${message.content}`).join("\n") })
        .then((summary) => { if (summary) { database.setMemorySummary(summary, 24, petId); void broadcast(); } }).catch(() => undefined);
    }
    await broadcast();
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "已停止生成" : error instanceof Error ? error.message : "对话失败";
    emit({ requestId, delta: "", done: true, error: message });
    sendAll("pet:action", "idle");
  } finally { clearTimeout(timeout); requests.delete(requestId); }
}

function inQuietHours(settings: AppSettings, now = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (value: string) => { const [hours, minute] = value.split(":").map(Number); return hours * 60 + minute; };
  const start = parse(settings.quietHoursStart); const end = parse(settings.quietHoursEnd);
  return start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
}

async function runPresenceTick(): Promise<void> {
  const settings = database.getSettings();
  const now = Date.now();
  if (settings.paused || inQuietHours(settings) || powerMonitor.getSystemIdleState(60) === "locked") return;
  const model = database.getModel(); const apiKey = await secretStore.getApiKey();
  if (!model.configured || !apiKey || requests.size > 0) return;
  while (hourlyPlans[0] && hourlyPlans[0] < now - 60 * 60_000) hourlyPlans.shift();
  if (now - lastBehaviorPlanAt >= 15 * 60_000 && hourlyPlans.length < 4) {
    lastBehaviorPlanAt = now; hourlyPlans.push(now);
    void agent.planBehavior({ ...model, apiKey, transcript: `当前时间 ${new Date().toLocaleTimeString()}。${currentAppName ? `用户正在使用 ${currentAppName}。` : ""}选择一个安静自然的桌宠动作。` })
      .then(async (decision) => sendAll("pet:action", chooseAnimation(decision.actionIntent, (await runtimePayload()).animations))).catch(() => undefined);
  }
  const day = new Date().toISOString().slice(0, 10);
  if (proactiveDay !== day) { proactiveDay = day; proactiveCount = 0; }
  if (!settings.proactiveEnabled || now < nextProactiveAt || proactiveCount >= 4) return;
  proactiveCount += 1; nextProactiveAt = now + (60 + Math.random() * 60) * 60_000;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const persona = database.getPersona();
    const reply = await agent.streamReply({ ...model, apiKey, signal: controller.signal, onDelta: () => undefined, messages: [
      { role: "system", content: `你是${persona.name}。${persona.speakingStyle} 主动说一句不超过35字、具体但不打扰的陪伴话语。不要假装知道屏幕内容。` },
      { role: "user", content: `${currentAppName ? `用户正在使用${currentAppName}。` : ""}现在可以轻声问候。` }
    ] });
    if (reply) { database.addMessage({ id: crypto.randomUUID(), role: "assistant", content: reply, createdAt: now }); sendAll("pet:speech", reply); sendAll("pet:action", "wave"); await broadcast(); }
  } catch { /* Proactive failures stay silent. */ } finally { clearTimeout(timeout); }
}

async function installMotion(path: string): Promise<ReturnType<AppDatabase["listMotionPacks"]>[number]> {
  const baseIds = new Set((await runtimePayload()).animations.slice(0, 9).map((animation) => animation.id));
  const installed = await motionService.install(path, baseIds, activePet().id);
  const summary = { packId: installed.manifest.packId, version: installed.manifest.version, name: installed.manifest.name, enabled: true, animationCount: installed.manifest.animations.length };
  database.saveMotionPack(summary, installed.path);
  await broadcast();
  return summary;
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
    sendAll("pet:action", "idle");
    await broadcast();
  });
  ipcMain.handle("window:open-chat", (event) => { trusted(event); openChat(); });
  ipcMain.handle("window:open-manager", (event) => { trusted(event); createManagerWindow(); });
  ipcMain.on("pet:interactive", (event, interactive: unknown) => { trusted(event); if (typeof interactive !== "boolean") return; petWindow?.setIgnoreMouseEvents(!interactive, { forward: true }); });
  ipcMain.handle("pet:position", async (event, x: unknown, y: unknown) => { trusted(event); if (typeof x !== "number" || typeof y !== "number") throw new Error("位置无效"); database.updateSettings({ x, y }); await broadcast(); });
  ipcMain.handle("settings:update", async (event, patch: Partial<AppSettings>) => {
    trusted(event); const settings = database.updateSettings(settingsPatchSchema.parse(patch)); petWindow?.setAlwaysOnTop(settings.alwaysOnTop); settings.visible ? petWindow?.showInactive() : petWindow?.hide(); await broadcast(); return settings;
  });
  ipcMain.handle("persona:update", async (event, patch) => { trusted(event); const value = database.updatePersona(personaPatchSchema.parse(patch)); await broadcast(); return value; });
  ipcMain.handle("model:update", async (event, patch) => {
    trusted(event); const { apiKey, ...modelPatch } = modelPatchSchema.parse(patch ?? {}); if (apiKey?.trim()) await secretStore.setApiKey(apiKey.trim()); const value = database.updateModel(modelPatch, Boolean(apiKey?.trim()) || database.getModel().configured); await broadcast(); return value;
  });
  ipcMain.handle("model:test", async (event) => {
    trusted(event); const key = await secretStore.getApiKey(); const model = database.getModel(); if (!key) return { ok: false, message: "尚未保存 API Key" };
    try { await agent.planBehavior({ ...model, apiKey: key, transcript: "Reply with an idle decision." }); return { ok: true, message: "Python 智能体连接成功" }; } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "连接失败" }; }
  });
  ipcMain.handle("chat:send", (event, content: unknown) => { trusted(event); if (typeof content !== "string" || !content.trim() || content.length > 4_000) throw new Error("消息内容无效"); const id = crypto.randomUUID(); void runChat(id, content.trim()); return id; });
  ipcMain.handle("chat:stop", (event, id: unknown) => { trusted(event); if (typeof id === "string") requests.get(id)?.abort(); });
  ipcMain.handle("chat:clear", async (event) => { trusted(event); database.clearMessages(); await broadcast(); });
  ipcMain.handle("motion:import", async (event) => { trusted(event); const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "SoulDesk 动作扩展", extensions: ["soulmotion"] }] }); return result.canceled || !result.filePaths[0] ? null : installMotion(result.filePaths[0]); });
  ipcMain.handle("motion:enabled", async (event, packId: unknown, enabled: unknown) => { trusted(event); const id = packIdSchema.parse(packId); if (typeof enabled !== "boolean") throw new Error("扩展状态无效"); database.setMotionPackEnabled(id, enabled); await broadcast(); });
  ipcMain.handle("motion:remove", async (event, packId: unknown) => { trusted(event); const id = packIdSchema.parse(packId); const path = database.getMotionPackPath(id); database.deleteMotionPack(id); if (path) await rm(path, { recursive: true, force: true }); await broadcast(); });
}

function createTray(): void {
  tray = new Tray(join(bundledPetRoot(), "daily/tray.png"));
  tray.setToolTip("SoulDesk");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开对话", click: openChat },
    { label: "设置", click: () => createManagerWindow() },
    { type: "separator" },
    { label: "退出 SoulDesk", click: () => app.quit() }
  ]));
  tray.on("click", openChat);
}

async function initialize(): Promise<void> {
  const userData = app.getPath("userData");
  agent = new PythonAgentClient({ packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath });
  database = new AppDatabase(join(userData, "souldesk.db"));
  motionService = new MotionService(join(userData, "motions"));
  await mkdir(userData, { recursive: true });
  secretStore = new SecretStore(join(userData, "api-key.bin"), {
    encrypt: async (value) => safeStorage.encryptStringAsync(value),
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result
  });
  await refreshPetCatalog();

  protocol.handle("souldesk", async (request) => {
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
  });

  registerIpc();
  createPetWindow();
  createChatWindow();
  createManagerWindow();
  createTray();
  const resizePetWindow = () => petWindow?.setBounds(desktopBounds());
  screen.on("display-added", resizePetWindow); screen.on("display-removed", resizePetWindow); screen.on("display-metrics-changed", resizePetWindow);
  setInterval(() => {
    if (!database.getSettings().activeAppEnabled || powerMonitor.getSystemIdleState(60) === "locked") { currentAppName = ""; return; }
    void activeWindow({ accessibilityPermission: false, screenRecordingPermission: false }).then((value) => { currentAppName = value?.owner.name === "SoulDesk" ? "" : value?.owner.name ?? ""; }).catch(() => { currentAppName = ""; });
  }, 15_000).unref();
  setInterval(() => void runPresenceTick(), 60_000).unref();
}

app.whenReady().then(initialize);
app.on("activate", () => createManagerWindow());
app.on("window-all-closed", () => { if (process.platform !== "darwin") managerWindow = null; });
app.on("before-quit", () => { for (const controller of requests.values()) controller.abort(); agent?.close(); database?.close(); });
