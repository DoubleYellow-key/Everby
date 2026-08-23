import "./pet.css";
import { frameAtTime } from "../core/timeline";
import type { PetAnimation, PetRuntime } from "../shared/contracts";

const canvas = document.querySelector<HTMLCanvasElement>("#pet-canvas")!;
const context = canvas.getContext("2d", { alpha: true })!;
const speechBubble = document.querySelector<HTMLDivElement>("#speech-bubble")!;
let runtime: PetRuntime;
let atlas = new Image();
let atlasAlpha: Uint8ClampedArray | null = null;
let atlasWidth = 0;
let animation: PetAnimation;
let animationStarted = performance.now();
let x = 0;
let y = 0;
let dragging = false;
let dragOffset = { x: 0, y: 0 };
let pointerStart = { x: 0, y: 0 };
let lastFrame = performance.now();
let nextBehaviorAt = performance.now() + 4_000;
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

function play(id: string): void {
  animation = findAnimation(id);
  animationStarted = performance.now();
}

function loadImage(src: string): HTMLImageElement {
  const cached = extensionImages.get(src);
  if (cached) return cached;
  const image = new Image(); image.crossOrigin = "anonymous"; image.src = src; extensionImages.set(src, image); return image;
}

function selectLocalBehavior(now: number): void {
  if (dragging || runtime.settings.paused || now < nextBehaviorAt) return;
  const roll = Math.random();
  if (roll > 0.72) play(x > innerWidth / 2 ? "run-left" : "run-right");
  else if (roll > 0.58) play("wave");
  else play("idle");
  nextBehaviorAt = now + 3_000 + Math.random() * 4_000;
}

function draw(now: number): void {
  const delta = Math.min(32, now - lastFrame); lastFrame = now;
  resizeIfNeeded();
  context.clearRect(0, 0, innerWidth, innerHeight);
  if (!runtime || !animation || !atlas.complete) { requestAnimationFrame(draw); return; }
  selectLocalBehavior(now);
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
  if (!animation.loop) {
    const duration = animation.frames.reduce((sum, item) => sum + item.durationMs, 0);
    if (now - animationStarted >= duration) play("idle");
  }
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
  window.souldesk.setPetInteractive(isOpaque(event.clientX, event.clientY));
});
canvas.addEventListener("pointerleave", () => { if (!dragging) window.souldesk.setPetInteractive(false); });
canvas.addEventListener("pointerdown", (event) => {
  if (!isOpaque(event.clientX, event.clientY)) return;
  dragging = true; pointerStart = { x: event.clientX, y: event.clientY }; dragOffset = { x: event.clientX - x, y: event.clientY - y };
  canvas.setPointerCapture(event.pointerId); play("waiting");
});
canvas.addEventListener("pointerup", (event) => {
  if (!dragging) return;
  dragging = false; canvas.releasePointerCapture(event.pointerId); void window.souldesk.savePetPosition(x, y);
  const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  if (moved < 8) { play("wave"); void window.souldesk.openChat(); } else play("idle");
});

async function applyRuntime(next: PetRuntime): Promise<void> {
  runtime = next; x = runtime.settings.x ?? innerWidth - 240; y = runtime.settings.y ?? innerHeight - 230;
  atlas = new Image(); atlas.crossOrigin = "anonymous"; atlas.src = runtime.sheetUrl; await atlas.decode();
  const offscreen = document.createElement("canvas"); offscreen.width = atlas.naturalWidth; offscreen.height = atlas.naturalHeight;
  const offscreenContext = offscreen.getContext("2d", { willReadFrequently: true })!; offscreenContext.drawImage(atlas, 0, 0);
  atlasAlpha = offscreenContext.getImageData(0, 0, offscreen.width, offscreen.height).data; atlasWidth = offscreen.width;
  animation = findAnimation("idle"); animationStarted = performance.now();
  document.documentElement.dataset.appReady = "true";
}

window.souldesk.onRuntime((next) => void applyRuntime(next));
window.souldesk.onPetAction(play);
window.souldesk.onPetSpeech((message) => { speechBubble.textContent = message; speechBubble.classList.add("visible"); setTimeout(() => speechBubble.classList.remove("visible"), 12_000); });
window.addEventListener("resize", resize);
resize(); void window.souldesk.getPetRuntime().then(applyRuntime); requestAnimationFrame(draw);
