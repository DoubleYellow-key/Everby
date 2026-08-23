import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const frameWidth = 192;
const frameHeight = 208;
const columns = 8;
const rows = 9;
const output = join(process.cwd(), "resources/runtime-pets/placeholder");
const fixtureOutput = join(process.cwd(), "tests/fixtures/motion/assets");

function frame(row: number, column: number): Buffer {
  const bounce = Math.round(Math.sin((column / columns) * Math.PI * 2) * 3);
  const lean = row === 1 ? column * 2 : row === 2 ? -column * 2 : 0;
  const arm = row === 3 ? 44 - column * 4 : row === 4 ? 54 - Math.abs(3 - column) * 5 : 74;
  const glow = row === 5 ? "#e06b5f" : row === 7 ? "#fff4bd" : "#e3b64f";
  return Buffer.from(`<svg width="${frameWidth}" height="${frameHeight}" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(${lean} ${bounce})" stroke="#252927" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="96" cy="188" rx="43" ry="8" fill="#252927" opacity=".16" stroke="none"/>
      <path d="M68 105 Q96 87 124 105 L132 169 Q96 186 60 169Z" fill="#f1c232"/>
      <path d="M72 119 L${arm} 151 M120 119 L${192 - arm} 151" fill="none"/>
      <circle cx="96" cy="78" r="45" fill="#f5d5c7"/>
      <path d="M55 75 Q58 22 96 25 Q138 24 139 78 Q120 53 78 52 Q68 67 55 75Z" fill="#343837"/>
      <circle cx="80" cy="82" r="5" fill="#252927" stroke="none"/>
      <circle cx="112" cy="82" r="5" fill="#252927" stroke="none"/>
      <path d="M88 99 Q96 ${row === 8 ? 94 : 105} 104 99" fill="none" stroke-width="3"/>
      <path d="M83 134 L96 145 L109 134" fill="${glow}"/>
      <circle cx="96" cy="145" r="7" fill="${glow}" stroke="none" opacity="${0.65 + column * 0.04}"/>
    </g>
  </svg>`);
}

function appIcon(size: number, transparent = false): Buffer {
  const background = transparent ? "none" : "#f1c232";
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    ${transparent ? "" : `<rect width="64" height="64" rx="14" fill="${background}"/>`}
    <g fill="none" stroke="${transparent ? "#d49f00" : "#fff"}" stroke-width="4" stroke-linecap="round">
      <circle cx="32" cy="32" r="10"/>
      <path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5"/>
    </g>
  </svg>`);
}

await mkdir(output, { recursive: true });
await mkdir(join(process.cwd(), "build"), { recursive: true });
await mkdir(fixtureOutput, { recursive: true });
const inputs = Array.from({ length: rows * columns }, (_, index) => ({
  input: frame(Math.floor(index / columns), index % columns),
  left: (index % columns) * frameWidth,
  top: Math.floor(index / columns) * frameHeight
}));
await sharp({ create: { width: frameWidth * columns, height: frameHeight * rows, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(inputs).webp({ lossless: true }).toFile(join(output, "spritesheet.webp"));
await Promise.all([0, 1].map((column) => sharp(join(output, "spritesheet.webp"))
  .extract({ left: column * frameWidth, top: 0, width: frameWidth, height: frameHeight })
  .webp({ lossless: true }).toFile(join(fixtureOutput, `${String(column).padStart(3, "0")}.webp`))));
await sharp(appIcon(64, true)).resize(32, 32).png().toFile(join(output, "tray.png"));
await sharp(appIcon(512)).png().toFile(join(process.cwd(), "build/icon.png"));
await writeFile(join(output, "pet.json"), `${JSON.stringify({
  id: "placeholder", displayName: "SoulDesk Placeholder", description: "Generated fallback for character development and format tests.",
  spritesheetPath: "spritesheet.webp", kind: "character", generated: true
}, null, 2)}\n`);
