import "./pet.css";
import { enqueueAction, shouldInterruptAction, type QueuedAction } from "../core/action-queue";
import { isRoutineRuleActive, nextRoutineTriggerAt, selectEventRule } from "../core/action-rules";
import { frameAtTime } from "../core/timeline";
import type { ActionRule, PetActionRequest, PetAnimation, PetRuntime } from "../shared/contracts";

const canvas = document.querySelector<HTMLCanvasElement>("#pet-canvas")!;
const context = canvas.getContext("2d", { alpha: true })!;
const speechBubble = document.querySelector<HTMLDivElement>("#speech-bubble")!;
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
let dragOffset = { x: 0, y: 0 };
let pointerStart = { x: 0, y: 0 };
let lastFrame = performance.now();
let lastRoutineCheck = 0;
const routineSchedule = new Map<string, number>();
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

function showIdle(): void {
  currentRequest = null;
  currentEndsAt = Number.POSITIVE_INFINITY;
  animation = findAnimation("idle");
  animationStarted = performance.now();
  document.documentElement.dataset.animation = animation.id;
}

function startAction(request: QueuedAction): void {
  currentRequest = request;
  animation = findAnimation(request.actionId);
  animationStarted = performance.now();
  currentEndsAt = animation.loop ? animationStarted + request.durationSeconds * 1_000 : animationStarted + animationDuration(animation);
  document.documentElement.dataset.animation = animation.id;
}

function finishAction(): void {
  const next = pendingActions.shift();
  if (next) startAction(next); else showIdle();
}

