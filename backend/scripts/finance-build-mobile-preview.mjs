import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMobilePreview } from "./finance-mobile-preview.mjs";
import { safeMember } from "../src/finance-db.js";
import { snapshot, csvExport } from "../src/finance-service.js";

const destination = path.resolve(process.argv[2] || "");
const manifest = JSON.parse(await fs.readFile(path.join(destination, ".openai/hosting.json"), "utf8"));
if (!manifest.project_id || manifest.static?.directory !== "dist")
  throw new Error("La vista requiere un proyecto estático registrado con directorio dist");
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { db } = createMobilePreview();
const owner = safeMember(db.prepare("SELECT * FROM finance_members WHERE username='demo'").get());
const user = { ...owner, name: "Vista de demostración", username: "vista", role: "viewer" };
const snapshots = {};
const exports = {};
for (const business_id of ["all", ...owner.business_ids]) {
  const result = snapshot(db, owner, { business_id });
  result.capabilities = { demo: true, public_preview: true, ai: false, upload: false, email: false, webhook: false };
  snapshots[business_id] = result;
  exports[business_id] = csvExport(result.movements);
}
db.close();
const dist = path.join(destination, "dist");
await fs.cp(path.join(sourceRoot, "frontend/dist"), dist, { recursive: true });
const html = (await fs.readFile(path.join(dist, "index.html"), "utf8"))
  .replace("<head>", '<head><script src="/preview-api.js"></script>');
await fs.writeFile(path.join(dist, "index.html"), html);
await fs.writeFile(path.join(dist, "finanzas/index.html"), html);
await fs.writeFile(path.join(dist, "demo-data.json"), JSON.stringify({ user, snapshots, exports }));
await fs.writeFile(path.join(dist, "_redirects"), [
  "/finanzas /index.html 200",
  "/finanzas/ /index.html 200",
  ...["inicio", "movimientos", "cuentas", "pendientes", "ventas", "gastos", "cierres", "reportes", "asistente", "conexiones", "equipo", "configuracion"]
    .map(page => `/finanzas/${page} /index.html 200`),
  "",
].join("\n"));
await fs.writeFile(path.join(dist, "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Cache-Control: no-store\n");
await fs.writeFile(path.join(dist, "preview-api.js"), `
// Read-only display adapter. No operational backend or credentials are present.
(() => {
  if (location.pathname === '/') {
    location.replace('/finanzas/');
    return;
  }
  const nativeFetch = window.fetch.bind(window);
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
    if (url.pathname === '/api/finance/session' && method === 'GET')
      return json({user:data.user, configured:false, demo:true, public_preview:true, period:base.period});
    if (url.pathname === '/api/finance/demo' && method === 'POST')
      return json({user:data.user});
    if (url.pathname === '/api/finance/logout' && method === 'POST') return json({ok:true});
    const business = url.searchParams.get('business_id') || 'all';
    if (url.pathname === '/api/finance/snapshot' && method === 'GET')
      return data.snapshots[business] ? json(data.snapshots[business]) : json({message:'Negocio no disponible'},404);
    if (url.pathname === '/api/finance/orders' && method === 'GET') return json({orders:[]});
    if (url.pathname === '/api/finance/export' && method === 'GET')
      return new Response(data.exports[business] || data.exports.all, {headers:{'Content-Type':'text/csv'}});
    if (url.pathname === '/api/finance/assistant' && method === 'POST') {
      let body;
      try { body=JSON.parse(options.body || '{}'); } catch { return json({message:'Solicitud inválida'},400); }
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
`);
await fs.writeFile(path.join(destination, "package.json"), JSON.stringify({ name:"gema-finanzas-mobile-preview", version:"1.0.0", private:true }, null, 2)+"\n");
await fs.writeFile(path.join(destination, "README.md"), "# Gema Finanzas · Vista móvil\n\nVista privada y estática de revisión. Reutiliza la interfaz compilada del proyecto GemaPromoters con ejemplos generados en una base SQLite en memoria. No contiene bases operativas, credenciales ni conexiones bancarias. Solo permite navegación, filtros por negocio, consulta de ejemplos y exportación de CSV ficticio. El período de los ejemplos es fijo. Las operaciones de escritura están bloqueadas.\n");
console.log(JSON.stringify({ destination, businesses:Object.keys(snapshots), period:snapshots.all.period }));
