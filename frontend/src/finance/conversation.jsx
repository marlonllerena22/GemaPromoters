import React, { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Mic, Send, Square, ImagePlus, X } from "lucide-react";
import { useFinance } from "./context.jsx";
import { businessNames, financeApi, money } from "./api.js";
import { Button, Modal } from "./components.jsx";
import { AssistantAvatar } from "./workflows.jsx";

export function QuickConversation({ initial = {}, onClose, onForm }) {
  const { refresh, user } = useFinance();
  const [messages, setMessages] = useState([{ role: "assistant", content: `Hola, ${user.name.split(" ")[0]}. Cuéntame qué pasó con el dinero. Yo preparo el registro y te pregunto lo que falte.` }]);
  const [value, setValue] = useState(initial.text || ""), [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState(""), [listening, setListening] = useState(false);
  const [photos,setPhotos]=useState([]),[uploading,setUploading]=useState(false);
  const picker=useRef(null),photoUrls=useRef(new Set()),initialPhoto=useRef(false);
  const recognition = useRef(null), mounted = useRef(true), latest = useRef({}), end = useRef(null), sending = useRef(false);
  latest.current = { messages, draft, value, busy, photos };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; photoUrls.current.forEach(URL.revokeObjectURL); if (recognition.current) { recognition.current.onend = null; recognition.current.abort(); } }; }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages, draft, busy]);
  useEffect(()=>{if(initial.photo&&!initialPhoto.current){initialPhoto.current=true;void attachPhotos([initial.photo]);}},[]);
  async function attachPhotos(files){
    if(sending.current||uploading)return;
    const selected=Array.from(files||[]);
    if(latest.current.photos.length+selected.length>3){setError("Puedes adjuntar hasta tres fotos. Quita una antes de añadir otra.");return;}
    stopListening();setUploading(true);setError("");setDraft(null);setDone(false);
    try{
      for(const file of selected){
        if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Elige una foto JPG, PNG o WebP.");
        if(file.size>6*1024*1024)throw new Error("La foto debe pesar hasta 6 MB. Puedes usar una captura de pantalla.");
        const encoded=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]);r.onerror=reject;r.readAsDataURL(file);});
        const saved=await financeApi("/quick/conversation/photos",{name:file.name,mime:file.type,data:encoded});
        if(!mounted.current)return;
        const url=URL.createObjectURL(file);photoUrls.current.add(url);
        setPhotos(current=>current.some(p=>p.id===saved.id)?current:[...current,{...saved,url}]);
      }
    }catch(e){if(mounted.current)setError(e.message);}
    finally{if(mounted.current)setUploading(false);if(picker.current)picker.current.value="";}
  }
  function clearPhotos(){setPhotos([]);photoUrls.current.forEach(URL.revokeObjectURL);photoUrls.current.clear();}
  function stopListening() {
    if (recognition.current) { recognition.current.onend = null; recognition.current.onresult = null; recognition.current.onerror = null; try { recognition.current.abort(); } catch {} }
    setListening(false);
  }
  async function confirm() {
    if (!latest.current.draft || sending.current) return;
    stopListening();
    sending.current = true; setBusy(true); setError("");
    try {
      const result = await financeApi("/quick/conversation/confirm", { draft_id: latest.current.draft.id, confirmed: true });
      if (!mounted.current) return;
      setMessages((m) => [...m, { role: "assistant", content: result.message }]);
      setDraft(null); setDone(true); await refresh();
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  }
  async function send(raw = latest.current.value) {
    const message = String(raw).trim() || (latest.current.photos.length ? "Revisa las fotos adjuntas y ayúdame a registrar o actualizar sus datos. Pregúntame si falta algo." : "");
    if (!message || sending.current || uploading) return;
    stopListening();
    if (latest.current.draft && /^(sí|si|confirmo|confirmar|confirma|sí,? confirma|si,? confirma)[.!]?$/i.test(message)) { setValue(""); return confirm(); }
    sending.current = true; setBusy(true); setError(""); setValue("");
    const history = [...latest.current.messages, { role: "user", content: message }];
    setMessages(history); setDraft(null);
    try {
      const result = await financeApi("/quick/conversation", { messages: history.slice(-12), photo_ids:latest.current.photos.map(p=>p.id) });
      if (!mounted.current) return;
      setMessages((m) => [...m, { role: "assistant", content: result.message }]); setDraft(result.draft);
    } catch (e) { if (mounted.current) { setError(e.message); setValue(message); } }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  }
  async function restart() {
    if (busy || uploading) return;
    stopListening();
    try { if (draft) await financeApi(`/quick/conversation/${draft.id}`, null, "DELETE"); }
    catch (e) { setError(e.message); return; }
    clearPhotos();setMessages([{ role: "assistant", content: "Cuéntame el siguiente movimiento." }]); setDraft(null); setDone(false); setValue(""); setError("");
  }
  function speak() {
    if (listening) { recognition.current?.stop(); return; }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { setError("Puedes usar el micrófono del teclado de tu celular y después enviar el mensaje."); return; }
    let transcript = "";
    const r = new Speech(); recognition.current = r;
    r.lang = "es-EC"; r.continuous = false; r.interimResults = true;
    r.onresult = (event) => { transcript = Array.from(event.results).map((result) => result[0].transcript).join(" "); if (mounted.current) setValue(transcript); };
    r.onerror = (event) => { transcript = ""; if (mounted.current) { setListening(false); setError(event.error === "not-allowed" ? "Activa el permiso del micrófono o usa el teclado para conversar." : "No pude escuchar bien. Puedes intentarlo de nuevo o escribir."); } };
    r.onend = () => { if (mounted.current) { setListening(false); if (transcript.trim()) void send(transcript); } };
    try { r.start(); setListening(true); setError(""); } catch { setError("No se pudo iniciar el dictado. Usa el micrófono de tu teclado o escribe aquí."); }
  }
  return (
    <Modal title="Registra conversando con Gema" subtitle="Tú me cuentas. Yo preparo. Tú confirmas." onClose={onClose}>
      <div className="gf-quick-dialogue">
        <div className="gf-quick-dialogue-messages" aria-live="polite">
          {messages.map((m, i) => <div key={i} className={`gf-quick-bubble ${m.role}`}>{m.role === "assistant" && <AssistantAvatar size={24} />}<p>{m.content}</p></div>)}
          {busy && <p className="gf-muted">Gema está revisando los datos…</p>}
          {draft && <section className="gf-quick-confirm" aria-label="Resumen por confirmar">
            <small>REVISA ANTES DE GUARDAR</small>
            <h3>{draft.type}</h3><strong>{money(draft.amount_cents)}</strong>
            {draft.items ? <>
              <div className="gf-quick-batch">{draft.items.map((item, i) => <article key={i}>
                <b>{i + 1}. {item.counterparty || item.type}</b><strong>{money(item.amount_cents)}</strong>
                <p>{item.account} · {item.description}</p>
                <small>{item.already_in_bank ? "Ya registrado: no se vuelve a sumar" : item.changes_bank_balance ? "Se actualizará esta cuenta" : "No cambia el banco"}</small>
              </article>)}</div>
              <dl>{draft.accounts.map((a) => <div key={a.account_id}><dt>Saldo final · {a.account}</dt><dd>{money(a.after_cents)}</dd></div>)}</dl>
            </> : <dl>
              {draft.business_id && <div><dt>Corresponde a</dt><dd>{businessNames[draft.business_id]}</dd></div>}
              <div><dt>Cuenta o fondo</dt><dd>{draft.account}</dd></div>
              <div><dt>Descripción</dt><dd>{draft.description}</dd></div>
              {draft.reference && <div><dt>Referencia</dt><dd>{draft.reference}</dd></div>}
              {draft.before_cents != null && <div><dt>Saldo anterior</dt><dd>{money(draft.before_cents)}</dd></div>}
              {draft.after_cents != null && <div><dt>Saldo después</dt><dd>{money(draft.after_cents)}</dd></div>}
            </dl>}
            {draft.snapshot && <p>Confirma que la foto muestra el saldo actual. Reemplazaré el saldo indicado y guardaré la diferencia; no se suma como un ingreso nuevo.</p>}
            {draft.declared_without_reference && <p>Actualizaré el saldo con tu declaración. Quedará pendiente de contrastar con el aviso bancario, sin sumarlo dos veces.</p>}
            {draft.already_in_bank && <p>Ya aparece en el banco. Lo relacionaré sin sumarlo ni restarlo otra vez.</p>}
            {draft.source_balance_unknown && <p>El saldo de {draft.source_fund} sigue por indicar. No inventaré cuánto le queda.</p>}
            {draft.changes_cash_balance && <p>Se registra el gasto y se descuenta de tu efectivo.</p>}
            {draft.changes_bank_balance === false && !draft.already_in_bank && !draft.changes_cash_balance && <p>Este registro no cambia el saldo bancario. Se contrastará con el aviso del banco.</p>}
            <Button icon={Check} onClick={confirm} loading={busy}>Sí, confirmar registro</Button>
            <button className="gf-text-button" onClick={() => { setDraft(null); setValue("Quiero corregir "); }} disabled={busy}>Quiero corregir algo</button>
          </section>}
          <div ref={end} />
        </div>
        {(photos.length>0||uploading)&&<section className="gf-conversation-photos" aria-label="Fotos para Gema">
          {photos.map(photo=><article key={photo.id}><img src={photo.url} alt={photo.name}/><span>{photo.name}</span><button type="button" aria-label={`Quitar foto ${photo.name}`} disabled={busy||uploading} onClick={()=>{setPhotos(p=>p.filter(x=>x.id!==photo.id));URL.revokeObjectURL(photo.url);photoUrls.current.delete(photo.url);setDraft(null);}}><X size={17}/></button></article>)}
          {uploading&&<p aria-live="polite">Guardando foto de forma segura…</p>}
        </section>}
        {error && <p className="gf-error" role="alert">{error}</p>}
        {done ? <div className="gf-quick-dialogue-done"><CheckCircle2 size={22} /><Button onClick={onClose}>Listo</Button><Button variant="secondary" onClick={() => { clearPhotos();setMessages([{ role: "assistant", content: "Cuéntame el siguiente movimiento." }]); setDone(false); setValue(""); }}>Otro registro</Button></div> : <form className="gf-quick-dialogue-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea aria-label="Habla o escribe a Gema" placeholder={listening ? "Te escucho…" : "Por ejemplo: pagué 80 dólares de gasolina personal…"} value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} maxLength={1200} rows={2} />
          <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>void attachPhotos(e.target.files)} aria-label="Adjuntar fotos a Gema"/>
          <div><Button type="button" variant="secondary" icon={ImagePlus} onClick={()=>picker.current?.click()} disabled={busy||uploading||photos.length>=3}>Foto</Button><Button type="button" variant="secondary" icon={listening ? Square : Mic} onClick={speak} disabled={busy||uploading}>{listening ? "Terminar" : "Hablar"}</Button><Button type="submit" icon={Send} disabled={(!value.trim()&&!photos.length) || busy || uploading} loading={busy}>{photos.length&&!value.trim()?"Analizar foto":"Enviar"}</Button></div>
        </form>}
        <div className="gf-quick-dialogue-footer"><small>Solo se guarda después de tu confirmación. No realiza transferencias en el banco.</small><button className="gf-text-button" onClick={restart} disabled={busy||uploading}>Nueva conversación</button><button className="gf-text-button" onClick={onForm} disabled={busy||uploading}>Usar formulario</button></div>
      </div>
    </Modal>
  );
}
