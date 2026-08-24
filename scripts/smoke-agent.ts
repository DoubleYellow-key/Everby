import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PythonAgentClient } from "../electron/services/python-agent";

const packagedResources = process.env.SOULDESK_PACKAGED_RESOURCES;
const databasePath = join(process.cwd(), "agent", "tests", ".smoke-agent.db");
const agent = new PythonAgentClient({ packaged: Boolean(packagedResources), appPath: process.cwd(), resourcesPath: packagedResources || "" });
const chat = { baseUrl: process.env.SOULDESK_MODEL_URL || "http://127.0.0.1:11434/v1", apiKey: process.env.SOULDESK_MODEL_KEY || "ollama", model: process.env.SOULDESK_MODEL || "llama3.2:latest", temperature: 0.3 };
const embedding = { baseUrl: process.env.SOULDESK_EMBEDDING_URL || chat.baseUrl, apiKey: process.env.SOULDESK_EMBEDDING_KEY || chat.apiKey, model: process.env.SOULDESK_EMBEDDING_MODEL || "nomic-embed-text" };

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
