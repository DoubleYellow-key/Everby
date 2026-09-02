import "./pet.css";
import { enqueueAction, shouldInterruptAction, type QueuedAction } from "../core/action-queue";
import { actionPriority, consumeDirectorActivity, createDirectorState, switchDirectorMode, tickDirector } from "../core/action-director";
import { selectEventRule, selectProfileEventAction } from "../core/action-rules";
import { chooseAnimation, chooseMovementAnimation } from "../core/behavior";
import { classifyPetPointer, shouldStartPetDrag } from "../core/pet-pointer";
import { frameAtTime } from "../core/timeline";
import type { ActionRule, PetActionInput, PetActionRequest, PetActionSignal, PetAnimation, PetFrame, PetRuntime } from "../shared/contracts";

const canvas = document.querySelector<HTMLCanvasElement>("#pet-canvas")!;
const context = canvas.getContext("2d", { alpha: true })!;
const speechBubble = document.querySelector<HTMLDivElement>("#speech-bubble")!;
const bubbleText = speechBubble.querySelector<HTMLDivElement>(".bubble-text")!;
const bubbleDismiss = speechBubble.querySelector<HTMLButtonElement>("#bubble-dismiss")!;
let runtime: PetRuntime;
let atlas = new Image();
let atlasAlpha: Uint8ClampedArray | null = null;
let atlasWidth = 0;
let animation: PetAnimation;
let animationStarted = performance.now();
let currentRequest: QueuedAction | null = null;
let currentEndsAt = Number.POSITIVE_INFINITY;
let pendingActions: QueuedAction[] = [];
let x = 0;
let y = 0;
let dragging = false;
let pressedPointer: { id: number; button: number } | null = null;
let dragOffset = { x: 0, y: 0 };
let pointerStart = { x: 0, y: 0 };
let lastFrame = performance.now();
let directorState = createDirectorState(Date.now());
let locked = false;
const extensionImages = new Map<string, HTMLImageElement>();

