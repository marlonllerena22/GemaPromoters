import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import {
  AlertTriangle, BatteryCharging, Camera, CameraOff, CheckCircle2, ClipboardCheck,
  Cloud, CloudOff, Download, Flashlight, FlashlightOff, History, LogOut, Menu,
  QrCode, RefreshCw, Search, Settings, ShieldCheck, Signal, Ticket, Users, X
} from 'lucide-react';
import { api } from './api.js';
import './offline-scanner.css';

const STORAGE_KEY = 'protickets_offline_scanner_v1';
const DEVICE_KEY = 'protickets_scanner_device_id';
const TEST_QR_CODES = new Set([
  'PROTICKETS-PRUEBA-01',
  'PROTICKETS-PRUEBA-02',
  'PROTICKETS-PRUEBA-03'
]);
const TEST_QR_TYPES = {
  'PROTICKETS-PRUEBA-01': 'GENERAL',
  'PROTICKETS-PRUEBA-02': 'PREFERENCIA',
  'PROTICKETS-PRUEBA-03': 'GOLDEN'
};

function uid(prefix = 'scan') {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function deviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) {
    value = uid('device');
    localStorage.setItem(DEVICE_KEY, value);
  }
  return value;
}

function emptyStore() {
  return { device_id: deviceId(), gate_name: 'Acceso principal', package: null, scans: [] };
}

function readStore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return value && value.device_id ? { ...emptyStore(), ...value, scans: Array.isArray(value.scans) ? value.scans : [] } : emptyStore();
  } catch {
    return emptyStore();
  }
}

function normalizeCode(value) {
  const input = String(value || '').trim();
  const direct = input.match(/PT-[A-Z0-9-]+/i);
  if (direct) return direct[0].toUpperCase();
  try {
    const url = new URL(input);
    const match = url.pathname.match(/\/tickets\/entrada\/([^/?#]+)/i);
    if (match) return decodeURIComponent(match[1]).toUpperCase();
  } catch {
    // The QR may contain the ticket code directly.
  }
  return input.toUpperCase();
}

function formatMoment(value) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'medium'
  }).format(date);
}

function eventMoment(value) {
  if (!value) return 'Fecha por confirmar';
  const raw = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil', dateStyle: 'medium', timeStyle: 'short'
  }).format(date);
}

function initialOutcome(ticket, code) {
  if (!ticket) return { valid: false, server_result: 'invalid', message: 'BOLETO NO REGISTRADO', code };
  if (ticket.status === 'void') {
    return { valid: false, server_result: 'void', message: ticket.cancellation_scan_message || 'BOLETO ANULADO', ticket, code };
  }
  if (ticket.status === 'used' || ticket.status === 'used_local') {
    return { valid: false, server_result: 'already_used', message: 'BOLETO YA UTILIZADO', ticket, code };
  }
  return { valid: true, server_result: 'valid', message: 'ACCESO APROBADO', ticket, code };
}

function scannerTestOutcome(code) {
  if (!TEST_QR_CODES.has(code)) return null;
  const ticketName = TEST_QR_TYPES[code];
  return {
    valid: true,
    test: true,
    provisional: false,
    server_result: 'scanner_test',
    message: 'LECTURA DE PRUEBA CORRECTA',
    code,
    ticket: {
      code,
      status: 'test',
      customer_name: 'PRUEBA DEL ESCÁNER',
      ticket_name: ticketName
    }
  };
}

function ticketAccessType(outcome) {
  if (!outcome?.valid) return null;
  const ticket = outcome.ticket || outcome.server_ticket;
  const name = String(ticket?.ticket_name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (name.includes('golden')) return { key: 'golden', label: 'GOLDEN' };
  if (name.includes('preferencia')) return { key: 'preference', label: 'PREFERENCIA' };
  if (name.includes('general')) return { key: 'general', label: 'GENERAL' };
  return null;
}

function resultTone(valid) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.frequency.setValueAtTime(valid ? 880 : 180, context.currentTime);
    if (valid) oscillator.frequency.setValueAtTime(1175, context.currentTime + 0.09);
    gain.gain.setValueAtTime(0.14, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + (valid ? 0.22 : 0.42));
    oscillator.start(); oscillator.stop(context.currentTime + (valid ? 0.22 : 0.42));
    oscillator.onended = () => context.close();
  } catch {
    // Sound is an enhancement; vibration and color remain available.
  }
}

