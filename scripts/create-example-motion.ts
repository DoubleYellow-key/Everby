import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const frameWidth = 192;
const frameHeight = 208;
const source = join(process.cwd(), "resources/runtime-pets/daily/spritesheet.webp");
const root = join(process.cwd(), "examples/motions/daily-routines/assets");
const sequences = {
  cheer: [[3, 0], [3, 1], [3, 2], [3, 3], [4, 0], [4, 1], [4, 2], [4, 3], [4, 4]],
  focus: [[7, 0], [7, 1], [7, 0], [7, 1], [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5]],
  reset: [[6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 4], [6, 3], [6, 5]]
} as const;

for (const [name, frames] of Object.entries(sequences)) {
  const output = join(root, name);
  await mkdir(output, { recursive: true });
  await Promise.all(frames.map(([row, column], index) => sharp(source)
    .extract({ left: column * frameWidth, top: row * frameHeight, width: frameWidth, height: frameHeight })
    .webp({ lossless: true })
    .toFile(join(output, `${String(index).padStart(3, "0")}.webp`))));
}

console.log("已生成 Daily 示例动作帧");
