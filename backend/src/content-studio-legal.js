const CONTACT_EMAIL = 'promoters.ecu@gmail.com';
const CONTACT_PHONE = '098 376 3419';

const privacySections = [
  ['Información que tratamos', 'Guardamos los datos necesarios para crear y mantener tu cuenta, administrar tu plan, procesar solicitudes de pago, conservar tus marcas y preferencias, y mostrar el historial de creaciones. Cuando conectas Meta, recibimos las páginas de Facebook que administras, la cuenta profesional de Instagram vinculada y los permisos que aprobaste.'],
  ['Cómo usamos la información', 'Utilizamos estos datos para prestar Estudios Creativos, generar el contenido solicitado, mantener tu sesión, brindar soporte, prevenir usos indebidos y, solo cuando pulsas Publicar, enviar la imagen y el texto a las cuentas sociales seleccionadas.'],
  ['Imágenes e inteligencia artificial', 'Las fotografías, instrucciones y referencias que entregas se procesan para producir la creación solicitada. Pueden intervenir proveedores de infraestructura y servicios de inteligencia artificial bajo sus propias medidas de seguridad. No vendemos tus fotografías ni tus datos personales.'],
  ['Conexiones con Meta', 'Los tokens de acceso se cifran en el servidor. Puedes desconectar Meta desde Configuración. Al hacerlo revocamos la conexión almacenada; también atendemos las solicitudes de eliminación enviadas por Meta.'],
  ['Conservación y seguridad', 'Conservamos la información mientras tu cuenta esté activa o mientras sea necesaria para prestar el servicio, resolver pagos y cumplir obligaciones aplicables. Aplicamos controles de acceso, enlaces temporales y cifrado para reducir el acceso no autorizado.'],
  ['Tus opciones', `Puedes solicitar acceso, corrección o eliminación de tus datos y desconectar tus redes cuando quieras. Escríbenos a ${CONTACT_EMAIL} desde el correo asociado a tu cuenta para verificar la solicitud.`]
];

const termsSections = [
  ['El servicio', 'Estudios Creativos permite generar piezas visuales y textos comerciales con inteligencia artificial. Cada plan define una cantidad de creaciones y un periodo de vigencia.'],
  ['Cuenta y acceso', 'Debes proporcionar información correcta y proteger el acceso a tu correo o cuenta de Google. Eres responsable de la actividad realizada desde tu sesión.'],
  ['Pagos y activación', 'Mientras el cobro sea por transferencia, el plan se activa después de verificar el comprobante. Los créditos y beneficios corresponden al plan confirmado y a su vigencia indicada.'],
  ['Contenido y derechos', 'Debes contar con autorización para usar las fotografías, productos, marcas, logos y demás materiales que subas. No puedes usar el servicio para contenido ilegal, engañoso o que vulnere derechos de terceros.'],
  ['Resultados generados', 'La inteligencia artificial puede producir variaciones. Debes revisar textos, detalles del producto, precios y datos de contacto antes de descargar o publicar una creación.'],
  ['Publicación en redes', 'La publicación ocurre únicamente cuando eliges las cuentas, revisas el texto y pulsas Publicar. Meta puede rechazar contenido o limitar permisos según sus propias políticas.'],
  ['Soporte y cambios', `Puedes escribir a ${CONTACT_EMAIL}. Podemos actualizar estas condiciones para reflejar mejoras del servicio o requisitos legales, mostrando la versión vigente en esta página.`]
];

