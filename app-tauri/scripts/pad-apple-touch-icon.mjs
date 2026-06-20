import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SIZE = 180;
const SCALE = 0.68;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const icons = [
  {
    source: "assets/icon-light.png",
    appleOutput: "public/apple-touch-icon-light.png",
    faviconOutput: "public/favicon-light.png",
    theme: "light",
  },
  {
    source: "assets/icon-dark.png",
    appleOutput: "public/apple-touch-icon-dark.png",
    faviconOutput: "public/favicon-dark.png",
    theme: "dark",
  },
];

async function buildPaddedIcon(source, output, size = SIZE) {
  const inner = Math.round(size * SCALE);

  const resized = await sharp(source)
    .resize(inner, inner, { fit: "inside" })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toFile(path.join(root, output));
}

for (const icon of icons) {
  const source = path.join(root, icon.source);
  await buildPaddedIcon(source, icon.appleOutput);
  await sharp(source).png().toFile(path.join(root, icon.faviconOutput));
  console.log(`Wrote ${icon.appleOutput} and ${icon.faviconOutput} (${icon.theme}, transparent)`);
}
