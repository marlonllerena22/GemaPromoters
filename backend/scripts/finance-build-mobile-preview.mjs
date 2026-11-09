import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMobilePreview } from "./finance-mobile-preview.mjs";
import { safeMember } from "../src/finance-db.js";
import { snapshot, csvExport } from "../src/finance-service.js";

const destination = path.resolve(process.argv[2] || "");
const manifest = JSON.parse(
  await fs.readFile(path.join(destination, ".openai/hosting.json"), "utf8"),
);
if (!manifest.project_id || manifest.static?.directory !== "dist")
  throw new Error(
    "La vista requiere un proyecto estático registrado con directorio dist",
  );
const sourceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const { db } = createMobilePreview();
const owner = safeMember(
  db.prepare("SELECT * FROM finance_members WHERE username='demo'").get(),
);
const user = { ...owner, name: "Propietario", role: "owner" };
const collector = {
  ...owner,
  name: "Normita",
  role: "collector",
  business_ids: ["producalza"],
  unit_ids: ["producalza-fabrica"],
};
const previewCapabilities = {
  demo: true,
  public_preview: true,
  persona_preview: true,
  ai: false,
  upload: false,
  email: false,
  webhook: false,
};
const snapshots = {};
const exports = {};
for (const business_id of ["all", ...owner.business_ids]) {
  const result = snapshot(db, owner, { business_id });
  result.capabilities = previewCapabilities;
  snapshots[business_id] = result;
  exports[business_id] = csvExport(result.movements);
}
const collector_snapshot = snapshot(db, collector, {});
collector_snapshot.capabilities = previewCapabilities;
db.close();
const dist = path.join(destination, "dist");
const relativeDestination = path.relative(
  path.dirname(sourceRoot),
  destination,
);
if (
  !relativeDestination ||
  relativeDestination.startsWith("..") ||
  path.isAbsolute(relativeDestination) ||
  path.dirname(path.resolve(dist)) !== destination
)
  throw new Error(
    "La salida debe ser dist de un proyecto hermano dentro del espacio de trabajo",
  );
