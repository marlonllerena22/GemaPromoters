import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createMobilePreview } from "../scripts/finance-mobile-preview.mjs";

test("mobile preview serves synthetic data and blocks all operational mutations", async () => {
  const { app, db } = createMobilePreview();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(db.pragma("database_list")[0].file, "");
    assert.throws(() => db.prepare("DELETE FROM finance_accounts").run(), /readonly/);
    const session = await (await fetch(`${base}/api/finance/session`)).json();
    assert.equal(session.user.role, "viewer");
    assert.equal(session.public_preview, true);
    const response = await fetch(`${base}/api/finance/snapshot`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    const report = await response.json();
    assert.ok(report.accounts.length > 0);
    assert.equal(report.capabilities.public_preview, true);
    assert.equal(report.capabilities.ai, false);
    assert.equal(report.capabilities.upload, false);
    for (const [method, path] of [
      ["POST", "/movements"],
      ["POST", "/evidence"],
      ["POST", "/bank/import"],
      ["POST", "/integrations/alfabusiness"],
      ["POST", "/security/totp/start"],
      ["DELETE", "/movements/1"],
      ["GET", "/members"],
      ["GET", "/evidence/1"],
    ]) {
      const blocked = await fetch(`${base}/api/finance${path}`, { method });
      assert.equal(blocked.status, 403, `${method} ${path}`);
    }
    const after = await (await fetch(`${base}/api/finance/snapshot`)).json();
    assert.deepEqual(after.movements, report.movements);
    const csv = await fetch(`${base}/api/finance/export`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    const assistant = await fetch(`${base}/api/finance/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Resumen" }),
    });
    const answer = await assistant.json();
    assert.equal(answer.mode, "data");
    assert.match(answer.answer, /datos ficticios/);
    for (const path of ["/.env", "/backend/data/finance-demo.sqlite", "/api/orders"]) {
      const denied = await fetch(`${base}${path}`);
      assert.ok([403, 404].includes(denied.status), path);
    }
    const html = await fetch(`${base}/finanzas/`);
    assert.equal(html.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
