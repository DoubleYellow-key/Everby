#!/usr/bin/env node
// 扫描帧目录生成 motion.json 草稿：每个含图片的子目录 = 一个动作。
// 只负责路径与结构，intents/loop/节奏等语义字段需要人工（或 agent）按设计填写。
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2).filter((value) => value !== "--");
const positional = [];
const options = {};
for (let index = 0; index < args.length; index += 1) {
  if (args[index].startsWith("--")) {
    options[args[index].slice(2)] = args[index + 1] ?? "";
    index += 1;
  } else positional.push(args[index]);
}

const [framesRoot] = positional;
if (!framesRoot || !options["pack-id"] || !options.pet) {
  console.error("用法: node scaffold-motion.mjs <帧目录> --pack-id <包id> --pet <目标角色id> [--name <显示名>] [--duration <毫秒>] [--action <单动作id>] [--out <motion.json路径>]");
  process.exit(2);
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
for (const [label, value] of [["pack-id", options["pack-id"]], ["pet", options.pet]]) {
  if (!SAFE_ID.test(value)) {
    console.error(`--${label} 不合法:以字母或数字开头,只能包含字母、数字、_、-,最长 80 字符`);
    process.exit(2);
  }
}

const duration = Number.parseInt(options.duration ?? "200", 10);
if (!Number.isInteger(duration) || duration < 20 || duration > 60_000) {
  console.error("--duration 必须是 20-60000 的整数毫秒");
  process.exit(2);
}

const isImage = (name) => /\.(png|webp)$/i.test(name);
// 自然序:让 2.png 排在 10.png 前面
const natural = (left, right) =>
  left.replace(/\d+/g, (match) => match.padStart(8, "0"))
    .localeCompare(right.replace(/\d+/g, (match) => match.padStart(8, "0")));

const entries = await readdir(framesRoot, { withFileTypes: true });
const groups = [];
for (const entry of entries.filter((item) => item.isDirectory()).map((item) => item.name).sort(natural)) {
  const files = (await readdir(join(framesRoot, entry))).filter(isImage).sort(natural);
  if (files.length) groups.push({ id: entry, files: files.map((file) => `${entry}/${file}`) });
}
if (!groups.length) {
  const files = entries.filter((item) => item.isFile() && isImage(item.name)).map((item) => item.name).sort(natural);
  if (files.length) groups.push({ id: options.action || options["pack-id"], files });
}
if (!groups.length) {
  console.error("没有找到任何 .png/.webp 帧图");
  process.exit(1);
}
for (const group of groups) {
  if (!SAFE_ID.test(group.id)) {
    console.error(`动作目录名 "${group.id}" 不是合法动作 ID:以字母或数字开头,只能包含字母、数字、_、-`);
    process.exit(1);
  }
}

const manifest = {
  formatVersion: 1,
  packId: options["pack-id"],
  version: "1.0.0",
  name: options.name || options["pack-id"],
  targetPetId: options.pet,
  canvas: { width: 192, height: 208, anchorX: 96, anchorY: 208 },
  animations: groups.map((group) => ({
    id: group.id,
    label: group.id,
    loop: false,
    weight: 1,
    // 占位值:构建前必须按动作语义从 ACTION_INTENTS 词表改写
    intents: ["idle"],
    frames: group.files.map((src) => ({ src, durationMs: duration })),
  })),
};

const output = options.out || join(framesRoot, "motion.json");
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  motionJson: output,
  actions: groups.map((group) => ({ id: group.id, frames: group.files.length })),
  warnings: ["intents 目前是占位值 idle,构建前请按动作语义从 idle/greet/happy/encourage/think/work/wait/celebrate/tired/confused 中改写"],
}, null, 2));
