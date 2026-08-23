import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import process from "node:process";

const [mode, expectedArch, expectedPlatform] = process.argv.slice(2);
const python = process.env.SOULDESK_PYTHON || (process.platform === "win32" ? "python" : "python3");

if (expectedArch && process.arch !== expectedArch) {
  console.error(`Python sidecar 不能跨架构构建：当前 ${process.arch}，目标 ${expectedArch}`);
  process.exit(1);
}
if (expectedPlatform && process.platform !== expectedPlatform) {
  console.error(`Python sidecar 不能跨系统构建：当前 ${process.platform}，目标 ${expectedPlatform}`);
  process.exit(1);
}

let args;
if (mode === "test") {
  args = ["-m", "unittest", "discover", "-s", "agent/tests", "-t", "agent", "-v"];
} else if (mode === "build") {
  rmSync("agent-dist", { recursive: true, force: true });
  rmSync(".agent-build", { recursive: true, force: true });
  args = [
    "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--name", "souldesk-agent",
    "--distpath", "agent-dist", "--workpath", ".agent-build/work", "--specpath", ".agent-build", "agent/main.py"
  ];
} else {
  console.error("用法：node scripts/python-agent.mjs test|build [arch] [platform]");
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