function resize(): void {
  const ratio = devicePixelRatio;
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function findAnimation(id: string): PetAnimation { return runtime.animations.find((item) => item.id === id) ?? runtime.animations[0]; }
function animationDuration(value: PetAnimation): number { return value.frames.reduce((sum, frame) => sum + frame.durationMs, 0); }

function switchAnimation(next: PetAnimation, now = performance.now()): void {
  animation = next;
  animationStarted = now;
  document.documentElement.dataset.animation = animation.id;
}

function showIdle(): void {
  currentRequest = null;
  currentEndsAt = Number.POSITIVE_INFINITY;
  switchAnimation(findAnimation("idle"));
}

function settleCurrentActivity(now = performance.now()): void {
  if (!currentRequest || !animation) return;
  const allocated = animation.loop ? currentRequest.durationSeconds : animationDuration(animation) / 1_000;
  const actual = Math.max(0, Math.min(allocated, (now - animationStarted) / 1_000));
  directorState = consumeDirectorActivity(directorState, currentRequest.source === "state" ? -(allocated - actual) : actual);
}

function startAction(request: QueuedAction): void {
  settleCurrentActivity();
  currentRequest = request;
  switchAnimation(findAnimation(request.actionId));
  currentEndsAt = animation.loop ? animationStarted + request.durationSeconds * 1_000 : animationStarted + animationDuration(animation);
  document.documentElement.dataset.animation = animation.id;
}

function finishAction(): void {
  settleCurrentActivity();
  currentRequest = null;
  const next = pendingActions.shift();
  if (next) startAction(next); else showIdle();
}

function requestAction(value: PetActionRequest | string): void {
  const request: QueuedAction = typeof value === "string"
    ? { actionId: value, source: value === "drag" ? "drag" : "system", priority: actionPriority(value === "drag" ? "drag" : "system"), durationSeconds: value === "drag" ? 60 : 8 }
    : { ...value, priority: actionPriority(value.source) };
  const requestedAnimation = runtime.animations.find((item) => item.id === request.actionId);
  if (!requestedAnimation) return;
  if (shouldInterruptAction(request.source, currentRequest?.source) || (currentRequest?.source === "conversation" && request.source === "conversation")) {
    startAction(request); return;
  }
  if (!currentRequest) { startAction(request); return; }
  pendingActions = enqueueAction(pendingActions, request);
}

function loadImage(src: string): HTMLImageElement {
  const cached = extensionImages.get(src);
  if (cached) return cached;
  const image = new Image(); image.crossOrigin = "anonymous"; image.src = src; extensionImages.set(src, image); return image;
}

function frameReady(frame: PetFrame): boolean {
  if (!frame.src) return atlas.complete;
  const image = loadImage(frame.src);
  return image.complete && image.naturalWidth > 0;
}

function drawPetFrame(frame: PetFrame, x: number, y: number, width: number, height: number): void {
  if (!frameReady(frame)) return;
  if (frame.src) context.drawImage(loadImage(frame.src), x, y, width, height);
  else context.drawImage(atlas, frame.x, frame.y, frame.width, frame.height, x, y, width, height);
}

function recordRule(rule: ActionRule, now: number): void {
  rule.lastTriggeredAt = now;
  void window.everby.recordActionRuleTrigger(rule.id, now);
}

function requestClickAction(): void {
  requestEvent({ type: "event", event: "pet_click", source: "pet_click", intent: "happy" });
}

function requestEvent(signal: PetActionSignal): void {
  const now = Date.now();
  const available = new Set(runtime.animations.map((item) => item.id));
  const profile = runtime.actionProfiles.find((item) => item.mode === runtime.actionMode.mode) ?? runtime.actionProfiles[0];
  const stateAction = selectProfileEventAction(profile, signal.event, available);
  const rule = stateAction ? null : selectEventRule(runtime.actionRules, { event: signal.event, intent: signal.intent }, available, now);
  if (rule) recordRule(rule, now);
  const fallback = signal.event === "pet_click" ? "interaction" : chooseAnimation(signal.intent ?? "idle", runtime.animations);
  const source = signal.source === "system" ? "system" : signal.source;
  const priority = actionPriority(source);
  requestAction({ type: "play", actionId: stateAction?.actionId ?? rule?.actionId ?? fallback, source, priority, durationSeconds: stateAction?.durationSeconds ?? rule?.durationSeconds ?? 8, ruleId: rule?.id, triggeredAt: rule ? now : undefined });
}

function scheduleBackground(): void {
  if (currentRequest || !runtime) return;
  const profile = runtime.actionProfiles.find((item) => item.mode === runtime.actionMode.mode) ?? runtime.actionProfiles[0];
  if (!profile) return;
  if (directorState.mode !== runtime.actionMode.mode) directorState = switchDirectorMode(directorState, runtime.actionMode.mode, profile, Date.now());
  const result = tickDirector(directorState, { now: Date.now(), profile, animations: runtime.animations, paused: runtime.settings.paused, locked });
  directorState = result.state;
  if (result.request) startAction(result.request);
}

function draw(now: number): void {
  const delta = Math.min(32, now - lastFrame); lastFrame = now;
  resizeIfNeeded();
  context.clearRect(0, 0, innerWidth, innerHeight);
  if (!runtime || !animation || !atlas.complete) { requestAnimationFrame(draw); return; }
  if (currentRequest && now >= currentEndsAt) finishAction();
  scheduleBackground();
  const frame = animation.frames[frameAtTime(animation.frames, now - animationStarted, animation.loop)];
  const scale = runtime.settings.scale;
  const width = frame.width * scale;
  const height = frame.height * scale;
  if (!dragging && animation.id === "run-right") x += 0.075 * delta;
  if (!dragging && animation.id === "run-left") x -= 0.075 * delta;
  x = Math.max(0, Math.min(innerWidth - width, x));
  y = Math.max(0, Math.min(innerHeight - height, y));
  const bubbleLeft = Math.max(8, Math.min(innerWidth - 288, x - 50));
  speechBubble.style.left = `${bubbleLeft}px`;
  speechBubble.style.top = `${Math.max(8, y - speechBubble.offsetHeight - 10)}px`;
  speechBubble.style.setProperty("--tail-x", `${Math.max(20, Math.min(speechBubble.offsetWidth - 28, x + width / 2 - bubbleLeft))}px`);
  drawPetFrame(frame, x, y, width, height);
  requestAnimationFrame(draw);
}

function resizeIfNeeded(): void { if (canvas.width !== Math.round(innerWidth * devicePixelRatio) || canvas.height !== Math.round(innerHeight * devicePixelRatio)) resize(); }

function isOpaque(clientX: number, clientY: number): boolean {
  if (!runtime || !animation) return false;
  const scale = runtime.settings.scale;
  const localX = Math.floor((clientX - x) / scale);
  const localY = Math.floor((clientY - y) / scale);
  if (localX < 0 || localY < 0 || localX >= 192 || localY >= 208) return false;
  const frame = animation.frames[frameAtTime(animation.frames, performance.now() - animationStarted, animation.loop)];
  if (frame.src || !atlasAlpha) return true;
  const alphaIndex = ((frame.y + localY) * atlasWidth + frame.x + localX) * 4 + 3;
  return atlasAlpha[alphaIndex] > 24;
}

canvas.addEventListener("pointermove", (event) => {
  if (pressedPointer?.id === event.pointerId) {
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    if (!dragging && shouldStartPetDrag(pressedPointer.button, moved)) {
      dragging = true;
      requestAction({ actionId: chooseMovementAnimation(runtime.animations), source: "drag", priority: 100, durationSeconds: 60 });
    }
    if (dragging) { x = event.clientX - dragOffset.x; y = event.clientY - dragOffset.y; }
    return;
  }
  const opaque = isOpaque(event.clientX, event.clientY);
  canvas.style.cursor = opaque ? "pointer" : "default";
  window.everby.setPetInteractive(opaque);
});
canvas.addEventListener("pointerleave", () => { if (!pressedPointer) window.everby.setPetInteractive(false); });
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !isOpaque(event.clientX, event.clientY)) return;
  event.preventDefault();
  pressedPointer = { id: event.pointerId, button: event.button };
  pointerStart = { x: event.clientX, y: event.clientY };
  dragOffset = { x: event.clientX - x, y: event.clientY - y };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", (event) => {
  if (pressedPointer?.id !== event.pointerId) return;
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  const intent = classifyPetPointer(pressedPointer.button, moved);
  pressedPointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (intent === "drag") {
    dragging = false;
    void window.everby.savePetPosition(x, y);
    settleCurrentActivity(); currentRequest = null; finishAction();
  } else if (intent === "interact") requestClickAction();
});
canvas.addEventListener("pointercancel", (event) => {
  if (pressedPointer?.id !== event.pointerId) return;
  pressedPointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (dragging) { dragging = false; settleCurrentActivity(); currentRequest = null; finishAction(); }
});
canvas.addEventListener("contextmenu", (event) => {
  if (!isOpaque(event.clientX, event.clientY) || classifyPetPointer(2, 0) !== "chat") return;
  event.preventDefault();
  void window.everby.openChat();
});

