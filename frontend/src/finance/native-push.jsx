import React,{useEffect,useRef,useState} from "react";
import {Capacitor,registerPlugin} from "@capacitor/core";
import {Bell} from "lucide-react";
import {financeApi} from "./api.js";
import {useFinance} from "./context.jsx";
import {Button} from "./components.jsx";
export const isNativeFinance=()=>Capacitor.isNativePlatform();
const Push=registerPlugin("PushNotifications");
let lastNativeEndpoint=null;
export async function disconnectNativePush(){ if(!isNativeFinance())return; if(lastNativeEndpoint)await financeApi("/push/unsubscribe",{endpoint:lastNativeEndpoint}).catch(()=>{}); await Push.unregister().catch(()=>{}); lastNativeEndpoint=null; }
const allowedRoutes=new Set(["/finanzas/pagos","/finanzas/cheques","/finanzas/tarjetas","/finanzas/prestamos"]);
export function NativePushEnrollment(){
  const {user,notify,navigate}=useFinance(),[busy,setBusy]=useState(false),[connected,setConnected]=useState(false),[detail,setDetail]=useState("Activa los avisos de Android para recibir tus pendientes con la app cerrada.");
  const token=useRef(null),alive=useRef(true),listeners=useRef([]),registration=useRef(null);
  const allowed=user.role==="owner"||user.checks_manage;
  async function save(value){
    token.current=value; lastNativeEndpoint=`fcm:${value}`;
    await financeApi("/push/subscribe",{subscription:{provider:"fcm",token:value}});
    if(alive.current){setConnected(true);setDetail("Android conectado. Puedes enviar una prueba a este celular.");}
    registration.current?.resolve(value); registration.current=null;
  }
  useEffect(()=>{
    alive.current=true;
    if(!allowed)return;
    async function setup(){
      const handles=await Promise.all([
        Push.addListener("registration",value=>{void save(value.value).catch(e=>{registration.current?.reject(e);registration.current=null;if(alive.current)setDetail(e.message);});}),
        Push.addListener("registrationError",()=>{registration.current?.reject(new Error("Android no pudo registrar los avisos. Revisa tu conexión y Google Play Services."));registration.current=null;}),

      ]);
      if(!alive.current){handles.forEach(h=>h.remove());return;}listeners.current=handles;
      await Push.createChannel({id:"gema-finance-alerts",name:"Pagos y compromisos",description:"Transferencias, cheques, tarjetas y préstamos de Gema",importance:5,visibility:0,vibration:true,sound:"default"});
      const permission=await Push.checkPermissions();
      if(permission.receive==="granted")await Push.register();
    }
    void setup().catch(e=>{if(alive.current)setDetail(e.message);});
    return()=>{alive.current=false;listeners.current.forEach(h=>h.remove());listeners.current=[];};
  },[user.id]);
  async function enable(){
    setBusy(true);
    try{
      const permission=await Push.requestPermissions();
      if(permission.receive!=="granted")throw new Error("Permite Notificaciones en Ajustes de Android → Aplicaciones → Gema Finanzas.");
      const cfg=await financeApi("/push/config");if(!cfg.native_enabled)throw new Error("Los avisos Android todavía se están configurando en el servidor.");
      if(!token.current){const value=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{registration.current=null;reject(new Error("No recibimos el registro de Android. Reintenta con Internet y Google Play Services activos."));},20000);registration.current={resolve:v=>{clearTimeout(timeout);resolve(v);},reject:e=>{clearTimeout(timeout);reject(e);}};});await Push.register();await value;}
      await financeApi("/push/test",{endpoint:`fcm:${token.current}`});
      if(alive.current)setDetail("Prueba enviada a Android. Debe aparecer como una notificación de Gema Finanzas; al tocarla se abrirán tus pendientes.");
    }catch(e){if(alive.current){setDetail(e.message);notify(e.message,true);}}
    finally{if(alive.current)setBusy(false);}
  }
  if(!allowed)return null;
  return <section className="gf-push-enrollment" aria-label="Avisos Android"><Bell size={22}/><div><strong>{connected?"Avisos de Android conectados":"Activa los avisos de tu APK"}</strong><p>{detail}</p></div><Button variant="secondary" loading={busy} onClick={enable}>{connected?"Probar aviso Android":"Activar avisos Android"}</Button></section>;
}

export function NativeNotificationBridge(){
  const {user,notify,navigate}=useFinance();
  useEffect(()=>{
    if(!isNativeFinance())return;
    let stopped=false,handles=[];
    void Promise.all([
      Push.addListener("pushNotificationReceived",value=>{if(value.data?.test_id)void financeApi("/push/receipt",{id:value.data.test_id});notify(value.title||"Tienes un aviso de Gema");}),
      Push.addListener("pushNotificationActionPerformed",value=>{if(value.notification.data?.test_id)void financeApi("/push/receipt",{id:value.notification.data.test_id});const path=value.notification.data?.url;if(allowedRoutes.has(path))navigate(path.split("/").at(-1));})
    ]).then(result=>{if(stopped)result.forEach(h=>h.remove());else handles=result;});
    return()=>{stopped=true;handles.forEach(h=>h.remove());};
  },[user.id]);
  return null;
}