export default function OfflineTicketScanner({ user, onLogout }) {
  const [store, setStore] = useState(readStore);
  const storeRef = useRef(store);
  const [online, setOnline] = useState(navigator.onLine);
  const [view, setView] = useState('scan');
  const [manualCode, setManualCode] = useState('');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');
  const [battery, setBattery] = useState(null);
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const busyRef = useRef(false);
  const syncingRef = useRef(false);
  const wakeLockRef = useRef(null);
  const lastScanRef = useRef({ code: '', at: 0 });

  function persist(next) {
    const trimmed = { ...next, scans: (next.scans || []).slice(0, 800) };
    storeRef.current = trimmed;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    setStore(trimmed);
    return trimmed;
  }

  function updateStore(updater) {
    return persist(typeof updater === 'function' ? updater(storeRef.current) : updater);
  }

  const currentPackage = store.package;
  const pending = store.scans.filter((scan) => scan.sync_status === 'pending');
  const conflicts = store.scans.filter((scan) => scan.sync_status === 'conflict');
  const localStats = useMemo(() => (currentPackage?.tickets || []).reduce((summary, ticket) => {
    summary.total += 1;
    if (ticket.status === 'valid') summary.valid += 1;
    else if (ticket.status === 'used' || ticket.status === 'used_local') summary.used += 1;
    else summary.void += 1;
    return summary;
  }, { total: 0, valid: 0, used: 0, void: 0 }), [currentPackage]);
  const lastSyncAge = currentPackage?.generated_at ? Date.now() - new Date(currentPackage.generated_at).getTime() : Infinity;
  const packageFresh = lastSyncAge < 15 * 60 * 1000;

  async function downloadPackage(eventId = currentPackage?.event?.id, quiet = false) {
    if (!navigator.onLine) {
      if (!quiet) setNotice('Sin internet: se conserva la lista descargada en el dispositivo.');
      return null;
    }
    const data = await api(`/ticketing/validation/offline-package${eventId ? `?event_id=${encodeURIComponent(eventId)}` : ''}`);
    const pendingAccepted = new Set(storeRef.current.scans
      .filter((scan) => scan.sync_status === 'pending' && scan.client_result === 'valid')
      .map((scan) => scan.code));
    data.tickets = data.tickets.map((ticket) => pendingAccepted.has(ticket.code) && ticket.status === 'valid'
      ? { ...ticket, status: 'used_local' }
      : ticket);
    updateStore((current) => ({ ...current, package: data }));
    if (!quiet) setNotice(`Evento listo: ${data.tickets.length} boletos guardados.`);
    return data;
  }

  async function syncPending(focusScanId = '') {
    if (!navigator.onLine || syncingRef.current) return null;
    const queued = storeRef.current.scans.filter((scan) => scan.sync_status === 'pending').slice().reverse().slice(0, 500);
    if (!queued.length) {
      await downloadPackage(storeRef.current.package?.event?.id, true).catch(() => null);
      return null;
    }
    syncingRef.current = true; setSyncing(true);
    try {
      const response = await api('/ticketing/validation/offline-sync', {
        method: 'POST',
        body: JSON.stringify({
          device_id: storeRef.current.device_id,
          gate_name: storeRef.current.gate_name,
          scans: queued.map((scan) => ({
            client_event_id: scan.id,
            event_id: scan.event_id,
            code: scan.code,
            scanned_at: scan.scanned_at,
            client_result: scan.client_result
          }))
        })
      });
      const byId = new Map(response.results.map((item) => [item.client_event_id, item]));
      let focused = null;
      const syncedStore = updateStore((current) => ({
        ...current,
        scans: current.scans.map((scan) => {
          const synced = byId.get(scan.id);
          if (!synced) return scan;
          const conflict = scan.client_result === 'valid' && synced.server_result !== 'valid';
          const next = {
            ...scan,
            sync_status: conflict ? 'conflict' : 'synced',
            server_result: synced.server_result,
            server_message: synced.message,
            server_ticket: synced.ticket || null,
            synced_at: response.synced_at
          };
          if (scan.id === focusScanId) focused = { ...synced, provisional: false, scan_id: scan.id, conflict };
          return next;
        })
      }));
      await downloadPackage(storeRef.current.package?.event?.id, true);
      if (focused) {
        setResult(focused);
        resultTone(focused.valid);
        navigator.vibrate?.(focused.valid ? 100 : [120, 70, 160]);
      }
      const syncedConflicts = syncedStore.scans.filter((scan) => scan.sync_status === 'conflict').length;
      setNotice(syncedConflicts ? 'Sincronizado con alertas para revisar.' : 'Lecturas sincronizadas con ProTickets.');
      return focused;
    } catch (error) {
      setOnline(navigator.onLine);
      setNotice(`Las lecturas siguen guardadas: ${error.message}`);
      return null;
    } finally {
      syncingRef.current = false; setSyncing(false);
    }
  }

  async function processCode(rawValue) {
    const code = normalizeCode(rawValue);
    if (!code || busyRef.current) return;
    const testOutcome = scannerTestOutcome(code);
    if (testOutcome) {
      setResult(testOutcome);
      setManualCode('');
      resultTone(true);
      navigator.vibrate?.([90, 50, 90]);
      setNotice('QR de diagnóstico reconocido. No corresponde a una entrada y no se guardó como acceso.');
      return;
    }
    if (!storeRef.current.package?.tickets?.length) {
      setResult({ valid: false, message: 'DESCARGA EL EVENTO ANTES DE ESCANEAR', server_result: 'no_package' });
      return;
    }
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < 1800) return;
    lastScanRef.current = { code, at: now };
    busyRef.current = true;
    const ticket = storeRef.current.package.tickets.find((item) => item.code === code);
    const local = initialOutcome(ticket, code);
    const scan = {
      id: uid(), code, event_id: storeRef.current.package.event.id,
      scanned_at: new Date().toISOString(), client_result: local.server_result,
      client_message: local.message, customer_name: ticket?.customer_name || '',
      ticket_name: ticket?.ticket_name || '', sync_status: 'pending'
    };
    updateStore((current) => ({
      ...current,
      package: local.valid ? {
        ...current.package,
        tickets: current.package.tickets.map((item) => item.code === code ? { ...item, status: 'used_local' } : item)
      } : current.package,
      scans: [scan, ...current.scans]
    }));
    const localDisplay = { ...local, provisional: true, scan_id: scan.id };
    setResult(localDisplay); setManualCode('');
    if (!navigator.onLine) {
      resultTone(local.valid);
      navigator.vibrate?.(local.valid ? 100 : [120, 70, 160]);
    }
    if (navigator.onLine) await syncPending(scan.id);
    window.setTimeout(() => { busyRef.current = false; }, local.valid ? 1100 : 2100);
  }

  async function requestWakeLock() {
    try { wakeLockRef.current = await navigator.wakeLock?.request?.('screen'); } catch { /* optional */ }
  }

  function stopCamera() {
    controlsRef.current?.stop(); controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    stream?.getTracks?.().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    wakeLockRef.current?.release?.().catch(() => {}); wakeLockRef.current = null;
    setScanning(false); setTorchOn(false); setTorchAvailable(false);
  }

  async function startCamera() {
    stopCamera(); setCameraError(''); setResult(null); setScanning(true);
    try {
      await requestWakeLock();
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 60, delayBetweenScanSuccess: 900 });
      controlsRef.current = await reader.decodeFromConstraints({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      }, videoRef.current, (scanResult) => {
        if (scanResult) processCode(scanResult.getText());
      });
      const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
      setTorchAvailable(Boolean(track?.getCapabilities?.().torch));
    } catch (error) {
      setScanning(false);
      setCameraError(error?.name === 'NotAllowedError'
        ? 'Permite el uso de la cámara para escanear los boletos.'
        : 'No se pudo abrir la cámara. Usa el código manual mientras revisas el permiso.');
    }
  }

  async function toggleTorch() {
    const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
    if (!track) return;
    const next = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: next }] }); setTorchOn(next); } catch { setCameraError('La linterna no está disponible en este teléfono.'); }
  }

  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change); window.addEventListener('offline', change);
    navigator.getBattery?.().then((manager) => {
      const read = () => setBattery({ level: Math.round(manager.level * 100), charging: manager.charging });
      read(); manager.addEventListener('levelchange', read); manager.addEventListener('chargingchange', read);
    }).catch(() => {});
    if (navigator.onLine) {
      syncPending().then(() => downloadPackage(storeRef.current.package?.event?.id, true)).catch(() => {});
    }
    const timer = window.setInterval(() => {
      if (navigator.onLine) syncPending().catch(() => {});
    }, 30000);
    return () => {
      clearInterval(timer); window.removeEventListener('online', change); window.removeEventListener('offline', change); stopCamera();
    };
  }, []);

  useEffect(() => {
    if (online) syncPending().catch(() => {});
  }, [online]);

  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible' && scanning) requestWakeLock(); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [scanning]);

  const filteredTickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return (currentPackage?.tickets || []).filter((ticket) => [ticket.code, ticket.customer_name, ticket.order_number, ticket.ticket_name]
      .some((value) => String(value || '').toLowerCase().includes(term))).slice(0, 30);
  }, [currentPackage, search]);

  async function prepareEvent(eventId) {
    setNotice('Descargando la lista más reciente…');
    try { await syncPending(); await downloadPackage(eventId); } catch (error) { setNotice(error.message); }
  }

  function setGateName(value) {
    updateStore((current) => ({ ...current, gate_name: value }));
  }

  async function copySummary() {
    const accepted = store.scans.filter((scan) => (scan.server_result || scan.client_result) === 'valid').length;
    const denied = store.scans.length - accepted;
    const text = `ProTickets · ${currentPackage?.event?.title || 'Evento'}\n${store.gate_name}\nAceptados: ${accepted}\nRechazados: ${denied}\nPendientes de sincronizar: ${pending.length}\nConflictos: ${conflicts.length}\nÚltima actualización: ${formatMoment(currentPackage?.generated_at)}`;
    try { await navigator.clipboard.writeText(text); setNotice('Resumen copiado.'); } catch { setNotice(text); }
  }

  const accessType = ticketAccessType(result);

  return <main className="pts-shell">
    <header className="pts-header">
      <div className="pts-brand"><QrCode /><span><small>PROTICKETS</small><strong>Scanner</strong></span></div>
      <div className={`pts-connectivity ${online ? 'online' : 'offline'}`}>
        {online ? <Cloud /> : <CloudOff />}<span>{online ? 'En línea' : 'Sin señal'}</span>
      </div>
    </header>

    <section className="pts-eventbar">
      <div><small>EVENTO PREPARADO</small><strong>{currentPackage?.event?.title || 'Descarga un evento para comenzar'}</strong><span>{currentPackage?.event ? `${eventMoment(currentPackage.event.event_date)} · ${currentPackage.event.venue || currentPackage.event.city || ''}` : 'Necesitas internet solo para la preparación inicial.'}</span></div>
      <button type="button" onClick={() => { setView('setup'); if (online) prepareEvent(currentPackage?.event?.id); }} disabled={syncing}><RefreshCw className={syncing ? 'spin' : ''} />{syncing ? 'Sincronizando' : 'Actualizar'}</button>
    </section>

    <section className={`pts-sync-strip ${pending.length ? 'pending' : packageFresh ? 'ready' : 'stale'}`}>
      <span>{pending.length ? <CloudOff /> : packageFresh ? <ShieldCheck /> : <AlertTriangle />}</span>
      <div><strong>{pending.length ? `${pending.length} lecturas guardadas para sincronizar` : packageFresh ? 'Lista lista para trabajar sin internet' : 'Actualiza la lista antes de abrir puertas'}</strong><small>Última actualización: {formatMoment(currentPackage?.generated_at)}</small></div>
      {battery && <div className={`pts-battery ${battery.level < 25 && !battery.charging ? 'low' : ''}`}><BatteryCharging />{battery.level}%</div>}
    </section>

    {notice && <button className="pts-notice" type="button" onClick={() => setNotice('')}>{notice}<X /></button>}

    {view === 'scan' && <section className="pts-scanner-view">
      <div className={`pts-camera ${scanning ? 'active' : ''}`}>
        <video ref={videoRef} muted playsInline />
        {!scanning && <div className="pts-camera-empty"><Camera /><strong>Cámara lista</strong><span>Apunta al código QR del boleto.</span></div>}
        {scanning && <><span className="pts-target" /><span className="pts-scanline" /></>}
        {scanning && torchAvailable && <button className="pts-torch" type="button" onClick={toggleTorch}>{torchOn ? <FlashlightOff /> : <Flashlight />}</button>}
      </div>
      <div className="pts-camera-actions">
        {!scanning ? <button className="primary" type="button" onClick={startCamera}><Camera /> Abrir cámara</button> : <button type="button" onClick={stopCamera}><CameraOff /> Pausar</button>}
      </div>
      {cameraError && <div className="pts-error"><AlertTriangle />{cameraError}</div>}

      <form className="pts-manual" onSubmit={(event) => { event.preventDefault(); processCode(manualCode); }}>
        <label><Search /><input value={manualCode} onChange={(event) => setManualCode(event.target.value.toUpperCase())} placeholder="Código manual PT-…" /></label>
        <button type="submit" disabled={!manualCode.trim()}>Validar</button>
      </form>

      {result && <article className={`pts-result ${result.valid ? 'valid' : 'invalid'} ${result.conflict ? 'conflict' : ''} ${accessType ? `access-${accessType.key}` : ''}`}>
        {accessType && <div className="pts-access-band"><span>LOCALIDAD</span><strong>{accessType.label}</strong></div>}
        <div className="pts-result-icon">{result.valid ? <CheckCircle2 /> : <X />}</div>
        <div className="pts-result-copy"><small>{result.test ? 'QR DE PRUEBA · NO HABILITA INGRESO' : result.provisional ? 'RESULTADO SIN CONEXIÓN · GUARDADO' : result.conflict ? 'CONFLICTO AL SINCRONIZAR' : 'RESULTADO CONFIRMADO'}</small><strong>{result.message || result.server_message}</strong>
          {(result.ticket || result.server_ticket) && <span>{(result.ticket || result.server_ticket).customer_name} · {(result.ticket || result.server_ticket).ticket_name}</span>}
        </div>
        <button type="button" onClick={() => setResult(null)}>Cerrar</button>
      </article>}

      <div className="pts-stats">
        <article><Users /><span><strong>{localStats.used}</strong><small>Ingresaron</small></span></article>
        <article><Ticket /><span><strong>{localStats.valid}</strong><small>Disponibles</small></span></article>
        <article><X /><span><strong>{localStats.void}</strong><small>Anulados</small></span></article>
        <article className={pending.length ? 'warn' : ''}><Cloud /><span><strong>{pending.length}</strong><small>Por sincronizar</small></span></article>
      </div>
    </section>}

    {view === 'history' && <section className="pts-panel">
      <div className="pts-panel-title"><div><small>TURNO ACTUAL</small><h2>Historial del dispositivo</h2></div><button type="button" onClick={copySummary}><ClipboardCheck /> Copiar resumen</button></div>
      <div className="pts-history">
        {store.scans.map((scan) => {
          const state = scan.server_result || scan.client_result;
          const accepted = state === 'valid';
          return <article key={scan.id} className={scan.sync_status === 'conflict' ? 'conflict' : ''}>
            <span className={accepted ? 'ok' : 'bad'}>{accepted ? <CheckCircle2 /> : <X />}</span>
            <div><strong>{scan.server_message || scan.client_message}</strong><small>{scan.customer_name || scan.code} {scan.ticket_name ? `· ${scan.ticket_name}` : ''}</small></div>
            <div><strong>{formatMoment(scan.scanned_at)}</strong><small>{scan.sync_status === 'pending' ? 'Guardado en el teléfono' : scan.sync_status === 'conflict' ? 'Revisar conflicto' : 'Sincronizado'}</small></div>
          </article>;
        })}
        {!store.scans.length && <div className="pts-empty">Aún no hay lecturas en este dispositivo.</div>}
      </div>
    </section>}

    {view === 'search' && <section className="pts-panel">
      <div className="pts-panel-title"><div><small>RESPALDO DE PUERTA</small><h2>Buscar boleto</h2></div></div>
      <label className="pts-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, pedido o código" autoFocus /></label>
      <div className="pts-ticket-list">
        {filteredTickets.map((ticket) => <article key={ticket.code}>
          <span className={`status ${ticket.status}`}>{ticket.status === 'valid' ? 'Disponible' : ticket.status === 'void' ? 'Anulado' : 'Utilizado'}</span>
          <div><strong>{ticket.customer_name}</strong><small>{ticket.ticket_name} · {ticket.order_number}</small><code>{ticket.code}</code></div>
          <button type="button" onClick={() => { setView('scan'); processCode(ticket.code); }}>Validar</button>
        </article>)}
        {search && !filteredTickets.length && <div className="pts-empty">No aparece en la lista descargada. Si recuperas señal, actualiza antes de decidir.</div>}
      </div>
    </section>}

    {view === 'setup' && <section className="pts-panel pts-setup">
      <div className="pts-panel-title"><div><small>PREPARACIÓN</small><h2>Control del evento</h2></div></div>
      <label>Evento<select value={currentPackage?.event?.id || ''} disabled={!online} onChange={(event) => prepareEvent(Number(event.target.value))}>
        {!currentPackage?.events?.length && <option value="">Conéctate para cargar eventos</option>}
        {currentPackage?.events?.map((event) => <option value={event.id} key={event.id}>{event.title}</option>)}
      </select></label>
      <label>Nombre de esta puerta o teléfono<input value={store.gate_name} onChange={(event) => setGateName(event.target.value)} placeholder="Ej. Puerta principal 1" /></label>
      <button className="pts-prepare" type="button" disabled={!online || syncing} onClick={() => prepareEvent(currentPackage?.event?.id)}><Download /> Descargar y actualizar boletos</button>
      <div className="pts-checklist">
        <article className={currentPackage?.tickets?.length ? 'ok' : ''}><CheckCircle2 /><span><strong>Lista descargada</strong><small>{localStats.total} boletos en este teléfono</small></span></article>
        <article className={packageFresh ? 'ok' : ''}><RefreshCw /><span><strong>Actualización reciente</strong><small>{packageFresh ? 'Lista actualizada hace menos de 15 minutos' : 'Actualiza antes de abrir puertas'}</small></span></article>
        <article className={!pending.length ? 'ok' : ''}><Cloud /><span><strong>Sincronización al día</strong><small>{pending.length ? `${pending.length} lecturas pendientes` : 'No hay lecturas pendientes'}</small></span></article>
        <article className={!battery || battery.level >= 30 || battery.charging ? 'ok' : ''}><BatteryCharging /><span><strong>Batería preparada</strong><small>{battery ? `${battery.level}%${battery.charging ? ' · cargando' : ''}` : 'Mantén un cargador portátil disponible'}</small></span></article>
      </div>
      {conflicts.length > 0 && <div className="pts-conflict-box"><AlertTriangle /><div><strong>{conflicts.length} conflictos requieren revisión</strong><span>Ocurre si otro dispositivo usó o anuló un boleto mientras este teléfono estaba sin señal.</span></div></div>}
      <button className="pts-logout" type="button" onClick={onLogout}><LogOut /> Cerrar sesión de {user?.name || user?.username}</button>
    </section>}

    <nav className="pts-bottom-nav">
      <button className={view === 'scan' ? 'active' : ''} onClick={() => setView('scan')}><QrCode /><span>Escanear</span></button>
      <button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}><Search /><span>Buscar</span></button>
      <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}><History /><span>Historial</span>{pending.length > 0 && <b>{pending.length}</b>}</button>
      <button className={view === 'setup' ? 'active' : ''} onClick={() => setView('setup')}><Settings /><span>Preparar</span></button>
    </nav>
  </main>;
}