function requestAction(value: PetActionRequest | string): void {
  const request: QueuedAction = typeof value === "string"
    ? { actionId: value, source: value === "drag" ? "drag" : "system", priority: value === "drag" ? 100 : 50, durationSeconds: value === "drag" ? 60 : 8 }
    : value;
  if (!runtime.animations.some((item) => item.id === request.actionId)) return;
  if (shouldInterruptAction(request.source) || (currentRequest?.source === "conversation" && request.source === "conversation")) {
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

function recordRule(rule: ActionRule, now: number): void {
  rule.lastTriggeredAt = now;
  void window.everby.recordActionRuleTrigger(rule.id, now);
}

function requestClickAction(): void {
  const now = Date.now();
  const rule = selectEventRule(runtime.actionRules, { event: "pet_click" }, new Set(runtime.animations.map((item) => item.id)), now);
  if (rule) {
    recordRule(rule, now);
    requestAction({ actionId: rule.actionId, source: "pet_click", priority: 60, durationSeconds: rule.durationSeconds, ruleId: rule.id, triggeredAt: now });
  } else requestAction({ actionId: "wave", source: "pet_click", priority: 60, durationSeconds: 6 });
}

function scheduleRoutines(now: number): void {
  if (runtime.settings.paused || now - lastRoutineCheck < 1_000) return;
  lastRoutineCheck = now;
  const wallClock = Date.now();
  const available = new Set(runtime.animations.map((item) => item.id));
  for (const rule of runtime.actionRules) {
    if (rule.trigger.type !== "routine") continue;
    let nextAt = routineSchedule.get(rule.id);
    if (nextAt === undefined) {
      nextAt = nextRoutineTriggerAt(rule);
      if (nextAt <= wallClock) nextAt = nextRoutineTriggerAt({ ...rule, lastTriggeredAt: wallClock });
      routineSchedule.set(rule.id, nextAt);
    }
    if (wallClock < nextAt) continue;
    routineSchedule.set(rule.id, nextRoutineTriggerAt({ ...rule, lastTriggeredAt: wallClock }));
    if (!isRoutineRuleActive(rule, new Date(wallClock)) || !available.has(rule.actionId) || rule.trigger.probability <= 0 || Math.random() >= rule.trigger.probability) continue;
    recordRule(rule, wallClock);
    requestAction({ actionId: rule.actionId, source: "routine", priority: 10, durationSeconds: rule.durationSeconds, ruleId: rule.id, triggeredAt: wallClock });
  }
}

function draw(now: number): void {
  const delta = Math.min(32, now - lastFrame); lastFrame = now;
  resizeIfNeeded();
  context.clearRect(0, 0, innerWidth, innerHeight);
  if (!runtime || !animation || !atlas.complete) { requestAnimationFrame(draw); return; }
  scheduleRoutines(now);
  if (currentRequest && now >= currentEndsAt) finishAction();
  const index = frameAtTime(animation.frames, now - animationStarted, animation.loop);
  const frame = animation.frames[index];
  const scale = runtime.settings.scale;
  const width = frame.width * scale;
  const height = frame.height * scale;
  if (!dragging && animation.id === "run-right") x += 0.075 * delta;
  if (!dragging && animation.id === "run-left") x -= 0.075 * delta;
  x = Math.max(0, Math.min(innerWidth - width, x));
  y = Math.max(0, Math.min(innerHeight - height, y));
  speechBubble.style.left = `${Math.max(8, Math.min(innerWidth - 268, x - 50))}px`;
  speechBubble.style.top = `${Math.max(8, y - speechBubble.offsetHeight - 10)}px`;
  if (frame.src) {
    const image = loadImage(frame.src);
    if (image.complete) context.drawImage(image, x, y, width, height);
  } else context.drawImage(atlas, frame.x, frame.y, frame.width, frame.height, x, y, width, height);
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
  if (dragging) { x = event.clientX - dragOffset.x; y = event.clientY - dragOffset.y; return; }
  window.everby.setPetInteractive(isOpaque(event.clientX, event.clientY));
});
canvas.addEventListener("pointerleave", () => { if (!dragging) window.everby.setPetInteractive(false); });
canvas.addEventListener("pointerdown", (event) => {
  if (!isOpaque(event.clientX, event.clientY)) return;
  dragging = true; pointerStart = { x: event.clientX, y: event.clientY }; dragOffset = { x: event.clientX - x, y: event.clientY - y };
  canvas.setPointerCapture(event.pointerId); requestAction({ actionId: "drag", source: "drag", priority: 100, durationSeconds: 60 });
});
canvas.addEventListener("pointerup", (event) => {
  if (!dragging) return;
  dragging = false; canvas.releasePointerCapture(event.pointerId); void window.everby.savePetPosition(x, y);
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  currentRequest = null;
  if (moved < 8) { requestClickAction(); void window.everby.openChat(); } else finishAction();
});

async function applyRuntime(next: PetRuntime): Promise<void> {
  runtime = next; x = runtime.settings.x ?? innerWidth - 240; y = runtime.settings.y ?? innerHeight - 230;
  atlas = new Image(); atlas.crossOrigin = "anonymous"; atlas.src = runtime.sheetUrl; await atlas.decode();
  const offscreen = document.createElement("canvas"); offscreen.width = atlas.naturalWidth; offscreen.height = atlas.naturalHeight;
  const offscreenContext = offscreen.getContext("2d", { willReadFrequently: true })!; offscreenContext.drawImage(atlas, 0, 0);
  atlasAlpha = offscreenContext.getImageData(0, 0, offscreen.width, offscreen.height).data; atlasWidth = offscreen.width;
  pendingActions = []; routineSchedule.clear(); lastRoutineCheck = 0; showIdle();
  document.documentElement.dataset.appReady = "true";
}

window.everby.onRuntime((next) => void applyRuntime(next));
window.everby.onPetAction(requestAction);
window.everby.onPetSpeech((message) => { speechBubble.textContent = message; speechBubble.classList.add("visible"); setTimeout(() => speechBubble.classList.remove("visible"), 12_000); });
window.addEventListener("resize", resize);
resize(); void window.everby.getPetRuntime().then(applyRuntime); requestAnimationFrame(draw);
