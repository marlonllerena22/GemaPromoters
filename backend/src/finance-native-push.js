import { JWT } from "google-auth-library";
import * as webpush from "web-push";
let cached;
export function nativePushConfiguration() {
  try {
    const key=JSON.parse(process.env.FINANCE_FCM_CREDENTIALS||"null");
    return {enabled:Boolean(key?.project_id && key?.client_email && key?.private_key && process.env.FINANCE_DOCUMENT_KEY && process.env.FINANCE_DEMO!=="1"),key};
  } catch { return {enabled:false,key:null}; }
}
export function validateNativeSubscription(value) {
  if(value?.provider!=="fcm" || !/^[a-zA-Z0-9_:\-]{80,4096}$/.test(value.token||"")) throw Object.assign(new Error("Registro de dispositivo Android no válido"),{status:400});
  return {provider:"fcm",token:value.token,endpoint:`fcm:${value.token}`};
}
export async function sendFinancePush(subscription,payload,options) {
  if(subscription.provider!=="fcm") return webpush.sendNotification(subscription,payload,options);
  const config=nativePushConfiguration();
  if(!config.enabled) throw Object.assign(new Error("Avisos Android pendientes de configuración"),{statusCode:503});
  const key=config.key;
  if(cached?.email!==key.client_email || cached?.keyId!==key.private_key_id) cached={email:key.client_email,keyId:key.private_key_id,client:new JWT({email:key.client_email,key:key.private_key,scopes:["https://www.googleapis.com/auth/firebase.messaging"]})};
  const value=JSON.parse(payload);
  const data={url:value.url||"/finanzas/pagos",tag:value.tag||"gema-payment-requests",...(value.test_id?{test_id:value.test_id}:{})};
  try {
    await cached.client.request({url:`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(key.project_id)}/messages:send`,method:"POST",timeout:8000,data:{message:{token:subscription.token,notification:{title:value.title,body:value.body},data,android:{priority:"HIGH",ttl:`${Math.min(options?.TTL||86400,86400)}s`,notification:{channel_id:"gema-finance-alerts",sound:"default",tag:data.tag}}}}});
    return {statusCode:200};
  } catch(error) { throw Object.assign(new Error("No se pudo entregar el aviso Android"),{statusCode:Number(error.response?.status)||503}); }
}
