import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./database";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("AppDatabase", () => {
  it("seeds the Daily persona and persists settings and messages", () => {
    const directory = mkdtempSync(join(tmpdir(), "souldesk-db-"));
    directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    expect(database.getPersona().petId).toBe("daily");
    database.updateSettings({ paused: true, scale: 1.25 });
    database.addMessage({ id: "m1", role: "user", content: "hello", createdAt: 1 });
    expect(database.getSettings()).toMatchObject({ paused: true, scale: 1.25 });
    expect(database.getMessages()).toHaveLength(1);
    database.close();
  });

  it("keeps only the newest 200 messages", () => {
    const directory = mkdtempSync(join(tmpdir(), "souldesk-db-"));
    directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    for (let index = 0; index < 205; index += 1) database.addMessage({ id: `m${index}`, role: "user", content: `${index}`, createdAt: index });
    expect(database.getMessages()).toHaveLength(200);
    expect(database.getMessages()[0].content).toBe("5");
    expect(database.getUnsummarizedMessageCount()).toBe(205);
    database.setMemorySummary("summary", 192);
    expect(database.getMemorySummary()).toBe("summary");
    expect(database.getUnsummarizedMessageCount()).toBe(13);
    database.close();
  });

  it("keeps persona, messages and memory separate for each pet", () => {
    const directory = mkdtempSync(join(tmpdir(), "souldesk-db-"));
    directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    database.addMessage({ id: "daily-1", role: "user", content: "Daily chat", createdAt: 1 });
    database.setMemorySummary("Daily memory");
    database.setActivePetId("boba");
    expect(database.getPersona("boba", "Boba").name).toBe("Boba");
    database.updatePersona({ speakingStyle: "cheerful" });
    database.addMessage({ id: "boba-1", role: "user", content: "Boba chat", createdAt: 2 });
    expect(database.getMessages().map((message) => message.content)).toEqual(["Boba chat"]);
    expect(database.getMemorySummary()).toBe("");
    database.setActivePetId("daily");
    expect(database.getMessages().map((message) => message.content)).toEqual(["Daily chat"]);
    expect(database.getMemorySummary()).toBe("Daily memory");
    database.close();
  });

  it("creates, completes and deletes local todo items", () => {
    const directory = mkdtempSync(join(tmpdir(), "souldesk-db-"));
    directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    const todo = database.createTodo({ title: "  写周报  ", notes: "整理进度" }, "manual", 1_000);
    expect(todo).toMatchObject({ title: "写周报", notes: "整理进度", repeat: "none", source: "manual", completedAt: null });
    expect(database.listTodos()).toHaveLength(1);
    expect(database.updateTodo(todo.id, { completed: true }, 2_000).completedAt).toBe(2_000);
    database.deleteTodo(todo.id);
    expect(database.listTodos()).toEqual([]);
    database.close();
  });

  it("claims one-time reminders once and advances daily reminders", () => {
    const directory = mkdtempSync(join(tmpdir(), "souldesk-db-"));
    directories.push(directory);
    const database = new AppDatabase(join(directory, "app.db"));
    const once = database.createTodo({ title: "喝水", remindAt: 2_000 }, "chat", 1_000);
    const daily = database.createTodo({ title: "站起来活动", remindAt: 2_000, repeat: "daily" }, "manual", 1_000);
    expect(database.claimDueReminders(1_999)).toEqual([]);
    expect(database.claimDueReminders(2_000).map((item) => item.id)).toEqual([once.id, daily.id]);
    expect(database.claimDueReminders(2_000)).toEqual([]);
    const advanced = database.listTodos().find((item) => item.id === daily.id)!;
    expect(advanced.remindAt).toBeGreaterThan(2_000);
    expect(advanced.lastRemindedAt).toBe(2_000);
    database.close();
  });
});
