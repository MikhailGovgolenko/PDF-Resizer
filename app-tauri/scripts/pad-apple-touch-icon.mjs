import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SIZE = 180;
const SCALE = 0.68;

const icons = [
  {
    source: "assets/icon-light.png",
    output: "public/apple-touch-icon-light.png",
    background: { r: 0, g: 0, b: 0, alpha: 1 },
    theme: "light",
  },
  {
    source: "assets/icon-dark.png",
    output: "public/apple-touch-icon-dark.png",
    background: { r: 255, g: 255, b: 255, alpha: 1 },
    theme: "dark",
  },
];

for (const icon of icons) {
  const source = path.join(root, icon.source);
  const output = path.join(root, icon.output);

  const resized = await sharp(source)
    .resize(Math.round(SIZE * SCALE), Math.round(SIZE * SCALE), { fit: "inside" })
    .toBuffer();

  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: icon.background,
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toFile(output);

  console.log(`Wrote ${icon.output} (${icon.theme} theme, ${SCALE * 100}% scale)`);
}
