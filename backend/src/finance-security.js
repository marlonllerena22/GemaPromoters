import crypto from "node:crypto";
import QRCode from "qrcode";
import { audit, passwordHash, passwordMatches, validateFinancePassword } from "./finance-db.js";
import { decryptDocument, encryptDocument } from "./finance-ai.js";
import { fail, text } from "./finance-service.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function encodeBase32(buffer) {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decodeBase32(secret) {
  let value = 0,
    bits = 0;
  const bytes = [];
  for (const char of secret) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid TOTP secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function totp(secret, at = Date.now(), digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hash = crypto
    .createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest();
  const offset = hash.at(-1) & 15;
  return String(
    (hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, "0");
}
const recoveryHash = (member, code) =>
  crypto
    .createHash("sha256")
    .update(
      `${member}:${code.toUpperCase().replaceAll("-", "").replaceAll(" ", "")}`,
    )
    .digest("hex");
export function validTotpStep(secret, code, lastStep = -1, at = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ""))) return null;
  for (const delta of [0, -1, 1]) {
    const step = Math.floor(at / 30_000) + delta;
    if (step <= lastStep) continue;
    const expected = Buffer.from(totp(secret, step * 30_000));
    const actual = Buffer.from(String(code));
    if (crypto.timingSafeEqual(expected, actual)) return step;
  }
  return null;
}
export function verifySecondFactor(db, member, code) {
  if (!member.mfa_enabled) return true;
  const normalized = text(code, 50).replaceAll(" ", "");
  if (/^[a-fA-F0-9-]{16,19}$/.test(normalized)) {
    const hash = recoveryHash(member.id, normalized);
    const result = db
      .prepare(
        "UPDATE finance_recovery_codes SET used_at=? WHERE member_id=? AND hash=? AND used_at IS NULL",
      )
      .run(new Date().toISOString(), member.id, hash);
    if (result.changes) {
      audit(db, member.username, "security.recovery_used", "member", member.id);
      return true;
    }
    return false;
  }
  const secret = decryptDocument(member.mfa_secret).toString("utf8");
  const step = validTotpStep(secret, normalized, member.last_totp_step);
  if (step === null) return false;
  db.prepare("UPDATE finance_members SET last_totp_step=? WHERE id=?").run(
    step,
    member.id,
  );
  return true;
}