function preloadExtensionFrames(value: PetRuntime): void {
  for (const item of value.animations) for (const frame of item.frames) {
    if (frame.src && !extensionImages.has(frame.src)) void loadImage(frame.src).decode().catch(() => undefined);
  }
}

async function applyRuntime(next: PetRuntime): Promise<void> {
  const previous = runtime;
  const petChanged = !previous || previous.id !== next.id || previous.sheetUrl !== next.sheetUrl;
  const modeChanged = previous?.actionMode.mode !== next.actionMode.mode;
  const currentStillAvailable = !animation || next.animations.some((item) => item.id === animation.id);
  runtime = next; x = runtime.settings.x ?? innerWidth - 240; y = runtime.settings.y ?? innerHeight - 230;
  preloadExtensionFrames(next);
  if (petChanged) {
    atlas = new Image(); atlas.crossOrigin = "anonymous"; atlas.src = runtime.sheetUrl; await atlas.decode();
    const offscreen = document.createElement("canvas"); offscreen.width = atlas.naturalWidth; offscreen.height = atlas.naturalHeight;
    const offscreenContext = offscreen.getContext("2d", { willReadFrequently: true })!; offscreenContext.drawImage(atlas, 0, 0);
    atlasAlpha = offscreenContext.getImageData(0, 0, offscreen.width, offscreen.height).data; atlasWidth = offscreen.width;
  }
  const profile = runtime.actionProfiles.find((item) => item.mode === runtime.actionMode.mode) ?? runtime.actionProfiles[0];
  if (petChanged) directorState = createDirectorState(Date.now());
  if (modeChanged && profile) directorState = switchDirectorMode(directorState, runtime.actionMode.mode, profile, Date.now());
  if (petChanged || !currentStillAvailable || (modeChanged && currentRequest?.source !== "drag")) {
    settleCurrentActivity(); pendingActions = []; showIdle();
  }
  document.documentElement.dataset.actionMode = runtime.actionMode.mode;
  document.documentElement.dataset.appReady = "true";
}

window.everby.onRuntime((next) => void applyRuntime(next));
window.everby.onPetAction((value: PetActionInput) => {
  if (typeof value !== "string" && value.type === "event") requestEvent(value);
  else requestAction(value as PetActionRequest | string);
});
window.everby.onPetPresence((presence) => {
  if (locked && !presence.locked) directorState = { ...createDirectorState(Date.now()), mode: runtime?.actionMode.mode ?? "normal" };
  locked = presence.locked;
});
let speechTimer: ReturnType<typeof setTimeout> | undefined;
function hideSpeech(): void {
  if (speechTimer) { clearTimeout(speechTimer); speechTimer = undefined; }
  speechBubble.classList.remove("visible");
}
window.everby.onPetSpeech((message) => {
  bubbleText.textContent = message;
  speechBubble.classList.remove("visible");
  void speechBubble.offsetWidth;
  speechBubble.classList.add("visible");
  if (speechTimer) clearTimeout(speechTimer);
  speechTimer = setTimeout(hideSpeech, 12_000);
});
bubbleDismiss.addEventListener("click", hideSpeech);
speechBubble.addEventListener("pointermove", () => window.everby.setPetInteractive(true));
speechBubble.addEventListener("pointerleave", () => { if (!pressedPointer) window.everby.setPetInteractive(false); });
window.addEventListener("resize", resize);
resize(); void window.everby.getPetRuntime().then(applyRuntime); requestAnimationFrame(draw);
