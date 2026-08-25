import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

async function verifyPet(app: ElectronApplication, minimumBytes: number, screenshots = false): Promise<void> {
  await expect.poll(async () => (await app.windows()).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
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
    const response = await fetch("everby://pet/daily/spritesheet.webp");
    return { ready: document.documentElement.dataset.appReady, api: Boolean(window.everby), status: response.status, bytes: (await response.arrayBuffer()).byteLength };
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
    await expect.poll(() => pet!.evaluate(() => window.everby.getPetRuntime().then((runtime) => runtime.id))).toBe("daily");
    await manager!.getByRole("button", { name: "计划" }).click();
    await expect(manager!.getByRole("heading", { name: "计划与提醒" })).toBeVisible();
    await manager!.evaluate(() => window.everby.createTodo({ title: "站起来喝口水", remindAt: 1 }));
    await expect.poll(async () => pet!.locator("#speech-bubble").textContent(), { timeout: 12_000 })
      .toContain("站起来喝口水");
    await expect(pet!.locator("#speech-bubble")).toHaveClass(/visible/);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().endsWith("chat.html"))?.isVisible())).toBe(false);
    await pet!.screenshot({ path: join(process.cwd(), "test-results/reminder-bubble.png"), omitBackground: true });
    await manager!.getByLabel("计划内容").fill("完成 Everby 提醒测试");
    await manager!.getByRole("button", { name: "添加计划" }).click();
    await expect(manager!.getByText("完成 Everby 提醒测试")).toBeVisible();
    await manager!.getByRole("checkbox", { name: "完成 完成 Everby 提醒测试" }).click();
    await expect.poll(() => manager!.evaluate(() => window.everby.getSnapshot().then((snapshot) =>
      Boolean(snapshot.todos.find((todo) => todo.title === "完成 Everby 提醒测试")?.completedAt)
    ))).toBe(true);
    await manager!.screenshot({ path: join(process.cwd(), "test-results/plans.png") });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("pet.html"))?.webContents.send("pet:action", { actionId: "working", source: "system", priority: 50, durationSeconds: 1 }));
    await pet!.waitForTimeout(450);
    const dailyOpaquePixels = await pet!.locator("#pet-canvas").evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 3; index < data.length; index += 64) if (data[index] > 0) count += 1;
      return count;
    });
    expect(dailyOpaquePixels).toBeGreaterThan(50);
    await pet!.screenshot({ path: join(process.cwd(), "test-results/daily-coding.png"), omitBackground: true });
    await pet!.waitForTimeout(1_000);
    await manager!.getByRole("button", { name: "动作" }).click();
    await manager!.getByRole("tab", { name: "扩展包" }).click();
    await expect(manager!.getByText("Daily 日常动作组合", { exact: true })).toBeVisible();
    await manager!.getByRole("tab", { name: "事件规则" }).click();
    await expect(manager!.getByText("点击时欢呼", { exact: true })).toBeVisible();
    await expect(manager!.getByText("打招呼时挥手", { exact: true })).toBeVisible();
    await expect(manager!.getByText("疲劳时舒展", { exact: true })).toBeVisible();
    await manager!.getByRole("tab", { name: "状态模式" }).click();
    await expect(manager!.getByText("常态", { exact: true })).toBeVisible();
    await expect(manager!.getByLabel("常态目标活跃度")).toHaveValue("25");
    await manager!.getByRole("tab", { name: "动作库" }).click();
    await manager!.getByRole("option", { name: /欢呼组合/ }).click();
    await expect.poll(() => manager!.locator(".motion-preview-canvas").evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      return Array.from(pixels).filter((_value, index) => index % 4 === 3 && pixels[index] > 0).length;
    })).toBeGreaterThan(100);
    await manager!.getByRole("button", { name: "播放 欢呼组合" }).click();
    await expect.poll(() => pet!.evaluate(() => document.documentElement.dataset.animation)).toBe("daily-cheer-combo");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("pet.html"))?.webContents.send("pet:action", { actionId: "drag", source: "drag", priority: 100, durationSeconds: 1 }));
    await expect.poll(() => pet!.evaluate(() => document.documentElement.dataset.animation)).toBe("drag");
    await pet!.waitForTimeout(300);
    await pet!.screenshot({ path: join(process.cwd(), "test-results/daily-drag.png"), omitBackground: true });
    await manager!.getByRole("tab", { name: "事件规则" }).click();
    await manager!.getByRole("button", { name: "新建规则" }).click();
    await manager!.getByLabel("规则名称").fill("测试提醒欢呼");
    await manager!.getByLabel("播放动作").selectOption("daily-cheer-combo");
    await manager!.getByLabel("事件类型").selectOption("reminder");
    await manager!.getByRole("button", { name: "保存规则" }).click();
    await expect(manager!.getByText("测试提醒欢呼")).toBeVisible();
    await manager!.getByRole("tab", { name: "扩展包" }).click();
    await manager!.getByRole("switch", { name: "启用 Daily 日常动作组合" }).click();
    await manager!.getByRole("tab", { name: "事件规则" }).click();
    const unavailableRules = manager!.getByText("动作不可用，规则不会执行");
    await expect(unavailableRules.first()).toBeVisible();
    expect(await unavailableRules.count()).toBeGreaterThanOrEqual(6);
    await manager!.getByRole("tab", { name: "扩展包" }).click();
    await manager!.getByRole("switch", { name: "启用 Daily 日常动作组合" }).click();
    await manager!.getByRole("button", { name: "陪伴" }).click();
    await manager!.getByRole("button", { name: "25 分钟" }).click();
    await expect.poll(() => manager!.evaluate(() => window.everby.getSnapshot().then((value) => value.actionMode.mode))).toBe("focus");
    await expect.poll(() => pet!.evaluate(() => document.documentElement.dataset.animation)).toBe("daily-focus-cycle");
    await manager!.evaluate(() => window.everby.createTodo({ title: "专注状态刷新测试" }));
    await pet!.waitForTimeout(250);
    await expect(pet!.evaluate(() => document.documentElement.dataset.animation)).resolves.toBe("daily-focus-cycle");
    await manager!.getByRole("button", { name: "提前结束" }).click();
    await expect.poll(() => manager!.evaluate(() => window.everby.getSnapshot().then((value) => value.actionMode.mode))).toBe("normal");
    await manager!.getByRole("button", { name: "动作" }).click();
    await manager!.getByRole("tab", { name: "状态模式" }).click();
    await expect(manager!.getByLabel("专注目标活跃度")).toHaveValue("90");
    await manager!.screenshot({ path: join(process.cwd(), "test-results/motions.png") });
    await chat!.screenshot({ path: join(process.cwd(), "test-results/chat.png") });
    await pet!.screenshot({ path: join(process.cwd(), "test-results/pet.png"), omitBackground: true });
  }
}

test("launches manager, chat and the Daily companion", async () => {
  test.setTimeout(45_000);
  const userData = join(process.cwd(), "test-results/user-data-installed");
  await rm(userData, { recursive: true, force: true });
  const app = await electron.launch({ args: ["."], cwd: process.cwd(), env: { ...process.env, EVERBY_E2E: "1", EVERBY_E2E_USER_DATA: userData } });
  try { await verifyPet(app, 1_000_000, true); } finally { await app.close(); }
});

test("uses Daily when the external role catalog is empty", async () => {
  const userData = join(process.cwd(), "test-results/user-data-placeholder");
  await rm(userData, { recursive: true, force: true });
  const app = await electron.launch({
    args: ["."], cwd: process.cwd(),
    env: { ...process.env, EVERBY_E2E: "1", EVERBY_E2E_USER_DATA: userData, EVERBY_PETDEX_ROOT: join(process.cwd(), "test-results/missing-petdex") }
  });
  try { await verifyPet(app, 1_000_000); } finally { await app.close(); }
});
