import test from "node:test";
import assert from "node:assert/strict";
import {JWT} from "google-auth-library";
import {validatePushSubscription} from "../src/finance-push.js";
import {nativePushConfiguration,sendFinancePush} from "../src/finance-native-push.js";

test("Android tokens are validated and FCM uses a fixed project endpoint, private payload and native alert channel",async(t)=>{
  const previous={};
  for(const [key,value] of Object.entries({FINANCE_FCM_CREDENTIALS:JSON.stringify({project_id:"synthetic-notifications",client_email:"sender@example.invalid",private_key:"fake-key-not-used",private_key_id:"synthetic"}),FINANCE_DOCUMENT_KEY:"test-native-push-document-key-only-123456",FINANCE_DEMO:"0"})){previous[key]=process.env[key];process.env[key]=value;}
  t.after(()=>{for(const [key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const token="test-token_".repeat(15),sub=validatePushSubscription({provider:"fcm",token});
  assert.equal(sub.endpoint,`fcm:${token}`);assert.equal(nativePushConfiguration().enabled,true);
  for(const bad of ["short", "https://attacker.invalid/"+token, token+"\n"] )assert.throws(()=>validatePushSubscription({provider:"fcm",token:bad}));
  let requests=0;
  t.mock.method(JWT.prototype,"request",async(opts)=>{
    requests++;assert.equal(opts.url,"https://fcm.googleapis.com/v1/projects/synthetic-notifications/messages:send");
    assert.equal(opts.data.message.android.priority,"HIGH");
    assert.equal(opts.data.message.android.notification.channel_id,"gema-finance-alerts");
    assert.equal(opts.data.message.token,token);
    assert.equal(opts.data.message.data.url,"/finanzas/pagos");
    assert.equal(opts.timeout,8000);return {status:200};
  });
  await sendFinancePush(sub,JSON.stringify({title:"Pendiente",body:"Abre Gema",url:"/finanzas/pagos",tag:"gema-payment-requests"}),{TTL:120});
  assert.equal(requests,1);
  t.mock.method(JWT.prototype,"request",async()=>{throw {response:{status:404}};});
  await assert.rejects(sendFinancePush(sub,JSON.stringify({title:"Prueba"}),{}),e=>e.statusCode===404 && !e.response);
});
