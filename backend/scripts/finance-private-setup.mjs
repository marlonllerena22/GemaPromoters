// Windows-only private bootstrap preparation. No personal values belong in source.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { generateVAPIDKeys } from "web-push";
import { encryptDocument } from "../src/finance-ai.js";
import { initFinanceDb } from "../src/finance-db.js";
import { applyFinanceBootstrap } from "../src/finance-onboarding.js";
import { PROFILE_TEMPLATES } from "../../shared/finance-workflow.mjs";
const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data",
);
function protect(value) {
  const r = spawnSync(
    "pwsh.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop';$value=[Console]::In.ReadToEnd();$bytes=[Text.Encoding]::UTF8.GetBytes($value);$encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write('dpapi-bytes-v1:'+ [Convert]::ToBase64String($encrypted))",
    ],
    {
      input: JSON.stringify(value),
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (r.status !== 0) throw new Error("Windows private storage unavailable");
  return r.stdout.trim();
}
function unprotect(file) {
  const r = spawnSync(
    "pwsh.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$cipher=(Get-Content -LiteralPath $env:GEMA_PRIVATE_FILE -Raw).Trim();if($cipher.StartsWith('dpapi-bytes-v1:')){$bytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($cipher.Substring(15)),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Text.Encoding]::UTF8.GetString($bytes))}else{$secure=ConvertTo-SecureString $cipher;[Console]::Write((New-Object System.Net.NetworkCredential('', $secure)).Password)}",
    ],
    {
      env: { ...process.env, GEMA_PRIVATE_FILE: file },
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (r.status !== 0) throw new Error("Cannot open private setup");
  return JSON.parse(r.stdout.trim());
}
const input = unprotect(path.join(dir, "finance-bootstrap-input.dpapi"));
const old = fs.existsSync(path.join(dir, "finance-activation-pack.dpapi"))
  ? unprotect(path.join(dir, "finance-activation-pack.dpapi"))
  : null;
if (old && !process.argv.includes("--rebuild"))
  throw new Error(
    "Private activation pack already exists; use explicit --rebuild before deployment only",
  );
const docKey =
    old?.environment?.FINANCE_DOCUMENT_KEY ||
    crypto.randomBytes(48).toString("base64url"),
  vapid = generateVAPIDKeys();
const env = {
  FINANCE_DOCUMENT_KEY: docKey,
  FINANCE_ADMIN_USER: "marlon",
  FINANCE_ADMIN_NAME: "Marlon",
  FINANCE_ADMIN_PASSWORD: crypto.randomBytes(48).toString("base64url"),
  FINANCE_INTERNAL_SYNC_ENABLED: "1",
  FINANCE_VAPID_PUBLIC_KEY: vapid.publicKey,
  FINANCE_VAPID_PRIVATE_KEY: vapid.privateKey,
  FINANCE_VAPID_SUBJECT: `mailto:${input.email}`,
  FINANCE_GMAIL_ADDRESS: input.email,
  FINANCE_GMAIL_REDIRECT_URI: `${input.origin}/api/finance/integrations/gmail/callback`,
};
process.env.FINANCE_DOCUMENT_KEY = docKey;
const links = [],
  members = [
    {
      id: "marlon",
      name: "Marlon",
      role: "owner",
      business_ids: ["producalza", "marjorie", "gemashow", "personal"],
      spaces: [],
    },
    ...PROFILE_TEMPLATES,
  ].map((p) => {
    const token = crypto.randomBytes(32).toString("base64url");
    links.push({
      username: p.id,
      name: p.name,
      url: `${input.origin}/finanzas/activar#invite=${token}`,
    });
    return {
      ...p,
      username: p.id,
      unit_ids:
        p.unit_ids ||
        (["ana", "jose", "norma"].includes(p.id) ? ["producalza-fabrica"] : []),
      invite_hash: crypto.createHash("sha256").update(token).digest("hex"),
    };
  });
const config = {
  ...input,
  members,
  id: "private-finance-start-v1",
  invite_expires_at: Date.now() + 7 * 86400000,
  loans: JSON.parse(
    fs.readFileSync(
      path.join(dir, "loan-read/verified-schedules.json"),
      "utf8",
    ),
  ),
};
env.FINANCE_BOOTSTRAP_PAYLOAD =
  "gz:" +
  encryptDocument(gzipSync(Buffer.from(JSON.stringify(config)))).toString(
    "base64",
  );
Object.assign(process.env, env);
const db = new Database(":memory:");
db.pragma("foreign_keys=ON");
initFinanceDb(db);
applyFinanceBootstrap(db);
applyFinanceBootstrap(db);
const counts = {
  accounts: db.prepare("SELECT COUNT(*) n FROM finance_accounts").get().n,
  members: db.prepare("SELECT COUNT(*) n FROM finance_members").get().n,
  checks: db.prepare("SELECT COUNT(*) n FROM finance_checks").get().n,
  loans: db.prepare("SELECT COUNT(*) n FROM finance_loans").get().n,
  installments: db
    .prepare("SELECT COUNT(*) n FROM finance_loan_installments")
    .get().n,
  mail: db.prepare("SELECT COUNT(*) n FROM finance_mail_messages").get().n,
};
db.close();
fs.writeFileSync(
  path.join(dir, "finance-activation-pack.dpapi"),
  protect({
    environment: env,
    links,
    counts,
    created_at: new Date().toISOString(),
  }),
);
console.log(
  JSON.stringify({
    validated: true,
    counts,
    encrypted_payload_bytes: env.FINANCE_BOOTSTRAP_PAYLOAD.length,
    private_pack: "backend/data/finance-activation-pack.dpapi",
  }),
);