export function registerFinanceSecurity(app, db, { route, sessionToken }) {
  const attempts = new Map();
  app.use(
    "/api/finance/security",
    route((req, _res, next) => {
      if (req.method === "POST") {
        const key = req.financeUser.id;
        const recent = (attempts.get(key) || []).filter(
          (t) => Date.now() - t < 15 * 60 * 1000,
        );
        if (recent.length >= 12)
          fail("Espera 15 minutos antes de otro cambio de seguridad", 429);
        recent.push(Date.now());
        attempts.set(key, recent);
      }
      next();
    }),
  );
  const reauthenticate = (req) => {
    const member = db
      .prepare("SELECT * FROM finance_members WHERE id=?")
      .get(req.financeUser.id);
    if (!passwordMatches(req.body.password, member.password_hash))
      fail("La contraseña actual no es correcta", 401);
    if (member.mfa_enabled && !verifySecondFactor(db, member, req.body.code))
      fail("Código de autenticación no válido o ya utilizado", 401);
    return member;
  };
  app.get(
    "/api/finance/security",
    route((req, res) => {
      const member = db
        .prepare("SELECT * FROM finance_members WHERE id=?")
        .get(req.financeUser.id);
      const current = crypto
        .createHash("sha256")
        .update(sessionToken(req))
        .digest("hex");
      res.json({
        mfa_enabled: Boolean(member.mfa_enabled),
        recovery_remaining: db
          .prepare(
            "SELECT COUNT(*) n FROM finance_recovery_codes WHERE member_id=? AND used_at IS NULL",
          )
          .get(member.id).n,
        sessions: db
          .prepare(
            "SELECT token_hash,created_at,last_seen,expires_at FROM finance_sessions WHERE member_id=? AND expires_at>? ORDER BY created_at DESC",
          )
          .all(member.id, Date.now())
          .map((s) => ({ ...s, current: s.token_hash === current })),
      });
    }),
  );
  app.post(
    "/api/finance/security/totp/start",
    route(async (req, res) => {
      const member = reauthenticate(req);
      if (member.mfa_enabled)
        fail("La verificación en dos pasos ya está activa", 409);
      const secret = encodeBase32(crypto.randomBytes(20));
      const encrypted = encryptDocument(Buffer.from(secret));
      const uri = `otpauth://totp/${encodeURIComponent(`Gema Finanzas:${member.username}`)}?secret=${secret}&issuer=Gema%20Finanzas&algorithm=SHA1&digits=6&period=30`;
      const qr = await QRCode.toDataURL(uri, { width: 230, margin: 2 });
      db.prepare(
        "UPDATE finance_members SET mfa_pending_secret=?,mfa_pending_at=? WHERE id=?",
      ).run(encrypted, Date.now(), member.id);
      res.json({ secret, qr });
    }),
  );
  app.post(
    "/api/finance/security/totp/confirm",
    route((req, res) => {
      const member = db
        .prepare("SELECT * FROM finance_members WHERE id=?")
        .get(req.financeUser.id);
      if (
        member.mfa_enabled ||
        !member.mfa_pending_secret ||
        Date.now() - member.mfa_pending_at > 10 * 60 * 1000
      )
        fail("La configuración expiró. Inicia de nuevo.", 409);
      const secret = decryptDocument(member.mfa_pending_secret).toString(
        "utf8",
      );
      const step = validTotpStep(secret, req.body.code);
      if (step === null) fail("El código de la aplicación no es válido");
      const codes = Array.from({ length: 8 }, () =>
        crypto
          .randomBytes(8)
          .toString("hex")
          .toUpperCase()
          .match(/.{4}/g)
          .join("-"),
      );
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_members SET mfa_secret=mfa_pending_secret,mfa_enabled=1,mfa_pending_secret=NULL,mfa_pending_at=NULL,last_totp_step=? WHERE id=?",
        ).run(step, member.id);
        db.prepare("DELETE FROM finance_recovery_codes WHERE member_id=?").run(
          member.id,
        );
        for (const code of codes)
          db.prepare(
            "INSERT INTO finance_recovery_codes (member_id,hash) VALUES (?,?)",
          ).run(member.id, recoveryHash(member.id, code));
        const current = crypto
          .createHash("sha256")
          .update(sessionToken(req))
          .digest("hex");
        db.prepare(
          "DELETE FROM finance_sessions WHERE member_id=? AND token_hash<>?",
        ).run(member.id, current);
        audit(db, member.username, "security.mfa_enabled", "member", member.id);
      })();
      res.json({ recovery_codes: codes });
    }),
  );
  app.post(
    "/api/finance/security/password",
    route((req, res) => {
      const member = reauthenticate(req);
      const hash = passwordHash(validateFinancePassword(req.body.new_password));
      const current = crypto
        .createHash("sha256")
        .update(sessionToken(req))
        .digest("hex");
      db.transaction(() => {
        db.prepare("UPDATE finance_members SET password_hash=? WHERE id=?").run(
          hash,
          member.id,
        );
        db.prepare(
          "DELETE FROM finance_sessions WHERE member_id=? AND token_hash<>?",
        ).run(member.id, current);
        audit(
          db,
          member.username,
          "security.password_changed",
          "member",
          member.id,
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/security/totp/reset",
    route((req, res) => {
      const member = reauthenticate(req);
      if (!member.mfa_enabled) fail("No hay un autenticador activo");
      const current = crypto
        .createHash("sha256")
        .update(sessionToken(req))
        .digest("hex");
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_members SET mfa_enabled=0,mfa_secret=NULL,mfa_pending_secret=NULL,mfa_pending_at=NULL,last_totp_step=-1 WHERE id=?",
        ).run(member.id);
        db.prepare("DELETE FROM finance_recovery_codes WHERE member_id=?").run(
          member.id,
        );
        db.prepare(
          "DELETE FROM finance_sessions WHERE member_id=? AND token_hash<>?",
        ).run(member.id, current);
        audit(db, member.username, "security.mfa_reset", "member", member.id);
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/security/sessions/revoke",
    route((req, res) => {
      const current = crypto
        .createHash("sha256")
        .update(sessionToken(req))
        .digest("hex");
      db.transaction(() => {
        db.prepare(
          "DELETE FROM finance_sessions WHERE member_id=? AND token_hash<>?",
        ).run(req.financeUser.id, current);
        audit(
          db,
          req.financeUser.username,
          "security.sessions_revoked",
          "member",
          req.financeUser.id,
        );
      })();
      res.json({ ok: true });
    }),
  );
}
