import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "finanzas",
  "fonts",
);
await fs.mkdir(directory, { recursive: true });
for (const [family, file] of [
  ["DM Sans", "dm-sans"],
  ["Manrope", "manrope"],
]) {
  const response = await fetch(
    `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}:wght@400..800&display=swap`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      },
    },
  );
  if (!response.ok) throw new Error(`Font stylesheet failed: ${family}`);
  const stylesheet = await response.text();
  const latin = stylesheet.split("/* latin */").at(-1);
  const url = latin.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
  if (!url) throw new Error(`Latin font missing: ${family}`);
  const font = await fetch(url);
  if (!font.ok) throw new Error(`Font download failed: ${family}`);
  await fs.writeFile(
    path.join(directory, `${file}-latin.woff2`),
    Buffer.from(await font.arrayBuffer()),
  );
  const license = await fetch(
    `https://raw.githubusercontent.com/google/fonts/main/ofl/${file.replaceAll("-", "")}/OFL.txt`,
  );
  if (!license.ok) throw new Error(`Font license missing: ${family}`);
  await fs.writeFile(
    path.join(directory, `${file}-OFL.txt`),
    (await license.text()).replace(/[\t ]+$/gm, ""),
  );
  console.log(`Self-hosted font and license: ${family}`);
}
