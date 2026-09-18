import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { createToken, requireAuth } from './auth.js';

const GENERIC_MESSAGE = 'Si la cuenta tiene un correo registrado, recibirás una contraseña temporal. Revisa también la carpeta de spam.';

const clean = (value, max = 180) => String(value || '').trim().slice(0, max);
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
})[character]);

export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const random = (length) => Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `${random(4)}-${random(4)}`;
}

export function hashRecoveryPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyRecoveryPassword(password, stored) {
  const [, salt, expected] = String(stored || '').split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function transporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendTemporaryPasswordEmail(account, temporaryPassword) {
  const mailer = transporter();
  if (!mailer) throw new Error('El envío por correo no está configurado');
  const publicUrl = String(process.env.PUBLIC_APP_URL || 'https://www.promotersec.com').replace(/\/$/, '');
  const accountName = account.name || account.username || 'usuario';
  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: account.email,
    subject: 'Tu contraseña temporal de PROMOTERS',
    text: `Hola ${accountName},\n\nSolicitaste recuperar el acceso a PROMOTERS.\n\nUsuario: ${account.username}\nContraseña temporal: ${temporaryPassword}\n\nIngresa en ${publicUrl}\n\nEsta contraseña vence en 30 minutos. Al ingresar tendrás que crear una contraseña nueva. Si no solicitaste este cambio, comunícate con la administración.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#f5f3fb;padding:28px;color:#1b1830">
      <div style="background:#171426;color:#fff;padding:22px;border-radius:12px"><strong style="font-size:24px">PROMOTERS</strong><p style="margin:7px 0 0;color:#cfc8e7">Recuperación de acceso</p></div>
      <p style="margin:28px 0 10px">Hola <strong>${escapeHtml(accountName)}</strong>,</p>
      <p>Usa estos datos para ingresar:</p>
      <div style="background:#fff;border:1px solid #ded8ef;padding:18px;border-radius:10px">
        <p><strong>Usuario:</strong> ${escapeHtml(account.username)}</p>
        <p><strong>Contraseña temporal:</strong> <span style="font-size:20px;letter-spacing:1px">${escapeHtml(temporaryPassword)}</span></p>
      </div>
      <p style="margin:25px 0"><a href="${escapeHtml(publicUrl)}" style="display:inline-block;background:#7d55db;color:#fff;padding:13px 20px;border-radius:9px;text-decoration:none;font-weight:700">Ingresar a PROMOTERS</a></p>
      <p style="font-size:13px;color:#6f6a7f">La contraseña temporal vence en 30 minutos. Al ingresar será obligatorio crear una contraseña nueva.</p>
      <p style="font-size:12px;color:#8b8795">Si no solicitaste este cambio, comunícate con la administración.</p>
    </div>`
  });
}

function findRecoveryAccount(db, identifier) {
  const lookup = clean(identifier).toLowerCase();
  if (!lookup) return null;

  const establishment = db.prepare(`SELECT id, display_name AS name, admin_username AS username, admin_email AS email,
      admin_password_recovery_requested_at AS requested_at
    FROM establishments
    WHERE status = 'active' AND (LOWER(admin_username) = ? OR LOWER(admin_email) = ?)
    LIMIT 1`).get(lookup, lookup);
  if (establishment?.email && validEmail(establishment.email)) return { ...establishment, type: 'establishment' };

  const promoter = db.prepare(`SELECT id, name, COALESCE(NULLIF(username, ''), code) AS username, email,
      password_recovery_requested_at AS requested_at
    FROM promoters
    WHERE deleted_at IS NULL AND status = 'active'
      AND (LOWER(COALESCE(username, '')) = ? OR LOWER(COALESCE(email, '')) = ? OR LOWER(code) = ?)
    LIMIT 1`).get(lookup, lookup, lookup);
  if (promoter?.email && validEmail(promoter.email)) return { ...promoter, type: 'promoter' };

  const marjorieAdmin = db.prepare(`SELECT id, name, username, email,
      password_recovery_requested_at AS requested_at
    FROM marjorie_admin_users
    WHERE status = 'active' AND (LOWER(username) = ? OR LOWER(COALESCE(email, '')) = ?)
    LIMIT 1`).get(lookup, lookup);
  if (marjorieAdmin?.email && validEmail(marjorieAdmin.email)) return { ...marjorieAdmin, type: 'marjorie_admin' };

  const marjorie = db.prepare(`SELECT id, name, COALESCE(NULLIF(code, ''), email) AS username, email,
      password_recovery_requested_at AS requested_at
    FROM marjorie_promoters
    WHERE status NOT IN ('rejected', 'revoked') AND (LOWER(email) = ? OR LOWER(COALESCE(code, '')) = ?)
    LIMIT 1`).get(lookup, lookup);
  if (marjorie?.email && validEmail(marjorie.email)) return { ...marjorie, type: 'marjorie_promoter' };
  return null;
}

