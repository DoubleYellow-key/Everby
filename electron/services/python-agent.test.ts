import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PythonAgentClient } from "./python-agent";

function testDatabase(name: string): string { return join(process.cwd(), "agent", "tests", `.${name}.db`); }
async function cleanup(path: string): Promise<void> {
  const checkpoint = path.replace(/\.db$/, "-checkpoints.db");
  await Promise.all([path, checkpoint].flatMap((database) => ["", "-wal", "-shm"].map((suffix) => rm(database + suffix, { force: true }))));
}

describe("PythonAgentClient protocol v2", () => {
  it("starts the Python runtime and reports protocol v2 health", async () => {
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    try { expect(await agent.health()).toMatchObject({ ok: true, runtime: "python", version: "0.1.0", protocolVersion: 2 }); }
    finally { agent.close(); await new Promise((resolve) => setTimeout(resolve, 500)); }
  }, 20_000);

  it("configures persistent agent state and preserves split surrogate text", async () => {
    const path = testDatabase("protocol-v2");
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    try {
      await agent.health();
      await agent.configure({ databasePath: path, petId: "daily", petName: "Daily", petDescription: "", timezone: "Asia/Shanghai", chat: { baseUrl: "http://127.0.0.1:1/v1", apiKey: "", model: "fake", temperature: 0.4 }, embedding: { baseUrl: "http://127.0.0.1:1/v1", apiKey: "", model: "fake" } });
      const title = "Unicode \ud83d\udcaa reminder";
      const todo = await agent.createTodo("daily", { title });
      expect(todo.title).toBe("Unicode 💪 reminder");
      expect((await agent.snapshot("daily")).todos[0]?.title).toBe("Unicode 💪 reminder");
    } finally { agent.close(); await new Promise((resolve) => setTimeout(resolve, 500)); await cleanup(path); }
  }, 20_000);

  it("rejects a chat request that was already cancelled", async () => {
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    const controller = new AbortController(); controller.abort();
    try { await expect(agent.streamReply({ petId: "daily", content: "hello", onDelta: () => undefined, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" }); }
    finally { agent.close(); }
  });

  it("runs the direct-chat LangGraph fallback against a local compatible model", async () => {
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: { role: "assistant", content: "你好，" }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: { content: "慢慢来。" }, finish_reason: null }] })}\n\n`);
        response.end(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
    const path = testDatabase("langgraph-chat"); const port = (server.address() as AddressInfo).port;
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    try {
      await agent.health();
      const configured = await agent.configure({ databasePath: path, petId: "daily", petName: "Daily", petDescription: "", timezone: "Asia/Shanghai", chat: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "test", model: "fake", temperature: 0.4 }, embedding: { baseUrl: "", apiKey: "", model: "" } });
      expect(configured.capabilities.streaming).toBe(true);
      const deltas: string[] = [];
      const reply = await agent.streamReply({ petId: "daily", content: "你好", onDelta: (delta) => deltas.push(delta) });
      expect(reply.content).toBe("你好，慢慢来。");
      expect(deltas).toEqual(["你好，", "慢慢来。"]);
      expect((await agent.snapshot("daily")).messages.map((message) => message.content)).toEqual(["你好", "你好，慢慢来。"]);
    } finally {
      agent.close(); await new Promise((resolve) => setTimeout(resolve, 500)); await cleanup(path);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);

  it("keeps streamed deltas isolated between concurrent chat requests", async () => {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []; request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const prefix = body.includes("甲问题") ? "甲" : body.includes("乙问题") ? "乙" : "OK";
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ id: `chatcmpl-${prefix}`, object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: { role: "assistant", content: `${prefix}1` }, finish_reason: null }] })}\n\n`);
        setTimeout(() => response.end(`data: ${JSON.stringify({ id: `chatcmpl-${prefix}`, object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: { content: `${prefix}2` }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: `chatcmpl-${prefix}`, object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`), 10);
      });
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
    const path = testDatabase("concurrent-streams"); const port = (server.address() as AddressInfo).port;
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    try {
      await agent.health();
      await agent.configure({ databasePath: path, petId: "daily", petName: "Daily", petDescription: "", timezone: "Asia/Shanghai", chat: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "test", model: "fake", temperature: 0.4 }, embedding: { baseUrl: "", apiKey: "", model: "" } });
      const left: string[] = []; const right: string[] = [];
      await Promise.all([
        agent.streamReply({ petId: "left", content: "甲问题", onDelta: (delta) => left.push(delta) }),
        agent.streamReply({ petId: "right", content: "乙问题", onDelta: (delta) => right.push(delta) }),
      ]);
      expect(left).toEqual(["甲1", "甲2"]);
      expect(right).toEqual(["乙1", "乙2"]);
    } finally {
      agent.close(); await new Promise((resolve) => setTimeout(resolve, 500)); await cleanup(path);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);

  it("executes text-encoded create_todo calls from compatible models", async () => {
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        const content = '<|FunctionCallBegin|>[{"name":"create_todo","parameters":{"content":"这周完成小程序后端迁移至云环境"}}]<|FunctionCallEnd|> '
          + '<|FunctionCallBegin|>[{"name":"create_todo","parameters":{"content":"完成小程序新需求"}}]<|FunctionCallEnd|> 好哒，已经添加。';
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ id: "chatcmpl-text-tools", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: { role: "assistant", content: " " }, finish_reason: null }] })}\n\n`);
        response.end(`data: ${JSON.stringify({ id: "chatcmpl-text-tools", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "chatcmpl-text-tools", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
    const path = testDatabase("text-tool-calls"); const port = (server.address() as AddressInfo).port;
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    try {
      await agent.health();
      await agent.configure({ databasePath: path, petId: "daily", petName: "Daily", petDescription: "", timezone: "Asia/Shanghai", chat: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "test", model: "fake", temperature: 0.4 }, embedding: { baseUrl: "", apiKey: "", model: "" } });
      const deltas: string[] = [];
      const reply = await agent.streamReply({ petId: "daily", content: "新加俩个计划，这周完成小程序后端迁移至云环境，完成小程序新需求。", onDelta: (delta) => deltas.push(delta) });
      expect(reply.content).not.toContain("FunctionCall");
      expect(reply.content).toContain("已添加 2 个计划");
      expect(deltas.join("")).toBe(reply.content);
      const todos = (await agent.snapshot("daily")).todos;
      expect(todos.map((todo) => todo.title)).toEqual([
        "完成小程序新需求", "这周完成小程序后端迁移至云环境"
      ]);
      expect(todos.every((todo) => typeof todo.dueAt === "number")).toBe(true);
      expect(todos[0]?.dueAt).toBe(todos[1]?.dueAt);
    } finally {
      agent.close(); await new Promise((resolve) => setTimeout(resolve, 500)); await cleanup(path);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);

  it("runs the create_agent tool loop and persists a todo", async () => {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []; request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages?: Array<{ role?: string }>; tool_choice?: unknown; tools?: unknown[] };
        const hasToolResult = payload.messages?.some((message) => message.role === "tool");
        const name = payload.tool_choice ? "capability_probe" : "create_todo";
        const content = hasToolResult ? "已记下喝水。" : payload.tools?.length ? null : "OK";
        const delta = content === null
          ? { role: "assistant", tool_calls: [{ index: 0, id: `call-${name}`, type: "function", function: { name, arguments: name === "create_todo" ? '{"title":"喝水"}' : "{}" } }] }
          : { role: "assistant", content };
        const finish = content === null ? "tool_calls" : "stop";
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`data: ${JSON.stringify({ id: "chatcmpl-tools", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "chatcmpl-tools", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
      });
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
    const path = testDatabase("langgraph-tools"); const port = (server.address() as AddressInfo).port;
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    const toolEvents: string[] = []; const off = agent.onEvent((event) => { if (event.type.startsWith("tool_")) toolEvents.push(event.type); });
    try {
      await agent.health();
      const configured = await agent.configure({ databasePath: path, petId: "daily", petName: "Daily", petDescription: "", timezone: "Asia/Shanghai", chat: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "test", model: "fake", temperature: 0.2 }, embedding: { baseUrl: "", apiKey: "", model: "" } });
      expect(configured.capabilities.toolCalling).toBe(true);
      const reply = await agent.streamReply({ petId: "daily", content: "提醒我喝水", onDelta: () => undefined });
      expect(reply.content).toBe("已记下喝水。");
      expect((await agent.snapshot("daily")).todos).toMatchObject([{ title: "喝水", source: "chat" }]);
      expect(toolEvents).toEqual(["tool_started", "tool_finished"]);
    } finally {
      off(); agent.close(); await new Promise((resolve) => setTimeout(resolve, 500)); await cleanup(path);
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);
});