// The resolved target is the registered preview's build output, never source or
// a database. Rebuild it to remove stale hashed assets from earlier versions.
console.log(`Reconstruyendo salida estática verificada: ${path.resolve(dist)}`);
await fs.rm(dist, { recursive: true, force: true });
await fs.cp(path.join(sourceRoot, "frontend/dist"), dist, { recursive: true });
await fs.cp(
  path.join(sourceRoot, "docs/finance/screenshots"),
  path.join(dist, "review"),
  { recursive: true },
);
const html = (await fs.readFile(path.join(dist, "index.html"), "utf8")).replace(
  "<head>",
  '<head><script src="/preview-api.js"></script>',
);
await fs.writeFile(path.join(dist, "index.html"), html);
await fs.writeFile(path.join(dist, "finanzas/index.html"), html);
await fs.writeFile(
  path.join(dist, "demo-data.json"),
  JSON.stringify({ user, collector, collector_snapshot, snapshots, exports }),
);
await fs.copyFile(
  path.join(sourceRoot, "shared/finance-quick.mjs"),
  path.join(dist, "quick-intent.mjs"),
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
    ].map((page) => `/finanzas/${page} /index.html 200`),
    "",
  ].join("\n"),
);
await fs.writeFile(
  path.join(dist, "_headers"),
  "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n",
);
await fs.writeFile(
  path.join(dist, "preview-api.js"),
  `
// Read-only display adapter. No operational backend or credentials are present.
(() => {
  if (location.pathname === '/') {
    location.replace('/finanzas/');
    return;
  }
  const nativeFetch = window.fetch.bind(window);
  let persona='owner';
  const fixtures = nativeFetch('/demo-data.json', {cache:'no-store'}).then(r => {
    if (!r.ok) throw new Error('No se pudo cargar la demostración');
    return r.json();
  });
  const json = (data, status=200) => new Response(JSON.stringify(data), {
    status, headers: {'Content-Type':'application/json', 'Cache-Control':'no-store'}
  });
  window.fetch = async (input, options={}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/'))
      return nativeFetch(input, options);
    const data = await fixtures;
    const method = String(options.method || input.method || 'GET').toUpperCase();
    const base = data.snapshots.all;
    const user=persona==='collector' ? data.collector : data.user;
    if (url.pathname === '/api/finance/preview/persona' && method === 'POST') {
      let body; try { body=JSON.parse(options.body || '{}'); } catch { return json({message:'Solicitud inválida'},400); }
      if(!['owner','collector'].includes(body.role)) return json({message:'Vista no disponible'},400);
      persona=body.role;
      return json({user:persona==='collector' ? data.collector : data.user});
    }
    if (url.pathname === '/api/finance/session' && method === 'GET')
      return json({user, configured:false, demo:true, public_preview:true, period:base.period});
    if (url.pathname === '/api/finance/demo' && method === 'POST')
      return json({user});
    if (url.pathname === '/api/finance/logout' && method === 'POST') return json({ok:true});
    const business = url.searchParams.get('business_id') || 'all';
    if (url.pathname === '/api/finance/snapshot' && method === 'GET')
      return persona==='collector' ? json(data.collector_snapshot) : data.snapshots[business] ? json(data.snapshots[business]) : json({message:'Negocio no disponible'},404);
    if (url.pathname === '/api/finance/quick/register' && method === 'POST') {
      let body; try {body=JSON.parse(options.body||'{}');}catch{return json({message:'Solicitud inválida'},400);}
      const {interpretQuickEntry}=await import('/quick-intent.mjs');
      const source=persona==='collector' ? data.collector_snapshot : base;
      const result=interpretQuickEntry(body.text,{...user,units:source.units,accounts:source.accounts,day:base.period.today,overrides:body.overrides,request:body.request});
      if(!result.ready) return json({message:result.error||'Completa los datos del resumen'},400);
      return json({preview:true,movement:{...result.draft,id:Date.now(),created_by:user.username,status:user.role==='collector'||result.is_request||result.draft.kind==='income'?'pending':'reported'}},201);
    }
    if (url.pathname === '/api/finance/orders' && method === 'GET') return json({orders:[]});
    if (url.pathname === '/api/finance/export' && method === 'GET')
      return persona==='collector' ? json({message:'La exportación no está incluida en este acceso'},403) : new Response(data.exports[business] || data.exports.all, {headers:{'Content-Type':'text/csv'}});
    if (url.pathname === '/api/finance/assistant' && method === 'POST') {
      let body;
      try { body=JSON.parse(options.body || '{}'); } catch { return json({message:'Solicitud inválida'},400); }
      if(persona==='collector') return json({message:'Utiliza tus accesos de cobros y solicitudes'},403);
      const report=data.snapshots[body.filters?.business_id] || base;
      const usd=n=>new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'}).format((n||0)/100);
      return json({mode:'data', movement_ids:[], answer:
        'Esta vista usa datos ficticios. La IA conversacional todavía no está conectada.\\n\\n' +
        'Período: ' + report.period.from + ' a ' + report.period.to + '.\\n' +
        report.businesses.map(b=>b.name+': fondos atribuidos '+usd(b.funds_cents)).join('\\n') +
        '\\n\\nHay '+report.summary.pending_count+' movimientos por revisar. Ningún valor corresponde a tus cuentas reales.'});
    }
    return json({message:'Esta demostración es de solo consulta. No permite guardar cambios ni subir datos reales.'},403);
  };
})();
`,
);
await fs.writeFile(
  path.join(destination, "package.json"),
  JSON.stringify(
    { name: "gema-finanzas-mobile-preview", version: "1.0.0", private: true },
    null,
    2,
  ) + "\n",
);
await fs.writeFile(
  path.join(destination, "README.md"),
  "# Gema Finanzas · Vista móvil\n\nVista privada y estática de revisión. Reutiliza la interfaz compilada del proyecto GemaPromoters con ejemplos generados en una base SQLite en memoria. No contiene bases operativas, credenciales ni conexiones bancarias. Permite navegar, filtrar negocios, exportar CSV ficticio y alternar Mi panel/Colaborador. El registro rápido es una simulación explícita sin persistencia ni pagos. El período es fijo y las cargas de documentos reales están bloqueadas. Las capturas de revisión están en dist/review.\n",
);
console.log(
  JSON.stringify({
    destination,
    businesses: Object.keys(snapshots),
    period: snapshots.all.period,
  }),
);