function requestedRecently(db, value) {
  if (!value) return false;
  return Boolean(db.prepare("SELECT datetime(?) > datetime('now', '-2 minutes') AS recent").get(value)?.recent);
}

function saveTemporaryPassword(db, account, temporaryPassword) {
  if (account.type === 'establishment') {
    db.prepare(`UPDATE establishments SET admin_password = ?, admin_must_change_password = 1,
      admin_temp_password_expires_at = datetime('now', '+30 minutes'), admin_password_recovery_requested_at = datetime('now')
      WHERE id = ?`).run(temporaryPassword, account.id);
    return;
  }
  if (account.type === 'promoter') {
    db.prepare(`UPDATE promoters SET password = ?, must_change_password = 1,
      temp_password_expires_at = datetime('now', '+30 minutes'), password_recovery_requested_at = datetime('now')
      WHERE id = ?`).run(temporaryPassword, account.id);
    return;
  }
  if (account.type === 'marjorie_admin') {
    db.prepare(`UPDATE marjorie_admin_users SET password_hash = ?, must_change_password = 1,
      temp_password_expires_at = datetime('now', '+30 minutes'), password_recovery_requested_at = datetime('now'),
      updated_at = datetime('now','localtime') WHERE id = ?`).run(hashRecoveryPassword(temporaryPassword), account.id);
    return;
  }
  db.prepare(`UPDATE marjorie_promoters SET password_hash = ?, must_change_password = 1,
    temp_password_expires_at = datetime('now', '+30 minutes'), password_recovery_requested_at = datetime('now'),
    updated_at = datetime('now','localtime') WHERE id = ?`).run(hashRecoveryPassword(temporaryPassword), account.id);
}

function completePasswordChange(db, claims, newPassword) {
  if (claims.passwordAccountType === 'establishment' && claims.establishmentId) {
    return db.prepare(`UPDATE establishments SET admin_password = ?, admin_must_change_password = 0,
      admin_temp_password_expires_at = NULL WHERE id = ? AND admin_must_change_password = 1`)
      .run(newPassword, claims.establishmentId).changes;
  }
  if (claims.passwordAccountType === 'promoter' && claims.promoterId) {
    return db.prepare(`UPDATE promoters SET password = ?, must_change_password = 0,
      temp_password_expires_at = NULL WHERE id = ? AND must_change_password = 1`)
      .run(newPassword, claims.promoterId).changes;
  }
  if (claims.passwordAccountType === 'marjorie_promoter' && claims.marjoriePromoterId) {
    return db.prepare(`UPDATE marjorie_promoters SET password_hash = ?, must_change_password = 0,
      temp_password_expires_at = NULL, updated_at = datetime('now','localtime')
      WHERE id = ? AND must_change_password = 1`)
      .run(hashRecoveryPassword(newPassword), claims.marjoriePromoterId).changes;
  }
  if (claims.passwordAccountType === 'marjorie_admin' && claims.marjorieAdminId) {
    return db.prepare(`UPDATE marjorie_admin_users SET password_hash = ?, must_change_password = 0,
      temp_password_expires_at = NULL, updated_at = datetime('now','localtime')
      WHERE id = ? AND must_change_password = 1`)
      .run(hashRecoveryPassword(newPassword), claims.marjorieAdminId).changes;
  }
  return 0;
}

export function registerAuthRecoveryRoutes(app, db, options = {}) {
  const deliverTemporaryPassword = options.sendTemporaryPassword || sendTemporaryPasswordEmail;

  app.post('/api/auth/forgot-password', async (req, res) => {
    const identifier = clean(req.body.identifier);
    if (!identifier) return res.status(400).json({ message: 'Ingresa tu usuario o correo' });
    const account = findRecoveryAccount(db, identifier);
    if (!account || requestedRecently(db, account.requested_at)) return res.json({ message: GENERIC_MESSAGE });

    const temporaryPassword = generateTemporaryPassword();
    try {
      await deliverTemporaryPassword(account, temporaryPassword);
      saveTemporaryPassword(db, account, temporaryPassword);
      return res.json({ message: GENERIC_MESSAGE });
    } catch (error) {
      console.error('[auth-recovery] email failed:', error.message);
      return res.status(503).json({ message: 'No pudimos enviar el correo en este momento. Intenta nuevamente en unos minutos.' });
    }
  });

  app.post('/api/auth/change-temporary-password', requireAuth, (req, res) => {
    if (!req.user?.mustChangePassword) return res.status(409).json({ message: 'Esta cuenta no tiene un cambio de contraseña pendiente' });
    const newPassword = String(req.body.new_password || '');
    if (newPassword.length < 8) return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres' });
    if (!completePasswordChange(db, req.user, newPassword)) return res.status(409).json({ message: 'La contraseña temporal ya no está activa. Solicita una nueva.' });
    const { iat: _issuedAt, exp: _expiresAt, mustChangePassword: _mustChange, ...claims } = req.user;
    return res.json({
      token: createToken({ ...claims, mustChangePassword: false }),
      user: { must_change_password: false }
    });
  });
}
