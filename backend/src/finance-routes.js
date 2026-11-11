import { applyPrivateBankReview } from "./finance-bank-review.js";
import { financeSupportCheck } from "./finance-support-check.js";
import {updateConfirmedBalance} from './finance-balance-updates.js';
import {archiveBankPromotions} from './finance-bank-inbox.js';
import {uploadConversationPhoto} from "./finance-conversation-photos.js";
import {cancelsConversation} from '../../shared/finance-conversation.mjs';
import {suggestOriginAccount} from "./finance-origin-account.js";
import {marjorieIntegrationHealth} from "./finance-integration-health.js";
import {normalizeAlfaBusinessSale} from './finance-alfabusiness.js';
import {registerReceiptRoutes,suggestReceivingAccount,repairReceiptAccounts,activateReceiptCredits,confirmReceiptDeposit} from './finance-receipts.js';
import {applyNovemberCleanup,archiveNovemberTrialReceipt,clearCurrentActivity,repairKnownAccountNumbers} from './finance-start-clean.js';
import {registerNotificationPublic,registerNotificationRoutes,reprocessBankNotifications} from "./finance-bank-notifications.js";
import {createBankMailCorroborator} from './finance-bank-mail-corroboration.js';
import { assistantFilters, sourcedAnswer } from "./finance-assistant.js";
import { canUseFinanceAssistant } from "../../shared/finance-workflow.mjs";
import crypto from "node:crypto";
import { registerFundingRoutes } from "./finance-funding.js";
import { registerLoanRoutes } from "./finance-loans.js";
import { registerGmailPublic, registerGmailRoutes,syncGmail } from "./finance-gmail.js";
import {
  applyFinanceBootstrap,
  registerPublicFinanceAccess,
  registerInviteManagement,
} from "./finance-onboarding.js";
import {
  attachOperations,
  registerOperationsRoutes,
} from "./finance-operations.js";
import { registerQuickEntry } from "./finance-quick.js";
import { prepareConversation, confirmConversation, cancelConversation,reviseConversation } from "./finance-conversation.js";
import { attachWorkflow } from "./finance-workflow.js";
import {
  registerWorkflowRoutes,
  assignSpaceMemberships,
} from "./finance-workflow-routes.js";
import { registerPaymentPush } from "./finance-push.js";
import {
  audit,
  cents,
  financeDay,
  initFinanceDb,
  passwordHash,
  validateFinancePassword,
  passwordMatches,
  safeMember,
  validDay,
} from "./finance-db.js";
import {
  businessAccess,
  closingFigures,
  createMovement,
  csvExport,
  fail,
  importBank,
  importSale,
  isManager,
  reconcile,
  requireRow,
  scoped,
  snapshot,
  text,
  unitAccess,
} from "./finance-service.js";
import {
  analyzeDocument,
  analyzeBankDetails,
  answerQuestion,
  decryptDocument,
  encryptDocument,
  validateDocument,
} from "./finance-ai.js";
import {
  productionOrders,
  startFinanceSyncWorker,
  syncInternalSources,
} from "./finance-sources.js";
import {
  registerFinanceSecurity,
  verifySecondFactor,
} from "./finance-security.js";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");
const localHost = (req) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) &&
  ["localhost", "127.0.0.1", "[::1]"].includes(req.hostname);

