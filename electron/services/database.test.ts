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
});
