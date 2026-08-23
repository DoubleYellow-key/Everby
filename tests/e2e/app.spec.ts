import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

async function verifyPet(app: ElectronApplication, minimumBytes: number, screenshots = false): Promise<void> {
  await expect.poll(async () => (await app.windows()).length).toBeGreaterThanOrEqual(3);
  const windows = await app.windows();
  const manager = windows.find((page) => page.url().endsWith("manager.html"));
  const chat = windows.find((page) => page.url().endsWith("chat.html"));
  const pet = windows.find((page) => page.url().endsWith("pet.html"));
  expect(manager).toBeTruthy(); expect(chat).toBeTruthy(); expect(pet).toBeTruthy();
  await Promise.all([manager!.waitForLoadState("domcontentloaded"), chat!.waitForLoadState("domcontentloaded"), pet!.waitForLoadState("domcontentloaded")]);
  await manager!.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await chat!.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await pet!.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await expect(chat!.getByRole("textbox", { name: "消息" })).toBeAttached();
  await expect(manager!.getByRole("heading", { name: "陪伴状态" })).toBeVisible();
  const resourceState = await pet!.evaluate(async () => {
    const response = await fetch("souldesk://pet/daily/spritesheet.webp");
    return { ready: document.documentElement.dataset.appReady, api: Boolean(window.souldesk), status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  });
  expect(resourceState).toMatchObject({ ready: "true", api: true, status: 200 });
  expect(resourceState.bytes).toBeGreaterThan(minimumBytes);
  await expect.poll(() => pet!.locator("#pet-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 64) if (data[index] > 0) count += 1;
    return count;
  })).toBeGreaterThan(50);
  if (screenshots) {
    await mkdir(join(process.cwd(), "test-results"), { recursive: true });
    await manager!.screenshot({ path: join(process.cwd(), "test-results/manager.png") });
    await manager!.getByRole("button", { name: "角色" }).click();
    await expect(manager!.getByRole("heading", { name: "角色与人设" })).toBeVisible();
    await expect(manager!.getByRole("option", { name: /Daily/ })).toHaveAttribute("aria-selected", "true");
    await manager!.screenshot({ path: join(process.cwd(), "test-results/roles.png") });
    await expect.poll(() => pet!.evaluate(() => window.souldesk.getPetRuntime().then((runtime) => runtime.id))).toBe("daily");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("pet.html"))?.webContents.send("pet:action", "working"));
    await pet!.waitForTimeout(450);
    const dailyOpaquePixels = await pet!.locator("#pet-canvas").evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 3; index < data.length; index += 64) if (data[index] > 0) count += 1;
      return count;
    });
    expect(dailyOpaquePixels).toBeGreaterThan(50);
    await pet!.screenshot({ path: join(process.cwd(), "test-results/daily-coding.png"), omitBackground: true });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("pet.html"))?.webContents.send("pet:action", "drag"));
    await expect.poll(() => pet!.evaluate(() => document.documentElement.dataset.animation)).toBe("drag");
    await pet!.waitForTimeout(300);
    await pet!.screenshot({ path: join(process.cwd(), "test-results/daily-drag.png"), omitBackground: true });
    await chat!.screenshot({ path: join(process.cwd(), "test-results/chat.png") });
    await pet!.screenshot({ path: join(process.cwd(), "test-results/pet.png"), omitBackground: true });
  }
}

test("launches manager, chat and the Daily companion", async () => {
  const userData = join(process.cwd(), "test-results/user-data-installed");
  await rm(userData, { recursive: true, force: true });
  const app = await electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, SOULDESK_E2E: "1", SOULDESK_E2E_USER_DATA: userData } });
  try { await verifyPet(app, 1_000_000, true); } finally { await app.close(); }
});

test("uses Daily when the external role catalog is empty", async () => {
  const userData = join(process.cwd(), "test-results/user-data-placeholder");
  await rm(userData, { recursive: true, force: true });
  const app = await electron.launch({
    args: ["."], cwd: process.cwd(),
    env: { ...process.env, SOULDESK_E2E: "1", SOULDESK_E2E_USER_DATA: userData, SOULDESK_PETDEX_ROOT: join(process.cwd(), "test-results/missing-petdex") }
  });
  try { await verifyPet(app, 1_000_000); } finally { await app.close(); }
});