export function registerFinanceRoutes(app, db, bridges = {}) {
  initFinanceDb(db);
  applyFinanceBootstrap(db);
  activateReceiptCredits(db);
  applyNovemberCleanup(db);
  archiveNovemberTrialReceipt(db);
  clearCurrentActivity(db);
  repairKnownAccountNumbers(db);
  archiveBankPromotions(db);
  repairReceiptAccounts(db);
  applyPrivateBankReview(db);
  setImmediate(()=>financeSupportCheck(db));
  if(process.env.NODE_ENV!=="test")console.info("[finance] Marjorie integration health "+JSON.stringify(marjorieIntegrationHealth(db)));
  startFinanceSyncWorker(db);
  const loginAttempts = new Map();
  const aiAttempts = new Map();
  app.use("/finanzas", (_req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("X-Frame-Options", "DENY");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  const route = (fn) => async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      if (!error.status) console.error("[finance]", error.code || error.name);
      res.status(error.status || 500).json({
        message: error.status
          ? error.message
          : "No se pudo completar la operación. Tus datos existentes se conservan.",
        ...(error.code === "MFA_REQUIRED" ? { code: error.code } : {}),
      });
    }
  };
  const manager = (req) => {
    if (!isManager(req.financeUser))
      fail("Esta acción requiere un administrador financiero", 403);
  };
  const owner = (req) => {
    if (req.financeUser.role !== "owner")
      fail("Esta acción requiere al propietario", 403);
  };
  const writer = (req) => {
    if (req.financeUser.role === "viewer")
      fail("Tu acceso es de consulta", 403);
  };
  const sessionToken = (req) => {
    const cookie = String(req.headers.cookie || "")
      .split(";")
      .find((x) => x.trim().startsWith("gema_finance_session="));
    return cookie ? cookie.trim().slice("gema_finance_session=".length) : "";
  };
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/finance",
    maxAge: 12 * 60 * 60 * 1000,
  };
  const startSession = (res, member, { remember = false } = {}) => {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now(),
      duration = (remember ? 30 * 24 : 12) * 60 * 60 * 1000;
    db.prepare("DELETE FROM finance_sessions WHERE expires_at<?").run(now);
    db.prepare(
      "INSERT INTO finance_sessions (token_hash,member_id,expires_at,created_at,last_seen,remembered) VALUES (?,?,?,?,?,?)",
    ).run(
      hashToken(token),
      member.id,
      now + duration,
      now,
      now,
      remember ? 1 : 0,
    );
    res.cookie("gema_finance_session", token, {
      ...cookieOptions,
      maxAge: duration,
    });
    return safeMember(member);
  };
  app.use(
    "/api/finance",
    route((req, res, next) => {
      res.set("Cache-Control", "no-store");
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Referrer-Policy", "same-origin");
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.path !== "/integrations/alfabusiness"
      ) {
        if (req.get("x-finance-request") !== "1")
          fail("Solicitud no válida", 403);
        const origin = req.get("origin");
        if (origin) {
          let parsed;
          try {
            parsed = new URL(origin);
          } catch {
            fail("Origen inválido", 403);
          }
          const expectedHost = req.get("host");
          const allowed =
            parsed.host === expectedHost ||
            (process.env.NODE_ENV !== "production" &&
              parsed.hostname === req.hostname);
          if (!allowed) fail("Origen no permitido", 403);
        }
      }
      next();
    }),
  );

  app.get(
    "/api/finance/session",
    route((req, res) => {
      const token = sessionToken(req);
      const member =
        token &&
        db
          .prepare(
            `SELECT m.*,s.remembered FROM finance_members m JOIN finance_sessions s ON s.member_id=m.id WHERE s.token_hash=? AND s.expires_at>? AND m.active=1`,
          )
          .get(hashToken(token), Date.now());
      res.json({
        user: member ? safeMember(member) : null,
        remember_device: Boolean(member?.remembered),
        configured: Boolean(
          db.prepare("SELECT id FROM finance_members WHERE role='owner'").get(),
        ),
        demo:
          process.env.FINANCE_DEMO === "1" &&
          process.env.NODE_ENV !== "production" &&
          localHost(req),
      });
    }),
  );

  app.post(
    "/api/finance/login",
    route((req, res) => {
      const key = req.socket.remoteAddress;
      const recent = (loginAttempts.get(key) || []).filter(
        (t) => Date.now() - t < 15 * 60 * 1000,
      );
      if (recent.length >= 10)
        fail(
          "Demasiados intentos. Espera 15 minutos antes de reintentar.",
          429,
        );
      recent.push(Date.now());
      loginAttempts.set(key, recent);
      if (loginAttempts.size > 10000)
        for (const [k, v] of loginAttempts)
          if (v.every((t) => Date.now() - t > 15 * 60 * 1000))
            loginAttempts.delete(k);
      const username = text(req.body.username, 100);
      const canonicalUsername = username
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      const member =
        db
          .prepare(
            "SELECT * FROM finance_members WHERE username=? AND active=1",
          )
          .get(username) ||
        db
          .prepare(
            "SELECT * FROM finance_members WHERE username=? AND active=1",
          )
          .get(canonicalUsername);
      const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
      const valid = passwordMatches(
        req.body.password,
        member?.password_hash || dummy,
      );
      if (!member || !valid) fail("Usuario o contraseña incorrectos", 401);
      if (member.mfa_enabled && !req.body.code)
        throw Object.assign(
          new Error(
            "Ingresa el código de tu aplicación de autenticación o un código de recuperación",
          ),
          { status: 401, code: "MFA_REQUIRED" },
        );
      if (member.mfa_enabled && !verifySecondFactor(db, member, req.body.code))
        fail("Código de autenticación no válido o ya utilizado", 401);
      loginAttempts.delete(key);
      audit(db, member.username, "session.started", "member", member.id);
      res.json({
        user: startSession(res, member, {
          remember: req.body.remember === true,
        }),
      });
    }),
  );

  app.post(
    "/api/finance/demo",
    route((req, res) => {
      if (
        process.env.FINANCE_DEMO !== "1" ||
        process.env.NODE_ENV === "production" ||
        !localHost(req)
      )
        fail("No encontrado", 404);
      const member = db
        .prepare(
          "SELECT * FROM finance_members WHERE username='demo' AND active=1",
        )
        .get();
      if (!member) fail("La demostración no está preparada", 503);
      res.json({ user: startSession(res, member) });
    }),
  );

  registerPublicFinanceAccess(app, db, { route, startSession });
  registerGmailPublic(app, db, { route });
  const requestMailCorroboration=createBankMailCorroborator(db,{syncMail:()=>syncGmail(db),matchNotifications:()=>reprocessBankNotifications(db)});
  registerNotificationPublic(app, db, { route,requestMailCorroboration });
  app.use(
    "/api/finance",
    route((req, res, next) => {
      const token = sessionToken(req);
      const member =
        token &&
        db
          .prepare(
            `SELECT m.*,s.last_seen,s.remembered FROM finance_members m JOIN finance_sessions s ON s.member_id=m.id
      WHERE s.token_hash=? AND s.expires_at>? AND m.active=1`,
          )
          .get(hashToken(token), Date.now());
      // Signed server-to-server deliveries use their own authentication below.
      if (req.path === "/integrations/alfabusiness") return next();
      if (!member) fail("Inicia sesión para continuar", 401);
      if (
        !member.remembered &&
        Date.now() - member.last_seen > 30 * 60 * 1000
      ) {
        db.prepare("DELETE FROM finance_sessions WHERE token_hash=?").run(
          hashToken(token),
        );
        fail("La sesión se cerró por inactividad", 401);
      }
      if (req.get("x-finance-interactive") === "1")
        db.prepare(
          "UPDATE finance_sessions SET last_seen=? WHERE token_hash=?",
        ).run(Date.now(), hashToken(token));
      req.financeUser = safeMember(member);
      if (
        req.financeUser.password_change_required &&
        !["/security/password", "/logout", "/remember-device"].includes(
          req.path,
        ) &&
        !(req.method === "GET" && req.path === "/security")
      )
        return res.status(403).json({
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Cambia tu contraseña personal para continuar",
          user: req.financeUser,
        });
      next();
    }),
  );

  app.post(
    "/api/finance/remember-device",
    route((req, res) => {
      if (typeof req.body.remember !== "boolean")
        fail("Indica si quieres recordar este dispositivo");
      const token = sessionToken(req),
        remember = req.body.remember,
        duration = (remember ? 30 * 24 : 12) * 60 * 60 * 1000;
      db.prepare(
        "UPDATE finance_sessions SET remembered=?,expires_at=?,last_seen=? WHERE token_hash=? AND member_id=?",
      ).run(
        remember ? 1 : 0,
        Date.now() + duration,
        Date.now(),
        hashToken(token),
        req.financeUser.id,
      );
      res.cookie("gema_finance_session", token, {
        ...cookieOptions,
        maxAge: duration,
      });
      audit(
        db,
        req.financeUser.username,
        "session.remembered",
        "session",
        "current",
        null,
        { remembered: remember },
      );
      res.json({ ok: true, remember_device: remember });
    }),
  );
  app.post(
    "/api/finance/logout",
    route((req, res) => {
      db.prepare("DELETE FROM finance_sessions WHERE token_hash=?").run(
        hashToken(sessionToken(req)),
      );
      res.clearCookie("gema_finance_session", cookieOptions);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/finance/snapshot",
    route((req, res) =>
      res.json(
        attachOperations(
          db,
          req.financeUser,
          attachWorkflow(
            db,
            req.financeUser,
            snapshot(db, req.financeUser, req.query),
          ),
        ),
      ),
    ),
  );
  registerFinanceSecurity(app, db, { route, sessionToken });
  registerWorkflowRoutes(app, db, { route, owner });
  registerOperationsRoutes(app, db, { route, owner });
  registerReceiptRoutes(app,db,{route});
  registerInviteManagement(app, db, { route, owner });
  registerGmailRoutes(app, db, { route, owner });
  registerNotificationRoutes(app, db, { route, owner, sessionToken,requestMailCorroboration });
  registerLoanRoutes(app, db, { route, owner });
  registerFundingRoutes(app, db, { route, owner });
  registerPaymentPush(app, db, { route, owner });
  app.post(
    "/api/finance/quick/register",
    route((req, res) => {
      const result = registerQuickEntry(db, req.financeUser, req.body);
      res.status(result.duplicate ? 200 : 201).json(result);
    }),
  );
  app.get(
    "/api/finance/orders",
    route((req, res) => {
      businessAccess(req.financeUser, "producalza");
      res.json({ orders: productionOrders(db, text(req.query.q, 100)) });
    }),
  );
  app.post(
    "/api/finance/movements",
    route((req, res) => {
      writer(req);
      res.status(201).json(createMovement(db, req.financeUser, req.body));
    }),
  );
  app.post(
    "/api/finance/movements/:id/review",
    route((req, res) => {
      manager(req);
      const movement = requireRow(
        db,
        "finance_movements",
        req.params.id,
        req.financeUser,
      );
      if (movement.is_payment_request)
        fail(
          "Gestiona esta solicitud desde Por pagar para conservar su historial",
          409,
        );
      if (
        !["pending", "reported", "approved"].includes(movement.status) ||
        movement.allocated_cents
      )
        fail("El estado actual impide esta revisión", 409);
      const allocations = db
        .prepare(
          "SELECT COUNT(*) n FROM finance_allocations WHERE movement_id=?",
        )
        .get(movement.id).n;
      if (allocations)
        fail("El movimiento ya tiene asignaciones bancarias", 409);
      if (
        movement.unit_id &&
        db
          .prepare("SELECT id FROM finance_closings WHERE unit_id=? AND day=?")
          .get(movement.unit_id, movement.day)
      )
        fail("Reabre el cierre antes de cambiar el movimiento", 409);
      if (!["approved", "rejected"].includes(req.body.status))
        fail("Estado de revisión inválido");
      if (
        req.financeUser.role !== "owner" &&
        movement.created_by === req.financeUser.username
      )
        fail("Otro administrador debe revisar tu propia solicitud", 403);
      const note = text(req.body.note, 1000);
      if(req.body.status==='approved'&&movement.kind==='income'&&movement.evidence_id){res.json(confirmReceiptDeposit(db,req.financeUser,movement.id,req.body));return;}
      if (req.body.status === "rejected" && !note)
        fail("Indica el motivo del rechazo");
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_movements SET status=?,reviewed_by=?,reviewed_at=?,review_note=?,updated_at=? WHERE id=?",
        ).run(
          req.body.status,
          req.financeUser.username,
          new Date().toISOString(),
          note,
          new Date().toISOString(),
          movement.id,
        );
        audit(
          db,
          req.financeUser.username,
          "movement.reviewed",
          "movement",
          movement.id,
          movement,
          { status: req.body.status, note },
          movement.business_id,
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/accounts",
    route((req, res) => {
      owner(req);
      const b = req.body;
      if (b.business_id) businessAccess(req.financeUser, b.business_id);
      if (
        !["bank", "cash", "wallet", "card", "custody"].includes(b.kind) ||
        !text(b.name) ||
        !text(b.bank)
      )
        fail("Completa nombre, entidad y tipo de cuenta");
      if (b.last_four && !/^\d{1,4}$/.test(b.last_four))
        fail("Guarda únicamente hasta cuatro últimos dígitos");
      cents(b.opening_cents, { signed: true, zero: true });
      validDay(b.opening_date);
      if (b.opening_date > financeDay())
        fail("El saldo inicial no puede ser futuro");
      const row = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO finance_accounts (business_id,name,bank,kind,last_four,custodian,opening_cents,opening_date) VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(
            b.business_id || null,
            text(b.name),
            text(b.bank),
            b.kind,
            text(b.last_four, 4),
            text(b.custodian),
            b.opening_cents,
            b.opening_date,
          );
        audit(
          db,
          req.financeUser.username,
          "account.created",
          "account",
          result.lastInsertRowid,
          null,
          { ...b, last_four: text(b.last_four, 4) },
          b.business_id || null,
        );
        return { id: Number(result.lastInsertRowid) };
      })();
      res.status(201).json(row);
    }),
  );
  app.post(
    "/api/finance/accounts/:id/verify",
    route((req, res) => {
      owner(req);
      if(req.body.update_balance===true){res.json(updateConfirmedBalance(db,req.financeUser,Number(req.params.id),req.body));return;}
      const a = db
        .prepare("SELECT * FROM finance_accounts WHERE id=?")
        .get(req.params.id);
      if (!a) fail("Cuenta no encontrada", 404);
      cents(req.body.balance_cents, { signed: true, zero: true });
      const day = validDay(req.body.day);
      if (day < a.opening_date || day > financeDay())
        fail("Fecha de comprobación fuera de rango");
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_accounts SET verified_cents=?,verified_at=? WHERE id=?",
        ).run(req.body.balance_cents, `${day}T23:59:59-05:00`, a.id);
        audit(
          db,
          req.financeUser.username,
          "account.verified",
          "account",
          a.id,
          { verified_cents: a.verified_cents, verified_at: a.verified_at },
          {
            balance_cents: req.body.balance_cents,
            day,
            method: "manual_bank_comparison",
          },
          a.business_id,
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/bank/import",
    route((req, res) => res.json(importBank(db, req.financeUser, req.body))),
  );
  app.post(
    "/api/finance/accounts/:id/allocate-opening",
    route((req, res) => {
      owner(req);
      const account = db
        .prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1")
        .get(req.params.id);
      if (!account || account.business_id)
        fail("La asignación corresponde a una cuenta compartida");
      const rows = req.body.allocations;
      if (!Array.isArray(rows) || rows.length > 4)
        fail("Asignación de fondos inválida");
      const ids = new Set();
      let total = 0;
      for (const row of rows) {
        businessAccess(req.financeUser, row.business_id);
        cents(row.amount_cents, { signed: true, zero: true });
        if (ids.has(row.business_id)) fail("Hay negocios repetidos");
        ids.add(row.business_id);
        if (
          row.amount_cents !== 0 &&
          Math.sign(row.amount_cents) !== Math.sign(account.opening_cents)
        )
          fail("Los valores deben tener el mismo signo que el saldo inicial");
        total += row.amount_cents;
      }
      if (Math.abs(total) > Math.abs(account.opening_cents))
        fail("La asignación supera el saldo inicial de la cuenta");
      db.transaction(() => {
        const previous = db
          .prepare(
            "SELECT business_id,amount_cents FROM finance_account_allocations WHERE account_id=?",
          )
          .all(account.id);
        db.prepare(
          "DELETE FROM finance_account_allocations WHERE account_id=?",
        ).run(account.id);
        for (const row of rows)
          db.prepare(
            "INSERT INTO finance_account_allocations (account_id,business_id,amount_cents) VALUES (?,?,?)",
          ).run(account.id, row.business_id, row.amount_cents);
        audit(
          db,
          req.financeUser.username,
          "account.opening_allocated",
          "account",
          account.id,
          previous,
          rows,
        );
      })();
      res.json({ ok: true, unassigned_cents: account.opening_cents - total });
    }),
  );
  app.post(
    "/api/finance/reconcile",
    route((req, res) =>
      res.json(reconcile(db, req.financeUser, req.body, bridges)),
    ),
  );
  app.post(
    "/api/finance/transfers",
    route((req, res) => {
      owner(req);
      const b = req.body;
      cents(b.amount_cents);
      const day = validDay(b.day);
      if (day > financeDay()) fail("La fecha del traslado no puede ser futura");
      if (!text(b.description))
        fail("Explica el motivo y la propiedad de los fondos trasladados");
      const from = db
        .prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1")
        .get(b.from_account_id);
      const to = db
        .prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1")
        .get(b.to_account_id);
      if (!from || !to || from.id === to.id)
        fail("Selecciona dos cuentas diferentes");
      const fromBusiness = from.business_id || b.from_business_id;
      const toBusiness = to.business_id || b.to_business_id;
      businessAccess(req.financeUser, fromBusiness);
      businessAccess(req.financeUser, toBusiness);
      if (day < from.opening_date || day < to.opening_date)
        fail("El traslado es anterior al saldo inicial de una cuenta");
      const cash = (a) => ["cash", "custody"].includes(a.kind);
      if ((cash(from) || cash(to)) && b.confirm_cash !== true)
        fail("Confirma la entrega o recepción física de los fondos");
      const result = db.transaction(() => {
        if (b.idempotency_key && !/^[a-f0-9-]{36}$/i.test(b.idempotency_key))
          fail("Identificador de traslado no válido");
        const group = b.idempotency_key || crypto.randomUUID();
        const ids = [];
        const previous = db
          .prepare(
            "SELECT * FROM finance_movements WHERE transfer_group=? ORDER BY id",
          )
          .all(group);
        if (previous.length) {
          const outgoing = previous.find((m) => m.transfer_side === "outgoing"),
            incoming = previous.find((m) => m.transfer_side === "incoming");
          if (
            !outgoing ||
            !incoming ||
            outgoing.account_id !== from.id ||
            incoming.account_id !== to.id ||
            outgoing.amount_cents !== b.amount_cents ||
            outgoing.day !== day ||
            outgoing.description !== text(b.description, 2000)
          )
            fail(
              "El identificador del traslado ya tiene datos diferentes",
              409,
            );
          return {
            group,
            movement_ids: previous.map((m) => m.id),
            duplicate: true,
          };
        }
        for (const [account, business, side, other] of [
          [from, fromBusiness, "outgoing", to],
          [to, toBusiness, "incoming", from],
        ]) {
          const insert = db
            .prepare(
              `INSERT INTO finance_movements (business_id,account_id,kind,amount_cents,day,category,counterparty,description,payment_method,status,transfer_group,transfer_side,created_by,reviewed_by)
          VALUES (?,?,'transfer',?,?,'Traslado interno',?,?,'transfer','approved',?,?,?,?)`,
            )
            .run(
              business,
              account.id,
              b.amount_cents,
              day,
              `${side === "outgoing" ? "Hacia" : "Desde"} ${other.name}`,
              text(b.description, 2000),
              group,
              side,
              req.financeUser.username,
              req.financeUser.username,
            );
          const id = Number(insert.lastInsertRowid);
          ids.push(id);
          if (cash(account)) {
            const bank = db
              .prepare(
                `INSERT INTO finance_bank_transactions (account_id,day,amount_cents,reference,description,fingerprint,batch_id,source,created_by) VALUES (?,?,?,?,?,?,?,'cash_journal',?)`,
              )
              .run(
                account.id,
                day,
                (side === "outgoing" ? -1 : 1) * b.amount_cents,
                `TR-${group}`,
                text(b.description, 500),
                `${group}:${side}`,
                group,
                req.financeUser.username,
              );
            reconcile(db, req.financeUser, {
              movement_id: id,
              bank_transaction_id: Number(bank.lastInsertRowid),
              amount_cents: b.amount_cents,
            });
          }
        }
        audit(
          db,
          req.financeUser.username,
          "transfer.recorded",
          "transfer",
          group,
          null,
          {
            from_account_id: from.id,
            to_account_id: to.id,
            amount_cents: b.amount_cents,
            from_business: fromBusiness,
            to_business: toBusiness,
            day,
            description: text(b.description, 2000),
          },
        );
        return { group, movement_ids: ids };
      })();
      res.status(201).json(result);
    }),
  );
  app.post(
    "/api/finance/cash/confirm",
    route((req, res) => {
      owner(req);
      if (!text(req.body.note))
        fail("Indica quién entregó o recibió el efectivo");
      const m = requireRow(
        db,
        "finance_movements",
        req.body.movement_id,
        req.financeUser,
      );
      const a =
        m.account_id &&
        db
          .prepare("SELECT * FROM finance_accounts WHERE id=?")
          .get(m.account_id);
      if (!a || !["cash", "custody"].includes(a.kind))
        fail("Esta confirmación requiere una cuenta de efectivo o custodia");
      if (m.day < a.opening_date)
        fail("El movimiento es anterior al saldo inicial de la cuenta");
      const assigned = db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents),0) n FROM finance_allocations WHERE movement_id=?",
        )
        .get(m.id).n;
      const remaining = m.amount_cents - assigned;
      if (remaining <= 0) fail("El movimiento ya está completo", 409);
      db.transaction(() => {
        const id = crypto.randomUUID();
        const positive = m.kind === "income" || m.transfer_side === "incoming";
        const result = db
          .prepare(
            `INSERT INTO finance_bank_transactions (account_id,day,amount_cents,reference,description,fingerprint,batch_id,source,created_by) VALUES (?,?,?,?,?,?,?,'cash_journal',?)`,
          )
          .run(
            a.id,
            m.day,
            (positive ? 1 : -1) * remaining,
            m.reference,
            text(req.body.note, 500),
            id,
            id,
            req.financeUser.username,
          );
        reconcile(
          db,
          req.financeUser,
          {
            movement_id: m.id,
            bank_transaction_id: Number(result.lastInsertRowid),
            amount_cents: remaining,
          },
          bridges,
        );
        audit(
          db,
          req.financeUser.username,
          "cash.confirmed",
          "movement",
          m.id,
          null,
          { note: text(req.body.note, 1000), amount_cents: remaining },
          m.business_id,
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.delete(
    "/api/finance/allocations/:id",
    route((req, res) => {
      owner(req);
      if (!text(req.body.reason)) fail("Indica el motivo de la corrección");
      db.transaction(() => {
        const a = db
          .prepare("SELECT * FROM finance_allocations WHERE id=?")
          .get(req.params.id);
        if (!a) fail("Asociación no encontrada", 404);
        const m = requireRow(
          db,
          "finance_movements",
          a.movement_id,
          req.financeUser,
        );
        if (m.status === "reconciled" && bridges.production)
          bridges.production.reverseFinancePayment(m, req.financeUser.username);
        db.prepare("DELETE FROM finance_allocations WHERE id=?").run(a.id);
        db.prepare(
          "UPDATE finance_movements SET status=?,updated_at=? WHERE id=?",
        ).run(
          m.reviewed_by ? "approved" : "pending",
          new Date().toISOString(),
          m.id,
        );
        audit(
          db,
          req.financeUser.username,
          "allocation.reversed",
          "movement",
          m.id,
          a,
          { reason: text(req.body.reason) },
          m.business_id,
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/finance/allocations/:movementId",
    route((req, res) => {
      owner(req);
      requireRow(
        db,
        "finance_movements",
        req.params.movementId,
        req.financeUser,
      );
      res.json({
        allocations: db
          .prepare(
            "SELECT a.*,b.reference,b.day FROM finance_allocations a JOIN finance_bank_transactions b ON b.id=a.bank_transaction_id WHERE movement_id=?",
          )
          .all(req.params.movementId),
      });
    }),
  );
  app.post(
    "/api/finance/evidence",
    route((req, res) => {
      writer(req);
      businessAccess(req.financeUser, req.body.business_id);
      unitAccess(db, req.financeUser, req.body.unit_id, req.body.business_id);
      const buffer = validateDocument(req.body);
      const sha = crypto.createHash("sha256").update(buffer).digest("hex");
      const old = db
        .prepare(
          "SELECT id,created_by,unit_id FROM finance_evidence WHERE business_id=? AND sha256=?",
        )
        .get(req.body.business_id, sha);
      if (old) {
        if (
          req.financeUser.role === "collector" &&
          old.created_by !== req.financeUser.username
        )
          fail("Este archivo ya fue presentado. Solicita su revisión.", 409);
        if (
          req.financeUser.unit_ids.length &&
          !req.financeUser.unit_ids.includes(old.unit_id)
        )
          fail("Este archivo ya fue presentado en otra unidad.", 409);
        return res.json({ id: old.id, duplicate: true });
      }
      const stored = db
        .prepare("SELECT (SELECT COALESCE(SUM(bytes),0) FROM finance_evidence)+(SELECT COALESCE(SUM(bytes),0) FROM finance_assistant_photos) n")
        .get().n;
      const limit = Number(
        process.env.FINANCE_MAX_DOCUMENT_BYTES || 256 * 1024 * 1024,
      );
      if (stored + buffer.length > limit)
        fail(
          "Se alcanzó la capacidad de comprobantes configurada. Amplía el almacenamiento antes de continuar.",
          413,
        );
      const encrypted = encryptDocument(buffer);
      const id = db.transaction(() => {
        const result = db
          .prepare(
            "INSERT INTO finance_evidence (business_id,unit_id,name,mime,bytes,sha256,encrypted,created_by) VALUES (?,?,?,?,?,?,?,?)",
          )
          .run(
            req.body.business_id,
            req.body.unit_id || null,
            text(req.body.name, 180).replace(/[\\/\r\n]/g, "_") ||
              "Comprobante",
            req.body.mime,
            buffer.length,
            sha,
            encrypted,
            req.financeUser.username,
          );
        audit(
          db,
          req.financeUser.username,
          "evidence.uploaded",
          "evidence",
          result.lastInsertRowid,
          null,
          { sha256: sha, bytes: buffer.length },
          req.body.business_id,
        );
        return Number(result.lastInsertRowid);
      })();
      res.status(201).json({ id, duplicate: false });
    }),
  );
  function evidenceAccess(req) {
    const e = requireRow(
      db,
      "finance_evidence",
      req.params.id,
      req.financeUser,
    );
    if (
      req.financeUser.role === "collector" &&
      e.created_by !== req.financeUser.username
    )
      fail("Comprobante no encontrado", 404);
    return e;
  }
  app.get(
    "/api/finance/evidence/:id",
    route((req, res) => {
      const e = evidenceAccess(req);
      res.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(e.name)}`,
      );
      res.type(e.mime).send(decryptDocument(e.encrypted));
    }),
  );
  const aiLimit = (req,conversation=false) => {
    const key = `${req.financeUser.id}:${conversation?'conversation':'analysis'}`;
    const recent = (aiAttempts.get(key) || []).filter(
      (t) => Date.now() - t < 60_000,
    );
    if (recent.length >= (conversation?18:6))
      fail("Espera un momento antes de otra consulta de IA", 429);
    recent.push(Date.now());
    aiAttempts.set(key, recent);
  };
  app.post("/api/finance/quick/conversation", route(async (req, res) => {
    if (!canUseFinanceAssistant(req.financeUser)) fail("El asistente está habilitado para Marlon, Germán, Morelia y Norma", 403);
    const lastMessage=Array.isArray(req.body.messages)?req.body.messages.at(-1)?.content:null;
    if(!cancelsConversation(lastMessage))aiLimit(req,true);
    res.json(await prepareConversation(db, req.financeUser, req.body));
  }));
  app.post("/api/finance/quick/conversation/photos",route(async(req,res)=>{
    res.json(await uploadConversationPhoto(db,req.financeUser,req.body));
  }));
  app.post('/api/finance/quick/conversation/revise',route((req,res)=>{
    if(!canUseFinanceAssistant(req.financeUser))fail('No tienes acceso al asistente',403);
    res.json(reviseConversation(db,req.financeUser,req.body));
  }));
  app.post("/api/finance/quick/conversation/confirm", route((req, res) => {
    if (!canUseFinanceAssistant(req.financeUser)) fail("No tienes acceso al asistente", 403);
    res.json(confirmConversation(db, req.financeUser, req.body));
  }));
  app.delete("/api/finance/quick/conversation/:id", route((req, res) => {
    res.json(cancelConversation(db, req.financeUser, req.params.id));
  }));
  app.post(
    "/api/finance/evidence/:id/analyze",
    route(async (req, res) => {
      writer(req);
      aiLimit(req);
      const e = evidenceAccess(req);
      const analysis = await analyzeDocument(e);
      db.transaction(() => {
        db.prepare("UPDATE finance_evidence SET analysis=? WHERE id=?").run(
          JSON.stringify(analysis),
          e.id,
        );
        audit(
          db,
          req.financeUser.username,
          "evidence.analyzed",
          "evidence",
          e.id,
          null,
          { draft: true },
          e.business_id,
        );
      })();
      res.json({ analysis, origin_account:suggestOriginAccount(db,req.financeUser,analysis),destination_account:suggestReceivingAccount(db,req.financeUser,analysis), draft: true });
    }),
  );
  app.post(
    "/api/finance/evidence/:id/bank-details",
    route(async (req, res) => {
      writer(req);
      aiLimit(req);
      const e = evidenceAccess(req);
      const analysis = await analyzeBankDetails(e);
      audit(
        db,
        req.financeUser.username,
        "payee.extracted",
        "evidence",
        e.id,
        null,
        { draft: true, account_count: analysis.accounts.length },
        e.business_id,
      );
      res.json({ analysis, draft: true });
    }),
  );
  app.post(
    "/api/finance/assistant",
    route(async (req, res) => {
      if (!canUseFinanceAssistant(req.financeUser))
        fail(
          "El asistente está habilitado para Marlon, Germán, Morelia y Norma",
          403,
        );
      aiLimit(req);
      const question = text(req.body.question, 1500);
      if (!question) fail("Escribe tu consulta");
      const data = attachOperations(
        db,
        req.financeUser,
        attachWorkflow(
          db,
          req.financeUser,
          snapshot(
            db,
            req.financeUser,
            assistantFilters(question, req.body.filters || {}),
          ),
        ),
      );
      const precise = sourcedAnswer(question, data, req.body.history);
      if (precise) return res.json(precise);
      if (!process.env.OPENAI_API_KEY) {
        const usd = (n) =>
          new Intl.NumberFormat("es-EC", {
            style: "currency",
            currency: "USD",
          }).format(n / 100);
        const s = data.summary;
        return res.json({
          mode: "data",
          answer: `${(data.settlement_funds || [])
            .map(
              (f) =>
                `Diners · saldo manual al ${f.as_of}: ${usd(
                  f.available_cents,
                )} efectivizado y ${usd(
                  f.pending_cents,
                )} por efectivizar, separado de bancos.\n\n`,
            )
            .join("")}Resumen de los registros del ${data.period.from} al ${
            data.period.to
          }:\n\n• Saldo calculado en bancos y billeteras: ${
            s.balances_visible
              ? usd(s.balance_cents)
              : "no disponible para este acceso"
          }.\n• Cobros conciliados del período: ${usd(
            s.income_cents,
          )}.\n• Gastos registrados aceptados del período: ${usd(
            s.expense_cents,
          )}.\n• Compromisos de gasto pendientes, de todas las fechas: ${usd(
            s.pending_cents,
          )}.\n• ${s.pending_count} movimientos por revisar.\n\n${
            s.unverified_accounts
          } cuentas requieren comprobación. Estos datos no equivalen a utilidad ni dinero libre. La IA conversacional está pendiente de configurar; este resumen se calcula directamente desde tus registros.`,
          movement_ids: [],
        });
      }
      res.json(await answerQuestion(question, data, req.body.history));
    }),
  );
  app.post(
    "/api/finance/recurring",
    route((req, res) => {
      manager(req);
      const b = req.body;
      businessAccess(req.financeUser, b.business_id);
      unitAccess(db, req.financeUser, b.unit_id, b.business_id);
      cents(b.amount_cents);
      if (
        !Number.isInteger(b.due_day) ||
        b.due_day < 1 ||
        b.due_day > 28 ||
        !text(b.name) ||
        !text(b.category) ||
        !text(b.counterparty)
      )
        fail("Completa los datos del gasto recurrente; día entre 1 y 28");
      const result = db.transaction(() => {
        const row = db
          .prepare(
            "INSERT INTO finance_recurring (business_id,unit_id,name,category,counterparty,amount_cents,due_day,created_by) VALUES (?,?,?,?,?,?,?,?)",
          )
          .run(
            b.business_id,
            b.unit_id || null,
            text(b.name),
            text(b.category),
            text(b.counterparty),
            b.amount_cents,
            b.due_day,
            req.financeUser.username,
          );
        audit(
          db,
          req.financeUser.username,
          "recurring.created",
          "recurring",
          row.lastInsertRowid,
          null,
          b,
          b.business_id,
        );
        return { id: Number(row.lastInsertRowid) };
      })();
      res.status(201).json(result);
    }),
  );
  app.post(
    "/api/finance/recurring/generate",
    route((req, res) => {
      manager(req);
      const month = text(req.body.month, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail("Mes inválido");
      const rules = db
        .prepare("SELECT * FROM finance_recurring WHERE active=1")
        .all()
        .filter((r) => scoped(req.financeUser, r));
      let created = 0;
      db.transaction(() => {
        for (const r of rules) {
          const external = `${r.id}:${month}`;
          if (
            db
              .prepare(
                "SELECT id FROM finance_movements WHERE source_system='recurring' AND business_id=? AND external_id=?",
              )
              .get(r.business_id, external)
          )
            continue;
          const day = financeDay();
          const row = createMovement(db, req.financeUser, {
            business_id: r.business_id,
            unit_id: r.unit_id,
            kind: "expense",
            amount_cents: r.amount_cents,
            day,
            due_date: `${month}-${String(r.due_day).padStart(2, "0")}`,
            category: r.category,
            counterparty: r.counterparty,
            description: r.name,
          });
          db.prepare(
            "UPDATE finance_movements SET source_system='recurring',external_id=? WHERE id=?",
          ).run(external, row.id);
          created++;
        }
      })();
      res.json({ created });
    }),
  );
  app.post(
    "/api/finance/recurring/:id/deactivate",
    route((req, res) => {
      manager(req);
      const r = requireRow(
        db,
        "finance_recurring",
        req.params.id,
        req.financeUser,
      );
      db.transaction(() => {
        db.prepare("UPDATE finance_recurring SET active=0 WHERE id=?").run(
          r.id,
        );
        audit(
          db,
          req.financeUser.username,
          "recurring.deactivated",
          "recurring",
          r.id,
          r,
          { active: false },
          r.business_id,
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/budgets",
    route((req, res) => {
      manager(req);
      const b = req.body;
      businessAccess(req.financeUser, b.business_id);
      if (req.financeUser.unit_ids.length)
        fail(
          "El presupuesto del negocio requiere acceso a todas sus unidades",
          403,
        );
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month) || !text(b.category))
        fail("Mes o categoría inválidos");
      cents(b.amount_cents);
      db.transaction(() => {
        const old = db
          .prepare(
            "SELECT * FROM finance_budgets WHERE business_id=? AND month=? AND category=?",
          )
          .get(b.business_id, b.month, text(b.category));
        db.prepare(
          "INSERT INTO finance_budgets (business_id,month,category,amount_cents) VALUES (?,?,?,?) ON CONFLICT(business_id,month,category) DO UPDATE SET amount_cents=excluded.amount_cents",
        ).run(b.business_id, b.month, text(b.category), b.amount_cents);
        audit(
          db,
          req.financeUser.username,
          "budget.saved",
          "budget",
          `${b.business_id}:${b.month}:${b.category}`,
          old,
          b,
          b.business_id,
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/closings",
    route((req, res) => {
      writer(req);
      const b = req.body;
      const unit = db
        .prepare("SELECT * FROM finance_units WHERE id=?")
        .get(b.unit_id);
      if (!unit) fail("Selecciona un local");
      businessAccess(req.financeUser, unit.business_id);
      unitAccess(db, req.financeUser, unit.id, unit.business_id);
      const day = validDay(b.day);
      if (day > financeDay()) fail("No puedes cerrar una fecha futura");
      for (const field of ["opening_cents", "deposits_cents", "counted_cents"])
        cents(b[field], { zero: true });
      if (
        db
          .prepare("SELECT id FROM finance_closings WHERE unit_id=? AND day=?")
          .get(unit.id, day)
      )
        fail("Este cierre ya existe", 409);
      const figures = closingFigures(db, req.financeUser, unit.id, day);
      const sales = figures.sales_cents,
        expenses = figures.expenses_cents,
        unresolved = figures.pending_count;
      if (unresolved)
        fail(
          "Revisa los movimientos de efectivo pendientes antes de cerrar",
          409,
        );
      const expected = b.opening_cents + sales - expenses - b.deposits_cents;
      const difference = b.counted_cents - expected;
      if (difference !== 0 && !text(b.note))
        fail("Explica la diferencia de caja");
      const id = db.transaction(() => {
        const result = db
          .prepare(
            "INSERT INTO finance_closings (unit_id,day,opening_cents,sales_cents,expenses_cents,deposits_cents,counted_cents,expected_cents,difference_cents,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            unit.id,
            day,
            b.opening_cents,
            sales,
            expenses,
            b.deposits_cents,
            b.counted_cents,
            expected,
            difference,
            text(b.note, 2000),
            req.financeUser.username,
          );
        audit(
          db,
          req.financeUser.username,
          "cash.closed",
          "closing",
          result.lastInsertRowid,
          null,
          { ...b, expected_cents: expected, difference_cents: difference },
          unit.business_id,
        );
        return Number(result.lastInsertRowid);
      })();
      res
        .status(201)
        .json({ id, expected_cents: expected, difference_cents: difference });
    }),
  );
  app.get(
    "/api/finance/closings/preview",
    route((req, res) =>
      res.json(
        closingFigures(
          db,
          req.financeUser,
          text(req.query.unit_id),
          text(req.query.day, 10),
        ),
      ),
    ),
  );
  app.post(
    "/api/finance/closings/:id/reopen",
    route((req, res) => {
      owner(req);
      if (!text(req.body.reason)) fail("Indica el motivo de reapertura");
      db.transaction(() => {
        const old = db
          .prepare("SELECT * FROM finance_closings WHERE id=?")
          .get(req.params.id);
        if (!old) fail("Cierre no encontrado", 404);
        const unit = db
          .prepare("SELECT * FROM finance_units WHERE id=?")
          .get(old.unit_id);
        db.prepare("DELETE FROM finance_closings WHERE id=?").run(old.id);
        audit(
          db,
          req.financeUser.username,
          "cash.reopened",
          "closing",
          old.id,
          old,
          { reason: text(req.body.reason) },
          unit.business_id,
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/sync",
    route((req, res) => {
      owner(req);
      res.json(syncInternalSources(db, req.financeUser));
    }),
  );
  app.post(
    "/api/finance/integrations/alfabusiness",
    route((req, res) => {
      const secret = process.env.FINANCE_SALES_WEBHOOK_SECRET;
      const timestamp = req.get("x-finance-timestamp");
      const signature = req.get("x-finance-signature");
      if (!secret || secret.length < 32) fail("Integración no habilitada", 503);
      if (
        !/^\d+$/.test(timestamp || "") ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        !req.rawBody
      )
        fail("Firma no válida", 401);
      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.`)
        .update(req.rawBody)
        .digest("hex");
      const actual = Buffer.from(signature || "", "hex");
      const check = Buffer.from(expected, "hex");
      if (
        check.length !== actual.length ||
        !crypto.timingSafeEqual(check, actual)
      )
        fail("Firma no válida", 401);
      if (req.rawBody.length > 1024 * 1024)
        fail("El aviso de venta excede el tamaño permitido", 413);
      const sale=normalizeAlfaBusinessSale(req.body,{idempotencyKey:req.get('idempotency-key')});
      const result = importSale(db, sale);
      db.prepare(
        "UPDATE finance_sync_log SET state='ready',last_run=?,count=count+?,detail='Recepción de ventas autenticadas; cotejar cobertura con AlfaBusiness' WHERE source='alfabusiness'",
      ).run(new Date().toISOString(), result.ignored ? 0 : 1);
      console.info('[finance] AlfaBusiness delivery accepted '+JSON.stringify({external_id:sale.external_id,unit_id:sale.unit_id,id:result.id,ignored:result.ignored}));
      res.json({...result,external_id:sale.external_id,unit_id:sale.unit_id});
    }),
  );
  app.get("/api/finance/integrations/alfabusiness/status",route((req,res)=>{
    owner(req);
    res.json(marjorieIntegrationHealth(db));
  }));
  app.get(
    "/api/finance/members",
    route((req, res) => {
      owner(req);
      res.json({
        members: db
          .prepare("SELECT * FROM finance_members ORDER BY id")
          .all()
          .map((m) => ({
            ...safeMember(m),
            space_ids: db
              .prepare(
                "SELECT space_id FROM finance_space_members WHERE member_id=?",
              )
              .all(m.id)
              .map((s) => s.space_id),
            space_role:
              db
                .prepare(
                  "SELECT role FROM finance_space_members WHERE member_id=? LIMIT 1",
                )
                .get(m.id)?.role || "requester",
          })),
      });
    }),
  );
  app.post(
    "/api/finance/members",
    route((req, res) => {
      owner(req);
      const b = req.body;
      if (
        !["manager", "collector", "viewer"].includes(b.role) ||
        !text(b.name) ||
        !text(b.username) ||
        !Array.isArray(b.business_ids) ||
        !b.business_ids.length
      )
        fail("Completa nombre, usuario, rol y negocios");
      for (const id of b.business_ids) businessAccess(req.financeUser, id);
      if (
        b.work_view === true &&
        (b.role !== "viewer" || b.business_ids.includes("personal"))
      )
        fail(
          "El perfil de consulta de trabajo excluye los detalles personales y utiliza rol de consulta",
        );
      for (const id of b.unit_ids || []) {
        const u = db.prepare("SELECT * FROM finance_units WHERE id=?").get(id);
        if (!u || !b.business_ids.includes(u.business_id))
          fail("Unidad fuera de los negocios asignados");
      }
      if (
        db
          .prepare("SELECT id FROM finance_members WHERE username=?")
          .get(text(b.username, 100))
      )
        fail("Ese usuario ya existe", 409);
      const result = db.transaction(() => {
        const row = db
          .prepare(
            "INSERT INTO finance_members (name,username,password_hash,role,business_ids,unit_ids,work_view) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            text(b.name),
            text(b.username, 100),
            passwordHash(validateFinancePassword(b.password)),
            b.role,
            JSON.stringify([...new Set(b.business_ids)]),
            JSON.stringify(b.unit_ids || []),
            b.work_view === true ? 1 : 0,
          );
        if (b.space_ids !== undefined)
          assignSpaceMemberships(
            db,
            Number(row.lastInsertRowid),
            b.space_ids,
            b.role === "viewer" ? "observer" : b.space_role || "requester",
            b.business_ids,
          );
        audit(
          db,
          req.financeUser.username,
          "member.created",
          "member",
          row.lastInsertRowid,
          null,
          {
            name: b.name,
            role: b.role,
            business_ids: b.business_ids,
            unit_ids: b.unit_ids || [],
          },
        );
        return { id: Number(row.lastInsertRowid) };
      })();
      res.status(201).json(result);
    }),
  );
  app.post(
    "/api/finance/members/:id/access",
    route((req, res) => {
      owner(req);
      const member = db
          .prepare("SELECT * FROM finance_members WHERE id=?")
          .get(req.params.id),
        b = req.body;
      if (!member || member.role === "owner")
        fail("Este acceso no se puede cambiar desde aquí", 403);
      if (
        !["manager", "collector", "viewer"].includes(b.role) ||
        !Array.isArray(b.business_ids) ||
        !b.business_ids.length
      )
        fail("Selecciona rol y negocios");
      for (const id of b.business_ids) businessAccess(req.financeUser, id);
      for (const id of b.unit_ids || []) {
        const unit = db
          .prepare("SELECT * FROM finance_units WHERE id=?")
          .get(id);
        if (!unit || !b.business_ids.includes(unit.business_id))
          fail("Local fuera del acceso");
      }
      if (
        b.work_view === true &&
        (b.role !== "viewer" || b.business_ids.includes("personal"))
      )
        fail("La consulta de trabajo excluye los detalles personales");
      db.transaction(() => {
        db.prepare(
          "UPDATE finance_members SET name=?,role=?,business_ids=?,unit_ids=?,work_view=? WHERE id=?",
        ).run(
          text(b.name) || member.name,
          b.role,
          JSON.stringify([...new Set(b.business_ids)]),
          JSON.stringify(b.unit_ids || []),
          b.work_view === true ? 1 : 0,
          member.id,
        );
        if (b.space_ids !== undefined)
          assignSpaceMemberships(
            db,
            member.id,
            b.space_ids,
            b.role === "viewer" ? "observer" : b.space_role || "requester",
            b.business_ids,
          );
        db.prepare("DELETE FROM finance_sessions WHERE member_id=?").run(
          member.id,
        );
        audit(
          db,
          req.financeUser.username,
          "member.permissions_changed",
          "member",
          member.id,
          safeMember(member),
          safeMember(
            db
              .prepare("SELECT * FROM finance_members WHERE id=?")
              .get(member.id),
          ),
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/finance/members/:id/status",
    route((req, res) => {
      owner(req);
      const member = db
        .prepare("SELECT * FROM finance_members WHERE id=?")
        .get(req.params.id);
      if (!member || member.role === "owner")
        fail("No puedes cambiar este acceso");
      db.transaction(() => {
        db.prepare("UPDATE finance_members SET active=? WHERE id=?").run(
          req.body.active === true ? 1 : 0,
          member.id,
        );
        db.prepare("DELETE FROM finance_sessions WHERE member_id=?").run(
          member.id,
        );
        audit(
          db,
          req.financeUser.username,
          "member.access_changed",
          "member",
          member.id,
          { active: Boolean(member.active) },
          { active: req.body.active === true },
        );
      })();
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/finance/audit",
    route((req, res) => {
      owner(req);
      res.json({
        events: db
          .prepare("SELECT * FROM finance_audit ORDER BY id DESC LIMIT 100")
          .all(),
      });
    }),
  );
  app.get(
    "/api/finance/export",
    route((req, res) => {
      if (req.financeUser.role === "collector")
        fail(
          "La exportación requiere acceso de consulta o administración",
          403,
        );
      const data = snapshot(db, req.financeUser, {
        ...req.query,
        export_all: true,
      });
      if (data.movements_total > 100000)
        fail(
          "Reduce el período para exportar hasta 100000 movimientos por archivo",
        );
      audit(
        db,
        req.financeUser.username,
        "report.exported",
        "report",
        `${data.period.from}:${data.period.to}`,
        null,
        { rows: data.movements.length },
      );
      res
        .set("Content-Disposition", 'attachment; filename="gema-finanzas.csv"')
        .type("text/csv")
        .send(csvExport(data.movements));
    }),
  );
  app.use("/api/finance", (_req, res) =>
    res.status(404).json({ message: "Recurso financiero no encontrado" }),
  );
}
