import React, { useEffect, useRef, useState } from 'react';
import { Mail, MessageCircle, RefreshCw, Send, Upload, X } from 'lucide-react';

const storageKey = 'protickets_promotion_draft';
const campaignKey = 'protickets_last_promotion_campaign';

function initialDraft() {
  try {
    return { event_id: '', subject: '', message: '', link_url: '', whatsapp: '',
      ...JSON.parse(localStorage.getItem(storageKey) || '{}') };
  } catch {
    return { event_id: '', subject: '', message: '', link_url: '', whatsapp: '' };
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data_url: String(reader.result || ''), type: file.type });
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

export default function ProTicketsPromotions({ api, events }) {
  const [draft, setDraft] = useState(initialDraft);
  const [recipients, setRecipients] = useState([]);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [campaign, setCampaign] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const requestKey = useRef(globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-promotions');

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(draft)); }, [draft]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const result = await api('/admin/promotions/recipients?event_id=' + encodeURIComponent(draft.event_id), { admin: true });
      setRecipients(result.recipients || []);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [draft.event_id]);

  useEffect(() => {
    const previous = localStorage.getItem(campaignKey);
    if (!previous) return;
    api('/admin/promotions/email/' + previous, { admin: true })
      .then(setCampaign).catch(() => localStorage.removeItem(campaignKey));
  }, []);

  useEffect(() => {
    if (!campaign || !['queued', 'running'].includes(campaign.status)) return undefined;
    const timer = window.setInterval(() => {
      api('/admin/promotions/email/' + campaign.id, { admin: true })
        .then((result) => { setCampaign(result); if (result.status === 'completed') void refresh(); })
        .catch((reason) => setError(reason.message));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [campaign?.id, campaign?.status, draft.event_id]);

  function update(name, value) { setDraft((current) => ({ ...current, [name]: value })); }

  async function chooseFile(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(selected.type)
      || selected.size > 5 * 1024 * 1024) {
      setError('Elige una imagen PNG, JPG o WEBP, o un PDF de hasta 5 MB.');
      event.target.value = '';
      return;
    }
    try { setFile(await readFile(selected)); setError(''); }
    catch (reason) { setError(reason.message); }
  }

  async function sendEmail(event) {
    event.preventDefault();
    if (!recipients.length || !draft.subject.trim() || !draft.message.trim()) return;
    if (!window.confirm('¿Enviar este correo promocional a los ' + recipients.length
      + ' clientes elegibles? Se revisará cada cliente otra vez antes de enviar.')) return;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/admin/promotions/email', {
        admin: true, method: 'POST',
        body: JSON.stringify({
          event_id: draft.event_id || null, subject: draft.subject, message: draft.message,
          link_url: draft.link_url, file, request_key: requestKey.current
        })
      });
      setCampaign(result);
      localStorage.setItem(campaignKey, String(result.id));
      requestKey.current = globalThis.crypto?.randomUUID?.() || String(Date.now()) + '-promotions';
      setNotice('Campaña iniciada. Puedes seguir el avance aquí.');
    } catch (reason) { setError(reason.message); }
    finally { setSending(false); }
  }

  async function openWhatsApp(recipient) {
    if (!draft.whatsapp.trim()) return setError('Escribe primero el mensaje de WhatsApp.');
    const tab = window.open('about:blank', '_blank');
    try {
      const result = await api('/admin/promotions/recipients/' + recipient.id
        + '/whatsapp?event_id=' + encodeURIComponent(draft.event_id), { admin: true });
      const firstName = result.name.trim().split(/\s+/)[0];
      const message = draft.whatsapp.replaceAll('{nombre}', firstName);
      const url = 'https://wa.me/' + result.phone + '?text=' + encodeURIComponent(message);
      if (tab) { tab.opener = null; tab.location.replace(url); }
      else window.location.assign(url);
      setError('');
    } catch (reason) {
      tab?.close();
      setError(reason.message);
      void refresh();
    }
  }

  return <section className="pta-promotions">
    <div className="pta-section pta-promo-intro">
      <div className="pta-section-title"><div><p>RECUPERAR VENTAS</p><h2>Promociones</h2></div>
        <button className="pta-secondary" type="button" disabled={loading} onClick={refresh}><RefreshCw /> Actualizar clientes</button></div>
      <p>Clientes con pedidos rechazados o expirados que todavía no compraron. Una persona aparece una sola vez. Los pagos en curso y las compras confirmadas quedan fuera.</p>
      <label>Evento de los pedidos
        <select value={draft.event_id} onChange={(event) => update('event_id', event.target.value)}>
          <option value="">Todos los eventos</option>
          {events.map((event) => <option value={event.id} key={event.id}>{event.title}</option>)}
        </select>
      </label>
      <strong>{loading ? 'Buscando clientes…' : recipients.length + ' clientes elegibles'}</strong>
      {error && <div className="pt-alert error" role="alert">{error}</div>}
      {notice && <div className="pt-alert info" role="status">{notice}</div>}
    </div>

    <div className="pta-promo-grid">
      <form className="pta-section pta-promo-form" onSubmit={sendEmail}>
        <div className="pta-section-title"><div><p>CORREO PARA TODOS</p><h2><Mail /> Campaña por correo</h2></div></div>
        <p>Escribe una vez. El correo se envía individualmente a cada cliente que siga sin una compra confirmada.</p>
        <label>Asunto<input required maxLength={140} value={draft.subject} onChange={(event) => update('subject', event.target.value)} placeholder="Una oportunidad para disfrutar el evento" /></label>
        <label>Mensaje<textarea required rows={7} maxLength={5000} value={draft.message} onChange={(event) => update('message', event.target.value)} placeholder="Cuéntales la promoción y hasta cuándo estará disponible…" /></label>
        <label>Enlace de la promoción (opcional)<input type="url" value={draft.link_url} onChange={(event) => update('link_url', event.target.value)} placeholder="https://…" /></label>
        <label className="pta-promo-upload"><Upload /> {file ? file.name : 'Agregar imagen o PDF (máximo 5 MB)'}
          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={chooseFile} /></label>
        {file && <div className="pta-promo-file">
          {file.type.startsWith('image/') && <img src={file.data_url} alt="Vista previa de promoción" />}
          <button type="button" onClick={() => setFile(null)}><X /> Quitar archivo</button>
        </div>}
        <button className="pta-primary" type="submit" disabled={sending || loading || ['queued', 'running'].includes(campaign?.status) || !recipients.length || !draft.subject.trim() || !draft.message.trim()}>
          <Send /> {sending ? 'Preparando campaña…' : 'Enviar correo a ' + recipients.length + ' clientes'}
        </button>
        {campaign && <div className="pta-promo-progress" role="status"><strong>Última campaña: {campaign.status === 'completed' ? 'terminada' : campaign.status === 'failed' ? 'interrumpida' : 'en curso'}</strong>
          <span>{campaign.sent} enviados · {campaign.pending} pendientes · {campaign.skipped} omitidos · {campaign.failed} fallidos</span>
          {campaign.skipped > 0 && <small>Algunos clientes compraron o iniciaron otro pago antes de su envío.</small>}
          {campaign.failed_recipients?.map((delivery) => <small key={delivery.email}>{delivery.email}: {delivery.reason}</small>)}
        </div>}
      </form>

      <section className="pta-section pta-promo-form">
        <div className="pta-section-title"><div><p>WHATSAPP INDIVIDUAL</p><h2><MessageCircle /> Mensaje para cada cliente</h2></div></div>
        <p>Este texto es independiente del correo. Prepara el mensaje y abre WhatsApp desde el botón de cada cliente; allí lo envías tú.</p>
        <label>Tu mensaje<textarea rows={7} maxLength={3000} value={draft.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} placeholder="Hola {nombre}, tenemos una promoción para ti…" /></label>
        <small>Usa {'{nombre}'} para incluir automáticamente el primer nombre.</small>
      </section>
    </div>

    <section className="pta-section">
      <div className="pta-section-title"><div><p>DESTINATARIOS</p><h2>Clientes sin compra completada</h2></div></div>
      <div className="pta-promo-recipients">{recipients.map((recipient) =>
        <article key={recipient.id}>
          <div><strong>{recipient.name}</strong><span>{recipient.email}</span><small>Último intento: {recipient.last_status === 'expired' ? 'expirado' : 'rechazado'} · {recipient.event_title}</small></div>
          <button className="pta-secondary" type="button" disabled={!recipient.has_whatsapp || !draft.whatsapp.trim()} onClick={() => openWhatsApp(recipient)}>
            <MessageCircle /> {recipient.has_whatsapp ? 'Abrir WhatsApp' : 'Sin WhatsApp'}
          </button>
        </article>)}
        {!loading && !recipients.length && <div className="pta-empty">No hay clientes que cumplan estas condiciones.</div>}
      </div>
    </section>
  </section>;
}
