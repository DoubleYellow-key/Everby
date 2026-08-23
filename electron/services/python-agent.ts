import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { join } from "node:path";
import { resolveDecision } from "../../src/core/behavior";
import type { AgentDecision } from "../../src/shared/contracts";

type AgentConfig = { baseUrl: string; apiKey: string; model: string; temperature: number };
type WireMessage = { role: "system" | "user" | "assistant"; content: string };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; onDelta?: (delta: string) => void; cleanup?: () => void };
type AgentEvent = { id?: unknown; type?: unknown; result?: unknown; error?: unknown; delta?: unknown; cancelled?: unknown };

export type PythonAgentOptions = {
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
  pythonExecutable?: string;
};

export class PythonAgentClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: Interface | null = null;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly options: PythonAgentOptions) {}

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    const executable = this.options.packaged
      ? join(this.options.resourcesPath, "agent", process.platform === "win32" ? "souldesk-agent.exe" : "souldesk-agent")
      : this.options.pythonExecutable || process.env.SOULDESK_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const args = this.options.packaged ? [] : [join(this.options.appPath, "agent/main.py")];
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => console.error(`[python-agent] ${String(chunk).trim()}`));
    child.once("error", (error) => this.failAll(new Error(`无法启动 Python 智能体：${error.message}`)));
    child.once("exit", (code) => {
      if (this.child === child) this.child = null;
      this.failAll(new Error(`Python 智能体已退出（${code ?? "未知"}）`));
    });
    return child;
  }

  private handleLine(line: string): void {
    let event: AgentEvent;
    try { event = JSON.parse(line) as AgentEvent; } catch { return; }
    if (typeof event.id !== "string") return;
    const pending = this.pending.get(event.id);
    if (!pending) return;
    if (event.type === "delta" && typeof event.delta === "string") { pending.onDelta?.(event.delta); return; }
    this.pending.delete(event.id); pending.cleanup?.();
    if (event.type === "result") pending.resolve(event.result);
    else pending.reject(Object.assign(new Error(typeof event.error === "string" ? event.error : "Python 智能体请求失败"), { name: event.cancelled ? "AbortError" : "Error" }));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) { pending.cleanup?.(); pending.reject(error); }
    this.pending.clear();
  }

  private call(method: string, params: unknown, signal?: AbortSignal, onDelta?: (delta: string) => void): Promise<unknown> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.child?.stdin.write(`${JSON.stringify({ id, method: "cancel" })}\n`);
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id); pending.cleanup?.();
        reject(Object.assign(new Error("已停止生成"), { name: "AbortError" }));
      };
      if (signal?.aborted) { reject(Object.assign(new Error("已停止生成"), { name: "AbortError" })); return; }
      const cleanup = signal ? () => signal.removeEventListener("abort", abort) : undefined;
      this.pending.set(id, { resolve, reject, onDelta, cleanup });
      signal?.addEventListener("abort", abort, { once: true });
      const child = this.ensureStarted();
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (pending) { this.pending.delete(id); pending.cleanup?.(); reject(error); }
      });
    });
  }

  async health(): Promise<{ ok: boolean; runtime: string; version: string }> {
    return await this.call("health", {}) as { ok: boolean; runtime: string; version: string };
  }

  async streamReply(input: AgentConfig & { messages: WireMessage[]; onDelta: (delta: string) => void; signal?: AbortSignal }): Promise<string> {
    const { messages, onDelta, signal, ...config } = input;
    return String(await this.call("chat", { config, messages }, signal, onDelta));
  }

  async planBehavior(input: AgentConfig & { transcript: string; signal?: AbortSignal }): Promise<AgentDecision> {
    const { transcript, signal, ...config } = input;
    return resolveDecision(await this.call("plan", { config, transcript }, signal));
  }

  async summarize(input: AgentConfig & { transcript: string; previous: string; signal?: AbortSignal }): Promise<string> {
    const { transcript, previous, signal, ...config } = input;
    return String(await this.call("summarize", { config, transcript, previous }, signal)).trim().slice(0, 1_000);
  }

  close(): void {
    this.lines?.close(); this.lines = null;
    this.failAll(new Error("Python 智能体已关闭"));
    this.child?.kill(); this.child = null;
  }
}
