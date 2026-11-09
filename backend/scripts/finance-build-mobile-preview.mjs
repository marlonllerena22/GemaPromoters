import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMobilePreview } from "./finance-mobile-preview.mjs";
import { safeMember } from "../src/finance-db.js";
import { snapshot, csvExport } from "../src/finance-service.js";
import { seedWorkflowDemo } from "../src/finance-workflow-demo.js";
import { attachWorkflow, workflowSource } from "../src/finance-workflow.js";
import { decryptDocument } from "../src/finance-ai.js";

const destination = path.resolve(process.argv[2] || "");
const manifest = JSON.parse(
  await fs.readFile(path.join(destination, ".openai/hosting.json"), "utf8")
);
if (!manifest.project_id || manifest.static?.directory !== "dist")
  throw new Error(
    "La vista requiere un proyecto estático registrado con directorio dist"
  );
const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
// This generator only creates an in-memory synthetic fixture. Its disposable
// encryption key must never depend on, or expose, the operational document key.
process.env.FINANCE_DOCUMENT_KEY = crypto.randomBytes(32).toString("hex");
const { db } = createMobilePreview();
db.pragma("query_only=OFF");
const personas = seedWorkflowDemo(db);
db.pragma("query_only=ON");
const owner = safeMember(
  db.prepare("SELECT * FROM finance_members WHERE username='demo'").get()
);
const user = personas.owner,
  collector = personas.norma;
const previewCapabilities = {
  demo: true,
  public_preview: true,
  persona_preview: true,
  ai: false,
  upload: false,
  email: false,
  webhook: false,
  push: false,
};
const preview_personas = Object.entries(personas).map(([id, p]) => ({
  id,
  label:
    id === "owner" ? "Mi panel" : id === "german" ? "Papá · Germán" : p.name,
}));
const persona_snapshots = {};
for (const [key, p] of Object.entries(personas)) {
  persona_snapshots[key] = {};
  for (const business_id of ["all", ...p.business_ids]) {
    const result = attachWorkflow(db, p, snapshot(db, p, { business_id }));
    result.capabilities = previewCapabilities;
    result.preview_personas = preview_personas;
    persona_snapshots[key][business_id] = result;
  }
}
const snapshots = {};
const exports = {};
for (const business_id of ["all", ...owner.business_ids]) {
  const result = persona_snapshots.owner[business_id];
  result.capabilities = previewCapabilities;
  snapshots[business_id] = result;
  exports[business_id] = csvExport(result.movements);
}
const collector_snapshot = persona_snapshots.norma.all;
collector_snapshot.capabilities = previewCapabilities;
const workflow_source = workflowSource(db);
workflow_source.contacts = db
  .prepare("SELECT * FROM finance_payees")
  .all()
  .map((r) => ({
    ...JSON.parse(decryptDocument(r.encrypted).toString()),
    id: r.id,
    business_id: r.business_id,
    space_id: r.space_id,
    created_by: r.created_by,
  }));
workflow_source.beneficiaries = Object.fromEntries(
  db
    .prepare("SELECT * FROM finance_request_payees")
    .all()
    .map((r) => [
      r.request_id,
      JSON.parse(decryptDocument(r.encrypted).toString()),
    ])
);
workflow_source.notes = db
  .prepare(
    "SELECT n.*,m.name actor_name FROM finance_space_notes n LEFT JOIN finance_members m ON m.username=n.actor ORDER BY n.id"
  )
  .all();
const members = Object.values(personas).map((p) => ({
  ...p,
  space_ids: workflow_source.members
    .filter((m) => m.member_id === p.id)
    .map((m) => m.space_id),
  space_role:
    workflow_source.members.find((m) => m.member_id === p.id)?.role ||
    "requester",
}));
db.close();
const dist = path.join(destination, "dist");
const relativeDestination = path.relative(
  path.dirname(sourceRoot),
  destination
);
if (
  !relativeDestination ||
  relativeDestination.startsWith("..") ||
  path.isAbsolute(relativeDestination) ||
  path.dirname(path.resolve(dist)) !== destination
)
  throw new Error(
    "La salida debe ser dist de un proyecto hermano dentro del espacio de trabajo"
  );
// The resolved target is the registered preview's build output, never source or
// a database. Rebuild it to remove stale hashed assets from earlier versions.
console.log(`Reconstruyendo salida estática verificada: ${path.resolve(dist)}`);
await fs.rm(dist, { recursive: true, force: true });
await fs.cp(path.join(sourceRoot, "frontend/dist"), dist, { recursive: true });
await fs.cp(
  path.join(sourceRoot, "docs/finance/screenshots"),
  path.join(dist, "review"),
  { recursive: true }
);
const html = (await fs.readFile(path.join(dist, "index.html"), "utf8")).replace(
  "<head>",
  '<head><script src="/preview-api.js"></script>'
);
await fs.writeFile(path.join(dist, "index.html"), html);
await fs.writeFile(path.join(dist, "finanzas/index.html"), html);
await fs.writeFile(
  path.join(dist, "demo-data.json"),
  JSON.stringify({
    user,
    collector,
    collector_snapshot,
    snapshots,
    exports,
    personas,
    persona_snapshots,
    workflow_source,
    members,
  })
);
await fs.copyFile(
  path.join(sourceRoot, "shared/finance-quick.mjs"),
  path.join(dist, "quick-intent.mjs")
);
await fs.copyFile(
  path.join(sourceRoot, "shared/finance-workflow.mjs"),
  path.join(dist, "workflow.mjs")
);
await fs.copyFile(
  path.join(sourceRoot, "shared/finance-payees.mjs"),
  path.join(dist, "payees.mjs")
);
await fs.writeFile(
  path.join(dist, "_redirects"),
  [
    "/finanzas /index.html 200",
    "/finanzas/ /index.html 200",
    ...[
      "inicio",
      "movimientos",
      "cuentas",
      "pendientes",
      "ventas",
      "gastos",
      "cierres",
      "reportes",
      "asistente",
      "conexiones",
      "equipo",
      "configuracion",
      "espacios",
      "pagos",
    ].map((page) => `/finanzas/${page} /index.html 200`),
    "",
  ].join("\n")
);
await fs.writeFile(
  path.join(dist, "_headers"),
  "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n"
);
await fs.copyFile(
  path.join(sourceRoot, "backend/scripts/finance-preview-adapter.js"),
  path.join(dist, "preview-api.js")
);
await fs.writeFile(
  path.join(destination, "package.json"),
  JSON.stringify(
    { name: "gema-finanzas-mobile-preview", version: "1.0.0", private: true },
    null,
    2
  ) + "\n"
);
await fs.writeFile(
  path.join(destination, "README.md"),
  "# Gema Finanzas · Vista móvil\n\nVista privada y estática de revisión. Reutiliza la interfaz compilada de GemaPromoters con ejemplos generados en una base SQLite en memoria. No contiene bases operativas, credenciales ni conexiones bancarias. Permite alternar seis perfiles ficticios: propietario, Germán, Norma, Morelia, Ana y José. Se pueden probar espacios, solicitudes, pagos parciales y comprobantes ficticios; estos cambios viven únicamente en la memoria de la pestaña y se reinician al recargar. El período es fijo y las cargas de documentos reales están bloqueadas. No ejecuta transferencias, no envía WhatsApp ni notificaciones externas. Las capturas de revisión están en dist/review.\n"
);
console.log(
  JSON.stringify({
    destination,
    businesses: Object.keys(snapshots),
    period: snapshots.all.period,
  })
);
