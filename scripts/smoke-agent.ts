import { PythonAgentClient } from "../electron/services/python-agent";

const packagedResources = process.env.SOULDESK_PACKAGED_RESOURCES;
const agent = new PythonAgentClient({ packaged: Boolean(packagedResources), appPath: process.cwd(), resourcesPath: packagedResources || "" });
const config = {
  baseUrl: process.env.SOULDESK_MODEL_URL || "http://127.0.0.1:11434/v1",
  apiKey: process.env.SOULDESK_MODEL_KEY || "ollama",
  model: process.env.SOULDESK_MODEL || "llama3.2:latest",
  temperature: 0.3
};

try {
  const health = await agent.health();
  process.stdout.write(`health: ${JSON.stringify(health)}\nreply: `);
  const reply = await agent.streamReply({
    ...config,
    messages: [
      { role: "system", content: "你是桌面陪伴智能体。回答简短、自然。" },
      { role: "user", content: "用一句中文问候正在认真工作的用户。" }
    ],
    onDelta: (delta) => process.stdout.write(delta)
  });
  process.stdout.write(`\nreply-length: ${reply.length}\n`);
  const decision = await agent.planBehavior({ ...config, transcript: `用户正在工作。智能体刚刚回复：${reply}` });
  process.stdout.write(`decision: ${JSON.stringify(decision)}\n`);
} finally {
  agent.close();
}
