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
    appleOutput: "public/apple-touch-icon-light.png",
    faviconOutput: "public/favicon-light.png",
    background: { r: 255, g: 255, b: 255, alpha: 1 },
    theme: "light",
  },
  {
    source: "assets/icon-dark.png",
    appleOutput: "public/apple-touch-icon-dark.png",
    faviconOutput: "public/favicon-dark.png",
    background: { r: 0, g: 0, b: 0, alpha: 1 },
    theme: "dark",
  },
];

for (const icon of icons) {
  const source = path.join(root, icon.source);
  const flattened = sharp(source).flatten({ background: icon.background });

  const resized = await flattened
    .clone()
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
    .toFile(path.join(root, icon.appleOutput));

  await flattened.clone().png().toFile(path.join(root, icon.faviconOutput));

  console.log(`Wrote ${icon.appleOutput} and ${icon.faviconOutput} (${icon.theme} theme)`);
}
