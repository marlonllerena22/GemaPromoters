import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const backend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = path.resolve(
  process.env.DB_PATH || path.join(backend, "data", "gemapromoters.sqlite"),
);
const directory = path.resolve(
  process.env.FINANCE_BACKUP_DIR || path.join(backend, "data", "backups"),
);
await fs.access(source);
await fs.mkdir(directory, { recursive: true });
const target = path.join(
  directory,
  `gema-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
if (source === target)
  throw new Error("El destino debe ser distinto de la base operativa");
const database = new Database(source, { readonly: true, fileMustExist: true });
try {
  await database.backup(target);
  const copy = new Database(target, { readonly: true, fileMustExist: true });
  try {
    if (copy.pragma("quick_check", { simple: true }) !== "ok")
      throw new Error("No se pudo verificar la copia");
  } finally {
    copy.close();
  }
  console.log(`Copia completa verificada: ${target}`);
  console.log(
    "Conserva FINANCE_DOCUMENT_KEY por separado: es necesaria para recuperar los comprobantes y autenticadores cifrados.",
  );
} finally {
  database.close();
}
