import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { audit, passwordHash, safeMember } from "./finance-db.js";
import { encryptDocument, decryptDocument } from "./finance-ai.js";
import { fail, text } from "./finance-service.js";
import { privateSetting, putPrivateSetting } from "./finance-operations.js";
import {
  ingestBankMessages,
  applyMailDraft,
  mailDrafts,
} from "./finance-gmail.js";
import { shiftDay } from "./finance-funding.js";
const tokenHash = (t) => crypto.createHash("sha256").update(t).digest("hex");
export function applyFinanceBootstrap(db) {
  if (!process.env.FINANCE_BOOTSTRAP_PAYLOAD) return { applied: false };
  const payload = process.env.FINANCE_BOOTSTRAP_PAYLOAD,
    decoded = decryptDocument(
      Buffer.from(payload.replace(/^gz:/, ""), "base64"),
    );
  const config = JSON.parse(
    (payload.startsWith("gz:")
      ? gunzipSync(decoded, { maxOutputLength: 2 * 1024 * 1024 })
      : decoded
    ).toString(),
  );
  if (
    !config.id ||
    !config.cutoff ||
    !Array.isArray(config.accounts) ||
    !Array.isArray(config.members)
  )
    throw new Error("Invalid private finance setup");
  if (privateSetting(db, "bootstrap_id")) return { applied: false };
  return db.transaction(() => {
    if (
      db.prepare("SELECT COUNT(*) n FROM finance_accounts").get().n ||
      db.prepare("SELECT COUNT(*) n FROM finance_movements").get().n
    )
      throw new Error("Private setup requires a fresh financial module");
    const owner = db
      .prepare("SELECT * FROM finance_members WHERE role='owner'")
      .get();
    if (!owner) throw new Error("Missing financial owner");
    for (const p of config.members) {
      let member = db
        .prepare("SELECT * FROM finance_members WHERE username=?")
        .get(p.username);
      if (!member) {
        const x = db
          .prepare(
            "INSERT INTO finance_members (name,username,password_hash,role,business_ids,unit_ids,work_view,request_payments,review_unit_ids,auto_confirm_unit_ids,custody_adjust,checks_manage,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)",
          )
          .run(
            p.name,
            p.username,
            passwordHash(crypto.randomBytes(32).toString("base64url")),
            p.role,
            JSON.stringify(p.business_ids),
            JSON.stringify(p.unit_ids || []),
            p.work_view ? 1 : 0,
            p.request_payments ? 1 : 0,
            JSON.stringify(p.review_unit_ids || []),
            JSON.stringify(p.auto_confirm_unit_ids || []),
            p.custody_adjust ? 1 : 0,
            p.checks_manage ? 1 : 0,
          );
        member = db
          .prepare("SELECT * FROM finance_members WHERE id=?")
          .get(x.lastInsertRowid);
      }
      if (p.username === owner.username)
        db.prepare("UPDATE finance_members SET active=0 WHERE id=?").run(
          member.id,
        );
      for (const space of p.spaces || [])
        db.prepare(
          "INSERT OR IGNORE INTO finance_space_members (space_id,member_id,role) VALUES (?,?,?)",
        ).run(
          space,
          member.id,
          p.username === "morelia"
            ? "coordinator"
            : p.request_payments || p.role !== "viewer"
              ? "requester"
              : "observer",
        );
      if (p.invite_hash)
        db.prepare(
          "INSERT INTO finance_member_invites (token_hash,member_id,expires_at,created_by) VALUES (?,?,?,?)",
        ).run(p.invite_hash, member.id, config.invite_expires_at, "bootstrap");
    }
    const registry = [];
    for (const a of config.accounts) {
      const result = db
        .prepare(
          "INSERT INTO finance_accounts (business_id,name,bank,kind,last_four,custodian,opening_cents,opening_date,opening_at,verified_cents,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          a.business_id || null,
          a.name,
          a.bank,
          a.kind || "bank",
          String(a.number || a.suffix || "").slice(-4),
          "Propietario",
          a.balance_cents,
          config.cutoff.slice(0, 10),
          a.opening_at || config.cutoff,
          a.balance_cents,
          a.opening_at || config.cutoff,
        );
      registry.push({ ...a, account_id: Number(result.lastInsertRowid) });
    }
    for (const c of config.checks || []) {
      const a = registry.find((a) => a.key === c.account_key);
      if (!a) throw new Error("Missing checking account");
      db.prepare(
        "INSERT INTO finance_checks (id,account_id,number,payee,amount_cents,due_day,fund_day,needs_review,review_note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        `initial-check:${c.number}`,
        a.account_id,
        String(c.number),
        c.payee,
        c.amount_cents,
        c.due_day,
        shiftDay(c.due_day, -2),
        c.needs_review ? 1 : 0,
        c.review_note || "",
        "bootstrap",
        config.cutoff,
        config.cutoff,
      );
    }
    for (const c of config.cards || []) {
      const a = registry.find((a) => a.key === c.account_key);
      db.prepare(
        "INSERT INTO finance_credit_cards (id,name,bank,debit_account_id,cut_day,due_day) VALUES (?,?,?,?,?,?)",
      ).run(c.id, c.name, c.bank, a?.account_id || null, c.cut_day, c.due_day);
    }
    putPrivateSetting(
      db,
      "opening_adjustments",
      config.opening_adjustments || [],
    );
    putPrivateSetting(
      db,
      "loan_source_warnings",
      (config.loans || []).flatMap((l) =>
        (l.source_warnings || []).map((w) => ({ loan_id: l.id, ...w })),
      ),
    );
    for (const loan of config.loans || []) {
      const account = registry.find((a) => a.key === loan.account_key);
      if (!account) throw new Error("Missing loan debit account");
      db.prepare("INSERT INTO finance_loans VALUES (?,?,?,?,?,?,?,?,?,?)").run(
        loan.id,
        loan.name,
        loan.bank,
        account.business_id || null,
        account.account_id,
        loan.operation_suffix,
        loan.principal_cents,
        loan.as_of,
        loan.source_hash,
        loan.variable_rate ? 1 : 0,
      );
      const insert = db.prepare(
        "INSERT INTO finance_loan_installments (loan_id,sequence,due_day,principal_cents,interest_cents,insurance_cents,other_cents,total_cents,remaining_principal_cents,status) VALUES (?,?,?,?,?,?,?,?,?,?)",
      );
      for (const i of loan.installments)
        insert.run(
          loan.id,
          i.sequence,
          i.due_day,
          i.principal_cents,
          i.interest_cents,
          i.insurance_cents,
          i.other_cents,
          i.total_cents,
          i.remaining_principal_cents,
          i.status,
        );
    }
    putPrivateSetting(db, "own_account_registry", {
      owner_name: config.owner_name,
      accounts: registry,
      unmapped: config.unmapped_accounts || [],
    });
    putPrivateSetting(db, "opening_cutoff", config.cutoff);
    putPrivateSetting(db, "mail_address", config.email);
    if (config.diners)
      db.prepare(
        "INSERT INTO finance_settlement_balances VALUES ('diners','marjorie',?,?,?,?,?)",
      ).run(
        config.diners.available_cents,
        config.diners.pending_cents,
        config.cutoff.slice(0, 10),
        "bootstrap",
        config.cutoff,
      );
    if (config.mail_examples?.length)
      ingestBankMessages(db, config.mail_examples);
    for (const action of config.confirmed_mail_actions || []) {
      const mail = mailDrafts(db).find((m) => m.id === action.mail_id);
      if (
        action.confirmed_by_owner !== true ||
        !mail ||
        mail.amount_cents !== action.expected_cents
      )
        throw new Error(
          "Assisted mail action requires an exact owner-confirmed amount",
        );
      applyMailDraft(
        db,
        { ...safeMember(owner), username: "assistant:owner-authorized" },
        action.mail_id,
        action.body,
      );
    }
    putPrivateSetting(db, "bootstrap_id", config.id);
    audit(
      db,
      "bootstrap",
      "finance.initialized",
      "configuration",
      config.id,
      null,
      {
        accounts: registry.length,
        members: config.members.length,
        cutoff: config.cutoff,
      },
    );
    return { applied: true };
  })();
}
export function registerPublicFinanceAccess(app, db, { route, startSession }) {
  const attempts = new Map();
  function invitation(req) {
    const ip = req.ip || req.socket.remoteAddress,
      now = Date.now(),
      recent = (attempts.get(ip) || []).filter((x) => x > now - 60000);
    if (recent.length >= 15) fail("Espera un momento antes de reintentar", 429);
    recent.push(now);
    attempts.set(ip, recent);
    if (attempts.size > 10000) attempts.clear();
    const token = req.body.token;
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(token))
      fail("Enlace de acceso no válido", 404);
    const i = db
      .prepare(
        "SELECT i.*,m.name,m.username,m.role,m.unit_ids,m.business_ids FROM finance_member_invites i JOIN finance_members m ON m.id=i.member_id WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
      )
      .get(tokenHash(token), now);
    if (!i)
      fail("Este enlace venció o ya fue utilizado. Pide un enlace nuevo", 404);
    return i;
  }
  app.post(
    "/api/finance/access/invite",
    route((req, res) => {
      const i = invitation(req);
      res.json({
        name: i.name,
        username: i.username,
        units: JSON.parse(i.unit_ids).map(
          (id) =>
            db.prepare("SELECT name FROM finance_units WHERE id=?").get(id)
              ?.name || id,
        ),
      });
    }),
  );
  app.post(
    "/api/finance/access/activate",
    route((req, res) => {
      const i = invitation(req);
      if (
        typeof req.body.password !== "string" ||
        req.body.password.length < 12 ||
        req.body.password.length > 256
      )
        fail("Usa una contraseña de al menos 12 caracteres");
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_members SET password_hash=?,active=1 WHERE id=?",
        ).run(passwordHash(req.body.password), i.member_id);
        db.prepare(
          "UPDATE finance_member_invites SET used_at=? WHERE member_id=? AND used_at IS NULL",
        ).run(new Date().toISOString(), i.member_id);
        db.prepare("DELETE FROM finance_sessions WHERE member_id=?").run(
          i.member_id,
        );
        audit(db, i.username, "member.activated", "member", i.member_id, null, {
          role: i.role,
        });
      })();
      const member = db
        .prepare("SELECT * FROM finance_members WHERE id=?")
        .get(i.member_id);
      // Recovery links must never bypass an existing second factor.
      res.json({
        user: member.mfa_enabled ? null : startSession(res, member),
        login_required: Boolean(member.mfa_enabled),
      });
    }),
  );
}
export function registerInviteManagement(app, db, { route, owner }) {
  app.post(
    "/api/finance/members/:id/invite",
    route((req, res) => {
      owner(req);
      const m = db
        .prepare("SELECT * FROM finance_members WHERE id=?")
        .get(req.params.id);
      if (!m) fail("Usuario no encontrado", 404);
      const token = crypto.randomBytes(32).toString("base64url"),
        expires = Date.now() + 7 * 86400000;
      db.transaction(() => {
        db.prepare(
          "DELETE FROM finance_member_invites WHERE member_id=? AND used_at IS NULL",
        ).run(m.id);
        db.prepare(
          "INSERT INTO finance_member_invites VALUES (?,?,?,NULL,?)",
        ).run(tokenHash(token), m.id, expires, req.financeUser.username);
        audit(
          db,
          req.financeUser.username,
          "member.invited",
          "member",
          m.id,
          null,
          { expires_at: expires },
        );
      })();
      res.json({ token, expires_at: expires });
    }),
  );
}
