import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PythonAgentClient } from "../electron/services/python-agent";

const env = (name: string, legacy: string): string | undefined => process.env[name] || process.env[legacy];
const packagedResources = env("EVERBY_PACKAGED_RESOURCES", "SOULDESK_PACKAGED_RESOURCES");
const databasePath = join(process.cwd(), "agent", "tests", ".smoke-agent.db");
const agent = new PythonAgentClient({ packaged: Boolean(packagedResources), appPath: process.cwd(), resourcesPath: packagedResources || "" });
const chat = { baseUrl: env("EVERBY_MODEL_URL", "SOULDESK_MODEL_URL") || "http://127.0.0.1:11434/v1", apiKey: env("EVERBY_MODEL_KEY", "SOULDESK_MODEL_KEY") || "ollama", model: env("EVERBY_MODEL", "SOULDESK_MODEL") || "llama3.2:latest", temperature: 0.3 };
const embedding = { baseUrl: env("EVERBY_EMBEDDING_URL", "SOULDESK_EMBEDDING_URL") || chat.baseUrl, apiKey: env("EVERBY_EMBEDDING_KEY", "SOULDESK_EMBEDDING_KEY") || chat.apiKey, model: env("EVERBY_EMBEDDING_MODEL", "SOULDESK_EMBEDDING_MODEL") || "nomic-embed-text" };

try {
  const health = await agent.health();
  await agent.configure({ databasePath, petId: "daily", petName: "Daily", petDescription: "", timezone: "Asia/Shanghai", chat, embedding });
  const capabilities = await agent.probe();
  process.stdout.write(`health: ${JSON.stringify(health)}\ncapabilities: ${JSON.stringify(capabilities)}\nreply: `);
  const reply = await agent.streamReply({ petId: "daily", content: "用一句中文问候正在认真工作的用户。", onDelta: (delta) => process.stdout.write(delta) });
  process.stdout.write(`\nreply-length: ${reply.content.length}\naction: ${reply.actionIntent}\n`);
} finally {
  agent.close();
  await Promise.all(["", "-wal", "-shm"].map((suffix) => rm(databasePath + suffix, { force: true })));
}
