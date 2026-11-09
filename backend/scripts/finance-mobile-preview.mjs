import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Database from "better-sqlite3";
import { initFinanceDb, safeMember } from "../src/finance-db.js";
import { seedFinanceDemo } from "../src/finance-demo.js";
import { csvExport, snapshot } from "../src/finance-service.js";

// This separate preview never opens a disk database, enables the operational
// routes, or calls external providers. Only newly generated sample data exists.
export function createMobilePreview() {
  const configuredPassword = process.env.FINANCE_ADMIN_PASSWORD;
  delete process.env.FINANCE_ADMIN_PASSWORD;
  const db = new Database(":memory:");
  try {
    initFinanceDb(db);
    seedFinanceDemo(db);
  } finally {
    if (configuredPassword !== undefined)
      process.env.FINANCE_ADMIN_PASSWORD = configuredPassword;
  }
  db.pragma("query_only=ON");
  const owner = safeMember(
    db.prepare("SELECT * FROM finance_members WHERE username='demo'").get(),
  );
  const visitor = {
    ...owner,
    name: "Vista de demostración",
    username: "vista",
    role: "viewer",
  };
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });
  app.use(express.json({ limit: "4kb" }));
  const data = (filters = {}) => {
    const result = snapshot(db, owner, filters);
    result.capabilities = {
      ai: false,
      webhook: false,
      upload: false,
      email: false,
      demo: true,
      public_preview: true,
    };
    return result;
  };
  const route = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (error) {
      next(error);
    }
  };
  app.get("/api/finance/session", (_req, res) =>
    res.json({ user: visitor, configured: false, demo: true, public_preview: true }),
  );
  app.post("/api/finance/demo", (_req, res) => res.json({ user: visitor }));
  app.post("/api/finance/logout", (_req, res) => res.json({ ok: true }));
  app.get(
    "/api/finance/snapshot",
    route((req, res) => res.json(data(req.query))),
  );
  app.get("/api/finance/orders", (_req, res) => res.json({ orders: [] }));
  app.get(
    "/api/finance/export",
    route((req, res) =>
      res
        .set("Content-Disposition", 'attachment; filename="gema-demostracion.csv"')
        .type("text/csv")
        .send(csvExport(data({ ...req.query, export_all: true }).movements)),
    ),
  );
  app.post(
    "/api/finance/assistant",
    route((req, res) => {
      const report = data(req.body?.filters || {});
      const usd = (value) =>
        new Intl.NumberFormat("es-EC", {
          style: "currency",
          currency: "USD",
        }).format((value || 0) / 100);
      res.json({
        answer:
          "Esta vista usa datos ficticios y no tiene un proveedor de IA conectado. " +
          `Período: ${report.period.from} a ${report.period.to}. ` +
          report.businesses
            .map((b) => `${b.name}: fondos atribuidos ${usd(b.funds_cents)}`)
            .join("; ") +
          `. Hay ${report.summary.pending_count} movimientos por revisar. ` +
          "Los valores de ejemplo no corresponden a tus cuentas reales.",
        movement_ids: [],
        mode: "data",
      });
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(403).json({
      message:
        "Esta demostración es de solo consulta. No permite guardar cambios ni subir datos reales.",
    }),
  );
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const dist = path.join(root, "frontend/dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    db.close();
    throw new Error("Compila primero el frontend de Finanzas");
  }
  app.get("/", (_req, res) => res.redirect("/finanzas/"));
  app.use("/assets", express.static(path.join(dist, "assets"), { dotfiles: "deny" }));
  app.use("/finanzas", express.static(path.join(dist, "finanzas"), { dotfiles: "deny" }));
  app.get(["/finanzas", "/finanzas/*"], (_req, res) =>
    res.sendFile(path.join(dist, "index.html")),
  );
  app.use((_req, res) => res.status(404).send("No encontrado"));
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({
      message: error.status ? error.message : "No se pudo abrir la vista de ejemplo",
    }),
  );
  return { app, db };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, db } = createMobilePreview();
  const port = Number(process.env.FINANCE_MOBILE_PREVIEW_PORT || 4180);
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(`Vista móvil de consulta: http://127.0.0.1:${port}/finanzas/`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => {
      db.close();
      process.exit(0);
    }));
}
