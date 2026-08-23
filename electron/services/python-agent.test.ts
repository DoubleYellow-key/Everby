import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { PythonAgentClient } from "./python-agent";

describe("PythonAgentClient", () => {
  it("starts the Python runtime and completes a health request", async () => {
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    try { expect(await agent.health()).toMatchObject({ ok: true, runtime: "python", version: "0.1.0" }); }
    finally { agent.close(); }
  });

  it("streams through a local compatible model and validates decisions in Python", async () => {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { stream?: boolean };
        response.writeHead(200, { "content-type": payload.stream ? "text/event-stream" : "application/json" });
        if (payload.stream) {
          response.write('data: {"choices":[{"delta":{"content":"Python"}}]}\n\n');
          response.end('data: {"choices":[{"delta":{"content":" agent"}}]}\n\ndata: [DONE]\n\n');
        } else response.end(JSON.stringify({ choices: [{ message: { content: '{"actionIntent":"unsafe-action"}' } }] }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
    const port = (server.address() as AddressInfo).port;
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    const config = { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "test", model: "fake", temperature: 0.4 };
    const deltas: string[] = [];
    try {
      expect(await agent.streamReply({ ...config, messages: [{ role: "user", content: "hello" }], onDelta: (delta) => deltas.push(delta) })).toBe("Python agent");
      expect(deltas).toEqual(["Python", " agent"]);
      expect((await agent.planBehavior({ ...config, transcript: "hello" })).actionIntent).toBe("idle");
    } finally {
      agent.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("rejects a request that was already cancelled", async () => {
    const agent = new PythonAgentClient({ packaged: false, appPath: process.cwd(), resourcesPath: "" });
    const controller = new AbortController(); controller.abort();
    try {
      await expect(agent.streamReply({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "test", model: "fake", temperature: 0.4, messages: [], onDelta: () => undefined, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    } finally { agent.close(); }
  });
});
