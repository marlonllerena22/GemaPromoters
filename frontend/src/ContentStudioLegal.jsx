import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Mail, ShieldCheck } from 'lucide-react';
import './content-studio-legal.css';

const contactEmail = 'estudioscreativosec@gmail.com';

const privacySections = [
  ['Información que tratamos', 'Guardamos los datos necesarios para crear y mantener tu cuenta, administrar tu plan, procesar solicitudes de pago, conservar tus marcas y preferencias, y mostrar el historial de creaciones. Cuando conectas Meta, recibimos las páginas de Facebook que administras, la cuenta profesional de Instagram vinculada y los permisos que aprobaste. Cuando conectas TikTok, recibimos el identificador y nombre de la cuenta que autorizas, junto con el token necesario para publicar únicamente cuando nos lo pides.'],
  ['Cómo usamos la información', 'Utilizamos estos datos para prestar Estudios Creativos, generar contenido solicitado, mantener tu sesión, brindar soporte, prevenir uso indebido y, solo cuando tú pulsas Publicar, enviar la imagen y el copy a las cuentas sociales seleccionadas.'],
  ['Imágenes e inteligencia artificial', 'Las fotos, instrucciones y referencias que entregas se procesan para producir la creación solicitada. Pueden intervenir proveedores de infraestructura y servicios de inteligencia artificial bajo sus propias medidas de seguridad. No vendemos tus fotografías ni tus datos personales.'],
  ['Conexiones sociales', 'Los tokens de Meta y TikTok se cifran en el servidor. Puedes desconectarlos desde Configuración. Al hacerlo revocamos la conexión almacenada; también atendemos las solicitudes de eliminación enviadas por Meta.'],
  ['Conservación y seguridad', 'Conservamos la información mientras tu cuenta esté activa o mientras sea necesaria para prestar el servicio, resolver pagos y cumplir obligaciones aplicables. Aplicamos controles de acceso, enlaces temporales y cifrado para reducir el acceso no autorizado.'],
  ['Tus opciones', 'Puedes solicitar acceso, corrección o eliminación de tus datos y desconectar tus redes cuando quieras. Escríbenos desde el correo asociado a tu cuenta para que podamos verificar la solicitud.']
];

const termsSections = [
  ['El servicio', 'Estudios Creativos permite generar piezas visuales y textos comerciales con inteligencia artificial. Cada plan define una cantidad de creaciones y un periodo de vigencia.'],
  ['Cuenta y acceso', 'Debes proporcionar información correcta y proteger el acceso a tu correo o cuenta de Google. Eres responsable de la actividad realizada desde tu sesión.'],
  ['Pagos y activación', 'Mientras el cobro sea por transferencia, el plan se activa después de verificar el comprobante. Los créditos y beneficios corresponden al plan confirmado y a su vigencia indicada.'],
  ['Contenido y derechos', 'Debes contar con autorización para usar las fotografías, productos, marcas, logos y demás materiales que subas. No puedes usar el servicio para contenido ilegal, engañoso o que vulnere derechos de terceros.'],
  ['Resultados generados', 'La inteligencia artificial puede producir variaciones. Debes revisar textos, detalles del producto, precios y datos de contacto antes de descargar o publicar una creación.'],
  ['Publicación en redes', 'La publicación ocurre únicamente cuando eliges las cuentas, revisas el copy y pulsas Publicar. Meta y TikTok pueden rechazar contenido o limitar permisos según sus propias políticas. Las imágenes creadas con IA se identifican como tales para TikTok cuando la plataforma lo requiere.'],
  ['Soporte y cambios', `Puedes escribir a ${contactEmail}. Podemos actualizar estas condiciones para reflejar mejoras del servicio o requisitos legales, mostrando la versión vigente en esta página.`]
];

function LegalHeader() {
  return <header className="cs-legal-header"><a href="/" aria-label="Volver"><ArrowLeft /></a><img src="/content-studio/brand/mascota-toque.webp" alt=""/><img className="wordmark" src="/content-studio/brand/estudios-creativos-wordmark.webp" alt="Estudios Creativos"/></header>;
}

function LegalDocument({ type }) {
  const privacy = type === 'privacy';
  const sections = privacy ? privacySections : termsSections;
  return <main className="cs-legal"><LegalHeader/><article><span className="cs-legal-kicker"><ShieldCheck /> Información legal</span><h1>{privacy ? 'Política de privacidad' : 'Condiciones del servicio'}</h1><p className="cs-legal-updated">Última actualización: 11 de septiembre de 2026</p><p className="lead">{privacy ? 'Tu información hace posible que el estudio funcione. La tratamos con cuidado y te explicamos de forma clara para qué la utilizamos.' : 'Estas condiciones explican cómo usar Estudios Creativos y qué puedes esperar del servicio.'}</p>{sections.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}<div className="cs-legal-contact"><Mail/><div><strong>¿Necesitas ayuda?</strong><a href={`mailto:${contactEmail}`}>{contactEmail}</a><span>WhatsApp: 098 376 3419</span></div></div></article></main>;
}

export function ContentStudioDataDeletion() {
  const code = new URLSearchParams(window.location.search).get('codigo') || '';
  const [status, setStatus] = useState(code ? 'loading' : 'instructions');
  useEffect(() => {
    if (!code) return;
    fetch(`/api/content-studio/social/meta/data-deletion/${encodeURIComponent(code)}`)
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then(() => setStatus('completed'))
      .catch(() => setStatus('missing'));
  }, [code]);
  return <main className="cs-legal"><LegalHeader/><article><span className="cs-legal-kicker"><ShieldCheck /> Control de tus datos</span><h1>Eliminación de datos</h1>{status === 'loading' && <p className="lead">Verificando tu solicitud…</p>}{status === 'completed' && <div className="cs-deletion-success"><CheckCircle2/><div><strong>Solicitud completada</strong><p>Revocamos las conexiones de Meta asociadas. Código de confirmación: <code>{code}</code></p></div></div>}{status === 'missing' && <p className="lead">No encontramos ese código. Puedes enviarnos un correo para revisar la solicitud.</p>}{status === 'instructions' && <><p className="lead">Puedes eliminar la conexión con Facebook, Instagram o TikTok desde Configuración → Redes sociales → Desconectar.</p><section><h2>Solicitar eliminación completa</h2><p>Escribe desde el correo de tu cuenta a <a href={`mailto:${contactEmail}?subject=Eliminar datos de Estudios Creativos`}>{contactEmail}</a> con el asunto “Eliminar datos de Estudios Creativos”. Confirmaremos tu identidad y atenderemos la solicitud.</p></section><section><h2>Si eliminaste la app desde Meta</h2><p>Meta nos enviará automáticamente una solicitud firmada. Revocaremos los tokens almacenados y te mostrará un código para consultar su estado en esta misma página.</p></section></>}<div className="cs-legal-contact"><Mail/><div><strong>Contacto</strong><a href={`mailto:${contactEmail}`}>{contactEmail}</a><span>WhatsApp: 098 376 3419</span></div></div></article></main>;
}

export function ContentStudioPrivacy() { return <LegalDocument type="privacy"/>; }
export function ContentStudioTerms() { return <LegalDocument type="terms"/>; }
