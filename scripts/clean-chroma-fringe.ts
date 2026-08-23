import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";

const [inputDirectory, outputDirectory] = process.argv.slice(2);
if (!inputDirectory || !outputDirectory) throw new Error("Usage: clean-chroma-fringe <input-directory> <output-directory>");

await mkdir(outputDirectory, { recursive: true });
const files = (await readdir(inputDirectory)).filter((file) => file.toLowerCase().endsWith(".png")).sort();

for (const file of files) {
  const input = join(inputDirectory, file);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    if (alpha === 0) continue;
    const cyanSpill = green - red >= 12 && blue - red >= 12 && Math.abs(green - blue) <= 48;
    const magentaSpill = red - green >= 12 && blue - green >= 12 && Math.abs(red - blue) <= 64;
    if (!cyanSpill && !magentaSpill) continue;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  await sharp(data, { raw: info }).png().toFile(join(outputDirectory, basename(file)));
}

console.log(`Cleaned ${files.length} frame(s).`);
