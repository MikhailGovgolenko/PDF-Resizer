import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SIZE = 180;
const SCALE = 0.68;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function buildPaddedIcon(source, output, size, background) {
  const inner = Math.round(size * SCALE);

  const resized = await sharp(source)
    .flatten({ background })
    .resize(inner, inner, { fit: "inside" })
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toFile(path.join(root, output));
}

await buildPaddedIcon("assets/icon-light.png", "public/apple-touch-icon.png", SIZE, WHITE);

await sharp(path.join(root, "assets/icon-light.png"))
  .png()
  .toFile(path.join(root, "public/favicon-light.png"));

await sharp(path.join(root, "assets/icon-dark.png"))
  .png()
  .toFile(path.join(root, "public/favicon-dark.png"));

console.log("Wrote public/apple-touch-icon.png (opaque, light theme)");
console.log("Wrote public/favicon-light.png and public/favicon-dark.png");
