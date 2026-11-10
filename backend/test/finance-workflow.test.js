import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import Database from "better-sqlite3";
import express from "express";
import { generateVAPIDKeys } from "web-push";
import { initFinanceDb, safeMember, financeDay } from "../src/finance-db.js";
import { createMovement } from "../src/finance-service.js";
import { encryptDocument } from "../src/finance-ai.js";
import { queuePaymentNotice } from "../src/finance-workflow.js";
import {
  validatePushSubscription,
  flushPaymentPush,
  registerPaymentPush,
} from "../src/finance-push.js";
import { workflowView } from "../../shared/finance-workflow.mjs";
import {
  analyzeBankDetails,
  encryptDocument as encryptBankFixture,
} from "../src/finance-ai.js";
import { bankDraft } from "../../shared/finance-payees.mjs";
test("bank photo extraction keeps all alternatives and never fills masked account digits", async (t) => {
  const original = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "fixture-no-real-provider";
  t.after(() => {
    globalThis.fetch = original;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const request = JSON.parse(options.body);
    assert.equal(request.store, false);
    assert.match(request.instructions, /origen/);
    assert.match(request.instructions, /No inventes/);
    assert.equal(request.text.format.schema.properties.accounts.type, "array");
    return new Response(
      JSON.stringify({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  name: "Proveedor ficticio",
                  document: "",
                  email: "",
                  accounts: [
                    {
                      bank: "Pichincha",
                      type: "savings",
                      number: "0012345678",
                      holder: "Titular ficticio",
                    },
                    {
                      bank: "Produbanco",
                      type: "checking",
                      number: "****1234",
                      holder: "",
                    },
                  ],
                  warnings: ["Segunda cuenta incompleta."],
                }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };
  const analysis = await analyzeBankDetails({
    mime: "image/png",
    encrypted: encryptBankFixture(Buffer.from("synthetic-test-only")),
  });
  assert.equal(analysis.accounts.length, 2);
  assert.equal(analysis.accounts[0].number, "0012345678");
  assert.equal(analysis.accounts[1].number, "");
  assert.equal(analysis.draft, true);
  assert.equal(analysis.warnings.length, 1);
  assert.equal(
    bankDraft({
      accounts: [{ number: "0012-3456", bank: "Test", type: "savings" }],
    }).accounts[0].number,
    "00123456",
  );
});
process.env.FINANCE_DOCUMENT_KEY ||=
  "test-workflow-key-at-least-thirty-two-characters";
const subscription = () => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/test-only-fake-subscription",
  keys: {
    auth: crypto.randomBytes(16).toString("base64url"),
    p256dh: generateVAPIDKeys().publicKey,
  },
});
function fixture(t) {
  const db = new Database(":memory:");
  initFinanceDb(db);
  db.prepare(
    "INSERT INTO finance_members (name,username,password_hash,role,business_ids) VALUES ('Push test','push-test','unused','owner','[\"producalza\",\"marjorie\",\"gemashow\",\"personal\"]')",
  ).run();
  const user = safeMember(
    db
      .prepare("SELECT * FROM finance_members WHERE username='push-test'")
      .get(),
  );
  const request = createMovement(db, user, {
    business_id: "personal",
    kind: "expense",
    amount_cents: 8000,
    day: financeDay(),
    category: "Gasolina",
    counterparty: "SECRET-PERSONAL-MERCHANT",
    description: "SECRET-PERSONAL-DESCRIPTION",
  });
  db.prepare(
    "UPDATE finance_movements SET is_payment_request=1 WHERE id=?",
  ).run(request.id);
  queuePaymentNotice(db, request.id);
  const value = subscription();
  db.prepare(
    "INSERT INTO finance_push_subscriptions (endpoint_hash,member_id,encrypted) VALUES (?,?,?)",
  ).run(
    crypto.createHash("sha256").update(value.endpoint).digest("hex"),
    user.id,
    encryptDocument(Buffer.from(JSON.stringify(value))),
  );
  t.after(() => db.close());
  return { db, user, request };
}
test("push subscriptions accept browser providers and reject arbitrary or insecure destinations", () => {
  const s = subscription();
  assert.equal(validatePushSubscription(s).endpoint, s.endpoint);
  for (const endpoint of [
    "http://fcm.googleapis.com/a",
    "https://127.0.0.1/a",
    "https://169.254.169.254/a",
    "https://fcm.googleapis.com.evil.example/a",
    "https://user:pass@fcm.googleapis.com/a",
    "https://fcm.googleapis.com:8443/a",
  ])
    assert.throws(() => validatePushSubscription({ ...s, endpoint }));
  assert.throws(() =>
    validatePushSubscription({
      ...s,
      keys: { auth: "short", p256dh: "invalid" },
    }),
  );
});
test("queued push is encrypted at rest, delivered without financial details and never clears its payable", async (t) => {
  const f = fixture(t);
  let sent = 0;
  await flushPaymentPush(f.db, {
    config: {
      enabled: true,
      publicKey: "test",
      privateKey: "test",
      subject: "mailto:test@example.invalid",
    },
    send: async (sub, payload) => {
      sent++;
      assert.ok(sub.endpoint.startsWith("https://fcm.googleapis.com/"));
      assert.equal(payload.includes("SECRET"), false);
      assert.equal(payload.includes("8000"), false);
      assert.equal(JSON.parse(payload).url, "/finanzas/pagos");
      return { statusCode: 201 };
    },
  });
  assert.equal(sent, 1);
  assert.equal(
    f.db.prepare("SELECT state FROM finance_push_outbox").get().state,
    "sent",
  );
  assert.equal(
    f.db
      .prepare("SELECT status FROM finance_movements WHERE id=?")
      .get(f.request.id).status,
    "pending",
  );
  const encrypted = f.db
    .prepare("SELECT encrypted FROM finance_push_subscriptions")
    .get().encrypted;
  assert.equal(encrypted.includes(Buffer.from("https://")), false);
});
test("resolved requests skip stale push and failed providers preserve pending requests for retry", async (t) => {
  const f = fixture(t);
  let sent = 0;
  const config = {
    enabled: true,
    publicKey: "test",
    privateKey: "test",
    subject: "mailto:test@example.invalid",
  };
  await flushPaymentPush(f.db, {
    config,
    send: async () => {
      throw Object.assign(new Error("test failure"), { statusCode: 503 });
    },
  });
  assert.equal(
    f.db.prepare("SELECT state FROM finance_push_outbox").get().state,
    "queued",
  );
  assert.equal(
    f.db
      .prepare("SELECT status FROM finance_movements WHERE id=?")
      .get(f.request.id).status,
    "pending",
  );
  f.db
    .prepare("UPDATE finance_movements SET status='rejected' WHERE id=?")
    .run(f.request.id);
  f.db.prepare("UPDATE finance_push_outbox SET next_attempt=0").run();
  await flushPaymentPush(f.db, {
    config,
    send: async () => {
      sent++;
    },
  });
  assert.equal(sent, 0);
  assert.equal(
    f.db.prepare("SELECT state FROM finance_push_outbox").get().state,
    "skipped",
  );
});
test("all unpaid requests remain in the payment queue even beyond recent-history sizes", () => {
  const requests = Array.from({ length: 1205 }, (_, i) => ({
    id: i + 1,
    business_id: "producalza",
    unit_id: null,
    space_id: null,
    created_by: "owner",
    status: "pending",
    amount_cents: 1000,
    is_payment_request: 1,
  }));
  const user = {
    id: 1,
    username: "owner",
    role: "owner",
    business_ids: ["producalza"],
    unit_ids: [],
  };
  const view = workflowView(
    { spaces: [], members: [], requests, payments: [] },
    user,
  );
  assert.equal(view.queue.length, 1205);
  assert.equal(view.requests.length, 1205);
  assert.equal(view.summary.pending_cents, 1205000);
});

test("phone alerts keep the right title and open loans or cards instead of payment requests", async () => {
  const handlers = new Map(),
    shown = [],
    visited = [];
  const self = {
    location: { origin: "https://example.test" },
    addEventListener: (type, fn) => handlers.set(type, fn),
    registration: {
      showNotification: async (title, options) =>
        shown.push({ title, ...options }),
    },
    clients: {
      matchAll: async () => [
        {
          url: "https://example.test/finanzas/",
          navigate: async (url) => visited.push(url),
          focus: async () => {},
        },
      ],
      openWindow: async (url) => visited.push(url),
    },
  };
  vm.runInNewContext(
    await readFile(
      new URL("../../frontend/public/finanzas/sw.js", import.meta.url),
      "utf8",
    ),
    { self, URL },
  );
  let done;
  handlers.get("push")({
    data: {
      json: () => ({
        title: "Aviso de préstamo",
        body: "Revisa su cuenta",
        url: "/finanzas/prestamos",
        tag: "gema-loan-alerts",
      }),
    },
    waitUntil: (p) => {
      done = p;
    },
  });
  await done;
  assert.equal(shown[0].title, "Aviso de préstamo");
  assert.equal(shown[0].tag, "gema-loan-alerts");
  handlers.get("notificationclick")({
    notification: { data: shown[0].data, close() {} },
    waitUntil: (p) => {
      done = p;
    },
  });
  await done;
  assert.equal(visited[0], "/finanzas/prestamos");
  handlers.get("push")({
    data: { json: () => ({ url: "https://attacker.invalid/" }) },
    waitUntil: (p) => {
      done = p;
    },
  });
  await done;
  assert.equal(shown[1].data.url, "/finanzas/pagos");
});


test("an expired push subscription does not falsely mark a pending alert delivered", async(t)=>{
  const f=fixture(t);
  await flushPaymentPush(f.db,{config:{enabled:true,publicKey:"test",privateKey:"test",subject:"mailto:test@example.invalid"},send:async()=>{throw Object.assign(new Error("expired"),{statusCode:410});}});
  assert.equal(f.db.prepare("SELECT count(*) n FROM finance_push_subscriptions").get().n,0);
  assert.equal(f.db.prepare("SELECT state FROM finance_push_outbox").get().state,"queued");
  assert.equal(f.db.prepare("SELECT status FROM finance_movements WHERE id=?").get(f.request.id).status,"pending");
});

test("push tests target only this member's device and record browser receipt separately from provider acceptance",async(t)=>{
  const f=fixture(t);
  const keys=generateVAPIDKeys(), previous={};
  for(const [key,value] of Object.entries({FINANCE_VAPID_PUBLIC_KEY:keys.publicKey,FINANCE_VAPID_PRIVATE_KEY:keys.privateKey,FINANCE_VAPID_SUBJECT:"mailto:test@example.invalid",FINANCE_DEMO:"0",NODE_ENV:"test"})) {previous[key]=process.env[key];process.env[key]=value;}
  t.after(()=>{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const app=express(); app.use(express.json());
  let member=f.user, sent=0;
  app.use((req,_res,next)=>{req.financeUser=member;next();});
  const route=(fn)=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next);
  registerPaymentPush(app,f.db,{route,send:async(_sub,payload)=>{sent++;assert.equal(JSON.parse(payload).tag,"gema-push-test");}});
  app.use((e,_q,r,_n)=>r.status(e.status||500).json({error:e.message}));
  const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}/api/finance/push`;
  const post=async(path,body)=>{const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const encrypted=f.db.prepare("SELECT encrypted FROM finance_push_subscriptions").get().encrypted;
  const {decryptDocument}=await import("../src/finance-ai.js");const sub=JSON.parse(decryptDocument(encrypted).toString());
  assert.equal((await post("/status",{endpoint:sub.endpoint})).body.registered,true);
  member={...f.user,id:f.user.id+100};
  assert.equal((await post("/test",{endpoint:sub.endpoint})).status,409);assert.equal(sent,0);
  member=f.user;
  const result=await post("/test",{endpoint:sub.endpoint});assert.equal(result.status,200);assert.equal(sent,1);
  let state=(await post("/status",{endpoint:sub.endpoint})).body.latest_test;
  assert.ok(state.accepted_at);assert.equal(state.displayed_at,null);
  member={...f.user,id:f.user.id+100};await post("/receipt",{id:result.body.id});
  assert.equal(f.db.prepare("SELECT displayed_at FROM finance_push_tests WHERE id=?").get(result.body.id).displayed_at,null);
  member=f.user;await post("/receipt",{id:result.body.id});
  state=(await post("/status",{endpoint:sub.endpoint})).body.latest_test;assert.ok(state.displayed_at);
  assert.equal((await post("/test",{endpoint:sub.endpoint})).status,429);
  member={...f.user,role:"collector",checks_manage:false};assert.equal((await post("/status",{endpoint:sub.endpoint})).status,403);
  member={...f.user,role:"manager",checks_manage:true};assert.equal((await post("/status",{endpoint:sub.endpoint})).status,200);
});
