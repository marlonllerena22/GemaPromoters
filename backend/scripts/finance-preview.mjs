import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Database from "better-sqlite3";
import { initFinanceDb } from "../src/finance-db.js";
import { registerFinanceRoutes } from "../src/finance-routes.js";
import { seedFinanceDemo } from "../src/finance-demo.js";

if (process.env.NODE_ENV === "production")
  throw new Error("La vista de demostración no puede ejecutarse en producción");
process.env.FINANCE_DEMO = "1";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const dataDir = path.join(root, "backend", "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "finance-demo.sqlite"));
db.pragma("journal_mode=WAL");
db.pragma("foreign_keys=ON");
initFinanceDb(db);
seedFinanceDemo(db);
const app = express();
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, b) => {
      req.rawBody = b;
    },
  }),
);
registerFinanceRoutes(app, db);
const dist = path.join(root, "frontend", "dist");
app.use(express.static(dist));
app.get(["/finanzas", "/finanzas/*"], (_req, res) =>
  res.sendFile(path.join(dist, "index.html")),
);
app.get("/", (_req, res) => res.redirect("/finanzas"));
const port = Number(process.env.FINANCE_PREVIEW_PORT || 4178);
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    `Gema Finanzas · demostración local · http://127.0.0.1:${port}/finanzas`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
