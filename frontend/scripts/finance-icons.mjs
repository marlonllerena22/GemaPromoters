import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "finanzas",
);
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="105" fill="#254938"/><g transform="translate(120 144) rotate(-12 136 112)" fill="#c2d0ac"><path d="M100 20h160l-32 36H68z"/><path d="M54 92h210l-32 36H22z" fill="#91ad7d"/><path d="M28 164h160l-32 36H-4z" fill="#d8dabc"/></g></svg>',
);
for (const size of [192, 512])
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(path.join(directory, `icon-${size}.png`));
