import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const backend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "gema-finance-smoke-"),
);
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const password = crypto.randomBytes(24).toString("base64url");
const child = spawn(process.execPath, ["src/server.js"], {
  cwd: backend,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    DB_PATH: path.join(directory, "smoke.sqlite"),
    FINANCE_ADMIN_USER: "smoke-owner",
    FINANCE_ADMIN_PASSWORD: password,
    FINANCE_DOCUMENT_KEY: crypto.randomBytes(32).toString("hex"),
    JWT_SECRET: crypto.randomBytes(32).toString("hex"),
    ADMIN_PASSWORD: password,
    SUPREME_PASSWORD: password,
    FINANCE_INTERNAL_SYNC_ENABLED: "0",
    OPENAI_API_KEY: "",
    PAYPHONE_TOKEN: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    FINANCE_DEMO: "0",
  },
});
let output = "";
child.stdout.on("data", (b) => {
  output = (output + b.toString()).slice(-6000);
});
child.stderr.on("data", (b) => {
  output = (output + b.toString()).slice(-6000);
});
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error("El servidor terminó durante el arranque");
    try {
      const r = await fetch(`${base}/api/finance/session`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(ready, true, "El servidor no inició a tiempo");
  const login = await fetch(`${base}/api/finance/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Finance-Request": "1" },
    body: JSON.stringify({ username: "smoke-owner", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = {
    Cookie: cookie,
    "X-Finance-Request": "1",
    "X-Finance-Interactive": "1",
    "Content-Type": "application/json",
  };
  const snapshot = await fetch(`${base}/api/finance/snapshot`, { headers });
  assert.equal(snapshot.status, 200);
  const payload = await snapshot.json();
  assert.equal(payload.capabilities.demo, false);
  assert.equal(payload.businesses.length, 4);
  const sync = await fetch(`${base}/api/finance/sync`, {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(sync.status, 200);
  assert.equal((await fetch(`${base}/api/finance/snapshot`)).status, 401);
  const html = await fetch(`${base}/finanzas/`);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("x-frame-options"), "DENY");
  assert.match(
    html.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal((await fetch(base)).status, 200);
  console.log(
    "Full-app smoke passed: clean database initialization, financial login, scoped snapshot, internal adapters, private routes, protected HTML and existing app shell.",
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  child.kill();
  if (child.exitCode === null)
    await new Promise((resolve) => child.once("exit", resolve));
  const resolved = path.resolve(directory),
    temporary = path.resolve(os.tmpdir()) + path.sep;
  if (
    !resolved.startsWith(temporary) ||
    !path.basename(resolved).startsWith("gema-finance-smoke-")
  )
    throw new Error("La limpieza temporal no pasó la validación de ruta");
  await fs.rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