const deletionSections = [
  ['Desde Estudios Creativos', 'Entra a Configuración, abre Redes sociales y pulsa Desconectar. Eliminaremos la conexión almacenada con Facebook e Instagram.'],
  ['Solicitar eliminación completa', `Escribe desde el correo asociado a tu cuenta a ${CONTACT_EMAIL} con el asunto “Eliminar datos de Estudios Creativos”. Confirmaremos tu identidad y atenderemos la solicitud.`],
  ['Desde Meta', 'Si eliminas Estudios Creativos desde la configuración de Facebook, Meta nos enviará una solicitud firmada. Revocaremos los tokens almacenados y registraremos la eliminación.']
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function legalHtml({ title, description, sections, confirmationCode = '' }) {
  const canonicalPath = title === 'Política de privacidad' ? '/privacidad' : title === 'Condiciones del servicio' ? '/terminos' : '/eliminar-datos';
  const sectionHtml = sections.map(([heading, body]) => `<section><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(body)}</p></section>`).join('');
  const confirmationHtml = confirmationCode
    ? `<div class="notice"><strong>Solicitud registrada</strong><p>Código de confirmación: <code>${escapeHtml(confirmationCode)}</code></p></div>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Estudios Creativos</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#111211">
  <link rel="canonical" href="https://estudioscreativos.com${canonicalPath}">
  <style>
    :root{color-scheme:light;--ink:#191915;--muted:#6d6b64;--gold:#d99b36;--paper:#fbfaf7;--line:#e8e3d9}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 5%,#f5e5c9 0,transparent 28rem),var(--paper);color:var(--ink);font:16px/1.7 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{height:76px;display:flex;align-items:center;gap:14px;padding:0 max(24px,calc((100vw - 880px)/2));border-bottom:1px solid var(--line);background:rgba(251,250,247,.88);backdrop-filter:blur(18px)}header a{color:var(--ink);text-decoration:none;font-weight:700}header img{height:44px;width:auto;object-fit:contain}.brand{font-weight:800;letter-spacing:-.02em}.brand span{color:var(--gold)}main{width:min(880px,calc(100% - 32px));margin:54px auto 80px;padding:clamp(28px,5vw,58px);border:1px solid var(--line);border-radius:28px;background:rgba(255,255,255,.9);box-shadow:0 28px 80px rgba(60,47,25,.08)}.kicker{color:#95621b;text-transform:uppercase;letter-spacing:.15em;font-size:.75rem;font-weight:800}h1{font-family:Georgia,"Times New Roman",serif;font-size:clamp(2.35rem,7vw,4.8rem);line-height:.98;letter-spacing:-.045em;margin:.3em 0 .35em}.updated{color:var(--muted);font-size:.9rem}.lead{font-size:clamp(1.05rem,2.4vw,1.3rem);color:#45433d;margin:1.7rem 0 2.5rem}section{padding:1.5rem 0;border-top:1px solid var(--line)}h2{font-size:1.12rem;margin:0 0 .35rem}p{margin:0;color:#55524b}.contact,.notice{margin-top:2rem;padding:20px 22px;border-radius:18px;background:#171814;color:white}.contact a{color:#f6ba59}.contact p,.notice p{color:#d8d6cf}.notice{background:#f3e2c2;color:#513612}.notice p{color:#6b4b1e}.notice code{word-break:break-all}footer{text-align:center;color:var(--muted);padding:0 16px 40px;font-size:.88rem}@media(max-width:560px){header{height:68px;padding:0 18px}header img{height:38px}main{margin:24px auto 48px;border-radius:22px}h1{font-size:2.45rem}}
  </style>
</head>
<body>
  <header><a href="/" aria-label="Volver a Estudios Creativos">←</a><img src="/content-studio/brand/mascota-toque.webp" alt=""><div class="brand">Estudios <span>Creativos</span></div></header>
  <main>
    <div class="kicker">Información legal</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="updated">Última actualización: 11 de septiembre de 2026</p>
    <p class="lead">${escapeHtml(description)}</p>
    ${confirmationHtml}
    ${sectionHtml}
    <div class="contact"><strong>Contacto</strong><p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a><br>WhatsApp: ${CONTACT_PHONE}</p></div>
  </main>
  <footer>© 2026 Estudios Creativos. Todos los derechos reservados.</footer>
</body>
</html>`;
}

export function registerContentStudioLegalRoutes(app) {
  app.get('/privacidad', (_req, res) => res.type('html').send(legalHtml({
    title: 'Política de privacidad',
    description: 'Explicamos de forma clara qué información utiliza Estudios Creativos, para qué la utilizamos y cómo puedes controlar tus datos.',
    sections: privacySections
  })));

  app.get('/terminos', (_req, res) => res.type('html').send(legalHtml({
    title: 'Condiciones del servicio',
    description: 'Estas condiciones explican cómo usar Estudios Creativos y qué puedes esperar del servicio.',
    sections: termsSections
  })));

  app.get('/eliminar-datos', (req, res) => res.type('html').send(legalHtml({
    title: 'Eliminación de datos',
    description: 'Puedes desconectar tus redes sociales o solicitar la eliminación de la información asociada a tu cuenta.',
    sections: deletionSections,
    confirmationCode: req.query.codigo
  })));
}
