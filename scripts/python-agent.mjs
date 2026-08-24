import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import process from "node:process";

const [mode, expectedArch, expectedPlatform] = process.argv.slice(2);
const python = process.env.EVERBY_PYTHON || process.env.SOULDESK_PYTHON || (process.platform === "win32" ? "python" : "python3");

if (expectedArch && process.arch !== expectedArch) {
  console.error(`Python sidecar 不能跨架构构建：当前 ${process.arch}，目标 ${expectedArch}`);
  process.exit(1);
}
if (expectedPlatform && process.platform !== expectedPlatform) {
  console.error(`Python sidecar 不能跨系统构建：当前 ${process.platform}，目标 ${expectedPlatform}`);
  process.exit(1);
}

let args;
const schema = spawnSync(python, ["agent/scripts/export_schemas.py"], {
  stdio: "inherit", env: { ...process.env, PYTHONPATH: "agent", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
});
if (schema.status !== 0) process.exit(schema.status ?? 1);

if (mode === "schema") {
  process.exit(0);
} else if (mode === "test") {
  args = ["-m", "unittest", "discover", "-s", "agent/tests", "-t", "agent", "-v"];
} else if (mode === "build") {
  rmSync("agent-dist", { recursive: true, force: true });
  rmSync(".agent-build", { recursive: true, force: true });
  args = ["-m", "PyInstaller", "--noconfirm", "--clean", "--distpath", "agent-dist", "--workpath", ".agent-build/work", "agent/everby-agent.spec"];
} else {
  console.error("用法：node scripts/python-agent.mjs schema|test|build [arch] [platform]");
  process.exit(1);
}

const result = spawnSync(python, args, {
  stdio: "inherit",
  env: { ...process.env, PYTHONUNBUFFERED: "1", PYINSTALLER_CONFIG_DIR: ".agent-build/config" }
});
if (result.error) {
  console.error(`无法启动 Python：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
