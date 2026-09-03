import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const [inputFile, outputDirectory, frameCountText] = process.argv.slice(2);
const frameCount = Number.parseInt(frameCountText ?? "", 10);

if (!inputFile || !outputDirectory || !Number.isInteger(frameCount) || frameCount < 1) {
  throw new Error("Usage: split-animation-strip <input-file> <output-directory> <frame-count>");
}

const image = sharp(inputFile);
const metadata = await image.metadata();
if (!metadata.width || !metadata.height) throw new Error(`Unable to read image dimensions: ${inputFile}`);

await mkdir(outputDirectory, { recursive: true });
for (let index = 0; index < frameCount; index += 1) {
  const left = Math.round((index * metadata.width) / frameCount);
  const right = Math.round(((index + 1) * metadata.width) / frameCount);
  await sharp(inputFile)
    .extract({ left, top: 0, width: right - left, height: metadata.height })
    .png()
    .toFile(join(outputDirectory, `${index}.png`));
}

console.log(`Split ${inputFile} into ${frameCount} frame(s).`);
