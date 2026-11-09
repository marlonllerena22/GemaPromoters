import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const sources = {
  pichincha:
    "https://www.pichincha.com/themes/custom/pichincha_theme/favicon.ico",
  produbanco: "https://www.produbanco.com.ec/assets/img/favicon.png",
  solidario: "https://www.banco-solidario.com/themes/solidario/favicon.ico",
  pacifico:
    "https://www.bancodelpacifico.com/BancoPacifico/media/layout-images/favicon.png",
  guayaquil: "https://www.bancoguayaquil.com/favicon.svg",
  deuna: "https://www.deuna.ec/assets/images/icon-deuna.png",
  payphone:
    "https://cdn.prod.website-files.com/68013add215ea6b316cbe481/683df565cb376434b82e2aed_webclip.png",
  diners:
    "https://dce-documents.s3.amazonaws.com/s3fs-public/favicon_0.png?VersionId=PEFLxgyXbmLl0ry1XG8HDbzDTkux3.ep",
};
const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/finanzas/banks",
);
await fs.mkdir(directory, { recursive: true });
await Promise.all(
  Object.entries(sources).map(async ([id, url]) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${id}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const extension =
      bytes.subarray(0, 4).toString("hex") === "00000100"
        ? "ico"
        : new URL(url).pathname.split(".").at(-1);
    if (bytes.length > 250_000 || !["ico", "png", "svg"].includes(extension))
      throw new Error(`Formato no válido: ${id}`);
    if (
      extension === "svg" &&
      (!bytes.toString().includes("<svg") ||
        /<script|<foreignObject/i.test(bytes.toString()))
    )
      throw new Error(`SVG no válido: ${id}`);
    if (
      extension === "png" &&
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    )
      throw new Error(`PNG no válido: ${id}`);
    if (
      extension === "ico" &&
      bytes.subarray(0, 4).toString("hex") !== "00000100"
    )
      throw new Error(`ICO no válido: ${id}`);
    await fs.writeFile(path.join(directory, `${id}.${extension}`), bytes);
    console.log(`${id}.${extension}: ${bytes.length} bytes`);
  }),
);
await fs.writeFile(
  path.join(directory, "sources.json"),
  JSON.stringify(
    {
      note: "Iconos de marca obtenidos de las páginas oficiales de cada entidad y sus CDN vinculados. Se sirven localmente, sin consultas a los bancos desde el navegador. Marcas de sus respectivos titulares.",
      sources,
    },
    null,
    2,
  ) + "\n",
);
