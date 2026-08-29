import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { join } from "node:path";
import { z } from "zod";
import type { AgentCapabilities, AgentSnapshot, CreateTodoInput, MemoryItem, PersonaProfile, TodoItem, UpdateTodoInput } from "../../src/shared/contracts";

const errorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).strict();
const resultSchema = z.object({ protocolVersion: z.literal(2), id: z.string(), result: z.unknown().optional(), error: errorSchema.optional() }).strict();
const eventSchema = z.object({ protocolVersion: z.literal(2), type: z.string(), requestId: z.string().optional(), data: z.record(z.string(), z.unknown()) }).strict();

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
  onEvent?: (event: PythonAgentEvent) => void;
};
export type PythonAgentEvent = z.infer<typeof eventSchema>;
export type RuntimeConfiguration = {
  databasePath: string; petId: string; petName: string; petDescription: string; timezone: string;
  chat: { baseUrl: string; apiKey: string; model: string; temperature: number };
  embedding: { baseUrl: string; apiKey: string; model: string };
};
export type PythonAgentOptions = { packaged: boolean; appPath: string; resourcesPath: string; pythonExecutable?: string };

export class PythonAgentClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(event: PythonAgentEvent) => void>();

  constructor(private readonly options: PythonAgentOptions) {}

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    const executable = this.options.packaged
      ? join(this.options.resourcesPath, "agent", process.platform === "win32" ? "everby-agent.exe" : "everby-agent")
      : this.options.pythonExecutable || process.env.EVERBY_PYTHON || process.env.SOULDESK_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const args = this.options.packaged ? [] : [join(this.options.appPath, "agent/main.py")];
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: {
      ...process.env, PYTHONUNBUFFERED: "1", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8",
      LANGSMITH_TRACING: "false", LANGGRAPH_STRICT_MSGPACK: "true"
    } });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => console.error(`[python-agent] ${String(chunk).trim()}`));
    child.once("error", (error) => this.failAll(new Error(`无法启动 Python 智能体：${error.message}`)));
    child.once("exit", (code) => { if (this.child === child) this.child = null; this.failAll(new Error(`Python 智能体已退出（${code ?? "未知"}）`)); });
    return child;
  }

  private handleLine(line: string): void {
    let value: unknown;
    try { value = JSON.parse(line); } catch { return; }
    const event = eventSchema.safeParse(value);
    if (event.success) {
      if (event.data.requestId) this.pending.get(event.data.requestId)?.onEvent?.(event.data);
      for (const listener of this.listeners) listener(event.data);
      return;
    }
    const result = resultSchema.safeParse(value);
    if (!result.success) return;
    const pending = this.pending.get(result.data.id);
    if (!pending) return;
    this.pending.delete(result.data.id); pending.cleanup?.();
    if (result.data.error) {
      const error = Object.assign(new Error(result.data.error.message), { code: result.data.error.code, retryable: result.data.error.retryable });
      if (result.data.error.code === "cancelled") error.name = "AbortError";
      pending.reject(error);
    } else pending.resolve(result.data.result);
  }

  private failAll(error: Error): void { for (const pending of this.pending.values()) { pending.cleanup?.(); pending.reject(error); } this.pending.clear(); }

  call(method: string, params: unknown = {}, signal?: AbortSignal,
       onEvent?: (event: PythonAgentEvent) => void): Promise<unknown> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => { void this.call("agent.cancel", { requestId: id }).catch(() => undefined); const pending = this.pending.get(id); if (!pending) return; this.pending.delete(id); pending.cleanup?.(); reject(Object.assign(new Error("已停止生成"), { name: "AbortError" })); };
      if (signal?.aborted) { reject(Object.assign(new Error("已停止生成"), { name: "AbortError" })); return; }
      const cleanup = signal ? () => signal.removeEventListener("abort", abort) : undefined;
      this.pending.set(id, { resolve, reject, cleanup, onEvent }); signal?.addEventListener("abort", abort, { once: true });
      this.ensureStarted().stdin.write(`${JSON.stringify({ id, protocolVersion: 2, method, params })}\n`, (error) => {
        if (!error) return; const pending = this.pending.get(id); if (pending) { this.pending.delete(id); pending.cleanup?.(); reject(error); }
      });
    });
  }

  onEvent(listener: (event: PythonAgentEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async health(): Promise<{ ok: boolean; runtime: string; version: string; protocolVersion: 2 }> { return await this.call("runtime.health") as any; }
  async configure(value: RuntimeConfiguration): Promise<{ capabilities: AgentCapabilities; status: string }> {
    return await this.call("runtime.configure", { ...value, databasePath: value.databasePath.replaceAll("\\", "/") }) as any;
  }
  async probe(): Promise<AgentCapabilities> { return await this.call("model.probe") as AgentCapabilities; }
  async snapshot(petId: string): Promise<AgentSnapshot> { return await this.call("agent.snapshot", { petId }) as AgentSnapshot; }
  async streamReply(input: { petId: string; content: string; onDelta: (delta: string) => void; signal?: AbortSignal }): Promise<{ content: string; actionIntent: string }> {
    return await this.call("agent.chat", { petId: input.petId, content: input.content }, input.signal, (event) => {
      if (event.type === "assistant_delta" && typeof event.data.delta === "string") input.onDelta(event.data.delta);
    }) as any;
  }
  async clearConversation(petId: string): Promise<void> { await this.call("conversation.clear", { petId }); }
  async updatePersona(petId: string, patch: Partial<PersonaProfile>): Promise<PersonaProfile> { return await this.call("persona.update", { petId, patch }) as PersonaProfile; }
  async createTodo(petId: string, input: CreateTodoInput): Promise<TodoItem> { return await this.call("todo.create", { petId, input }) as TodoItem; }
  async updateTodo(petId: string, id: string, patch: UpdateTodoInput): Promise<TodoItem> { return await this.call("todo.update", { petId, id, patch }) as TodoItem; }
  async deleteTodo(petId: string, id: string): Promise<void> { await this.call("todo.delete", { petId, id }); }
  async deleteMemory(petId: string, id: string): Promise<void> { await this.call("memory.delete", { petId, id }); }
  async clearMemories(petId: string): Promise<void> { await this.call("memory.clear", { petId }); }
  close(): void { this.lines?.close(); this.lines = null; this.failAll(new Error("Python 智能体已关闭")); this.child?.kill(); this.child = null; }
}
