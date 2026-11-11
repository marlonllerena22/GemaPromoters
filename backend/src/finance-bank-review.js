import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { audit, financeDay, validDay } from "./finance-db.js";
import { decryptDocument } from "./finance-ai.js";
import {
  privateSetting,
  putPrivateSetting,
  adjustCustody,
} from "./finance-operations.js";
import {
  parseBankMail,
  ingestBankMessages,
  recordMailStatement,
} from "./finance-gmail.js";
import { recordedAccountBalance } from "./finance-check-ledger.js";
import { importStatementImage } from "./finance-statement-images.js";
import { recordOwnerDeclaration } from "./finance-owner-declarations.js";
import {updateConfirmedBalance} from './finance-balance-updates.js';
const normalize = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/banco|del|[^a-z]/g, "");
export function applyBankReview(db, config) {
  if (
    config.kind !== "bank-review-v1" ||
    !config.id ||
    !Array.isArray(config.messages) ||
    config.messages.length > 100
  )
    throw new Error("Invalid bank review");
  const key = "bank_review:" + config.id;
  if (privateSetting(db, key)) return { applied: false };
  if (
    !Number.isFinite(Date.parse(config.expires_at)) ||
    Date.parse(config.expires_at) < Date.now()
  )
    throw new Error("Expired bank review");
  const registry = privateSetting(db, "own_account_registry") || {
    accounts: [],
  };
  const findAccount = (selector) => {
    const rows = registry.accounts.filter(
      (a) =>
        normalize(a.bank) === normalize(selector.bank) &&
        String(a.number || a.suffix || "").endsWith(selector.account_suffix),
    );
    if (rows.length !== 1) throw new Error("Account selector is ambiguous");
    return db
      .prepare("SELECT * FROM finance_accounts WHERE id=? AND active=1")
      .get(rows[0].account_id);
  };
  return db.transaction(() => {
    let custodies = 0;
    for (const c of config.custody_balances || []) {
      if (
        !["morelia", "efectivo", "xavi-ahorros"].includes(c.id) ||
        !Number.isSafeInteger(c.expected_version) ||
        !/^[a-f0-9]{64}$/.test(c.source_hash || "")
      )
        throw new Error("Invalid custody observation");
      const current = db
        .prepare("SELECT * FROM finance_custody_balances WHERE id=?")
        .get(c.id);
      if (!current || current.version !== c.expected_version)
        throw new Error("Custody balance changed; review before applying");
      adjustCustody(
        db,
        {
          role: "owner",
          username: "marlon",
          business_ids: ["gemashow", "producalza", "marjorie", "personal"],
          unit_ids: [],
        },
        c.id,
        {
          balance_cents: c.balance_cents,
          version: c.expected_version,
          reason: "Saldo actual indicado por Marlon",
          request_key: crypto
            .createHash("sha256")
            .update(config.id + ":" + c.id)
            .digest("hex"),
        },
      );
      audit(
        db,
        "system:authorized-bank-review",
        "custody.balance_observed",
        "custodian",
        c.id,
        null,
        {
          requested_by: "marlon",
          balance_cents: c.balance_cents,
          source_hash: c.source_hash,
        },
      );
      custodies++;
    }
    let wallets = 0;
    for (const w of config.wallet_balances || []) {
      if (
        w.provider !== "payphone" ||
        !Number.isSafeInteger(w.balance_cents) ||
        w.balance_cents < 0 ||
        !Number.isFinite(Date.parse(w.as_of_at)) ||
        Date.parse(w.as_of_at) > Date.now() ||
        !/^[a-f0-9]{64}$/.test(w.source_hash || "")
      )
        throw new Error("Invalid provider balance");
      const existing = db
        .prepare("SELECT * FROM finance_accounts WHERE active=1")
        .all()
        .filter((a) => normalize(a.bank) === "payphone");
      if (
        existing.length > 1 ||
        existing.some(
          (a) => a.kind !== "wallet" || a.business_id !== "gemashow",
        )
      )
        throw new Error("Provider account is ambiguous");
      let account = existing[0];
      if (!account) {
        const row = db
          .prepare(
            "INSERT INTO finance_accounts (business_id,name,bank,kind,custodian,opening_cents,opening_date,opening_at) VALUES ('gemashow','Ticketera PayPhone','PayPhone','wallet','Propietario',?,?,?)",
          )
          .run(w.balance_cents, financeDay(w.as_of_at), w.as_of_at);
        account = db
          .prepare("SELECT * FROM finance_accounts WHERE id=?")
          .get(row.lastInsertRowid);
      }
      const before = recordedAccountBalance(db, account);
      db.prepare(
        "INSERT OR IGNORE INTO finance_balance_checkpoints (account_id,as_of_at,balance_cents,source_hash,created_by,created_at) VALUES (?,?,?,?,?,?)",
      ).run(
        account.id,
        w.as_of_at,
        w.balance_cents,
        w.source_hash,
        "marlon",
        new Date().toISOString(),
      );
      if (!registry.accounts.some((a) => a.account_id === account.id))
        registry.accounts.push({
          key: "payphone-ticketera",
          account_id: account.id,
          bank: "PayPhone",
          source: "manual-provider",
        });
      putPrivateSetting(db, "own_account_registry", registry);
      putPrivateSetting(db, "payphone_balance_observation", {
        account_id: account.id,
        as_of_at: w.as_of_at,
        source: "owner-reported",
        source_hash: w.source_hash,
        external_fee_provider: "payphone",
        platform_fee_owned: true,
      });
      audit(
        db,
        "system:authorized-bank-review",
        "provider.balance_observed",
        "account",
        account.id,
        { calculated_cents: before },
        {
          balance_cents: w.balance_cents,
          source_hash: w.source_hash,
          as_of_at: w.as_of_at,
          requested_by: "marlon",
          subtract_estimated_fees: false,
          platform_fee_owned: true,
        },
      );
      wallets++;
    }
    if (config.debit_cards?.length) {
      const mappings = privateSetting(db, "debit_card_accounts") || [];
      for (const c of config.debit_cards) {
        const a = findAccount(c);
        if (!/^\d{4}$/.test(c.card_suffix))
          throw new Error("Invalid card suffix");
        const old = mappings.find(
          (x) =>
            normalize(x.bank) === normalize(c.bank) &&
            x.suffix === c.card_suffix,
        );
        if (old && old.account_id !== a.id)
          throw new Error("Card mapping differs");
        if (!old)
          mappings.push({
            bank: c.bank,
            suffix: c.card_suffix,
            account_id: a.id,
          });
      }
      putPrivateSetting(db, "debit_card_accounts", mappings);
    }
    let statements = 0;
    for (const s of config.statements || []) {
      const m = config.messages.find((m) => m.id === s.mail_id),
        draft = m && parseBankMail(m, registry);
      if (
        !draft?.trusted ||
        normalize(s.bank) !== normalize(draft.bank) ||
        !validDay(s.cut_date) ||
        !validDay(s.due_date) ||
        !Number.isSafeInteger(s.total_cents) ||
        s.total_cents < 0 ||
        !s.source_hash?.match(/^[a-f0-9]{64}$/)
      )
        throw new Error("Invalid statement evidence");
      if (recordMailStatement(db, { ...draft, statement: s })) statements++;
    }
    const declarations=(config.owner_declared_expenses||[]).map(entry=>recordOwnerDeclaration(db,entry,config.id));
    const mail = ingestBankMessages(db, config.messages, { reprocess: true });
    const statement_images=(config.statement_images||[]).map(image=>importStatementImage(db,findAccount(image),image));
    const confirmedBalances=[];
    for(const entry of config.confirmed_balance_updates||[]){
      const account=findAccount(entry);
      if(entry.confirmed!==true||!Number.isSafeInteger(entry.expected_balance_cents)||!Number.isSafeInteger(entry.expected_verified_cents)||entry.balance_cents!==entry.expected_verified_cents||account.verified_cents!==entry.expected_verified_cents)throw new Error('Saved balance confirmation changed; review before applying');
      const result=updateConfirmedBalance(db,{role:'owner',username:'marlon',business_ids:['producalza','gemashow','marjorie','personal'],unit_ids:[]},account.id,entry);
      if(entry.expected_receipt_id&&result.movement_id!==entry.expected_receipt_id)throw new Error('Pending receipt changed; review before applying');
      confirmedBalances.push(result);
    }
    const adjustments=[];
    for(const entry of config.balance_adjustments||[]){
      if(entry.confirmed!==true||!Number.isSafeInteger(entry.delta_cents)||entry.delta_cents===0||!entry.reason?.trim()||!/^[a-f0-9]{64}$/.test(entry.source_hash||''))throw new Error('Invalid authorized balance adjustment');
      const account=findAccount(entry);
      if(db.prepare('SELECT 1 FROM finance_balance_checkpoints WHERE account_id=? AND source_hash=?').get(account.id,entry.source_hash))continue;
      const before=recordedAccountBalance(db,account),after=before+entry.delta_cents,at=new Date().toISOString();
      if(!Number.isSafeInteger(after))throw new Error('Invalid adjusted balance');
      db.prepare('INSERT INTO finance_balance_checkpoints(account_id,as_of_at,balance_cents,source_hash,created_by,created_at) VALUES (?,?,?,?,?,?)').run(account.id,at,after,entry.source_hash,'marlon',at);
      db.prepare('UPDATE finance_accounts SET verified_cents=?,verified_at=? WHERE id=?').run(after,at,account.id);
      const result={account_id:account.id,before_cents:before,after_cents:after,delta_cents:entry.delta_cents,reason:entry.reason};
      audit(db,'marlon','account.balance_adjusted','account',account.id,{balance_cents:before},{...result,requested_by:'marlon',job_id:config.id});
      adjustments.push(result);
    }
    let balances = 0;
    for (const b of config.balances || []) {
      const a = findAccount(b);
      if (
        !Number.isSafeInteger(b.balance_cents) ||
        !Number.isFinite(Date.parse(b.as_of_at)) ||
        Date.parse(b.as_of_at) > Date.now() ||
        !b.source_hash?.match(/^[a-f0-9]{64}$/)
      )
        throw new Error("Invalid balance observation");
      const before = recordedAccountBalance(db, a);
      const changed = db
        .prepare(
          "INSERT OR IGNORE INTO finance_balance_checkpoints (account_id,as_of_at,balance_cents,source_hash,created_by,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(
          a.id,
          b.as_of_at,
          b.balance_cents,
          b.source_hash,
          "system:authorized-bank-review",
          new Date().toISOString(),
        ).changes;
      if (changed) {
        db.prepare(
          "UPDATE finance_accounts SET verified_cents=?,verified_at=? WHERE id=?",
        ).run(b.balance_cents, b.as_of_at, a.id);
        audit(
          db,
          "system:authorized-bank-review",
          "account.balance_observed",
          "account",
          a.id,
          { calculated_cents: before },
          {
            observed_cents: b.balance_cents,
            unexplained_difference_cents: b.balance_cents - before,
            source_hash: b.source_hash,
            as_of_at: b.as_of_at,
            requested_by: "marlon",
          },
        );
        balances++;
      }
    }
    let notices = 0;
    for (const n of config.incoming_notices || []) {
      const a = findAccount(n);
      if (
        !["producalza", "marjorie", "gemashow"].includes(n.business_id) ||
        !Number.isSafeInteger(n.amount_cents) ||
        n.amount_cents <= 0 ||
        !validDay(n.day) ||
        !n.counterparty ||
        !n.source_hash?.match(/^[a-f0-9]{64}$/)
      )
        throw new Error("Invalid incoming notice");
      notices += db
        .prepare(
          "INSERT OR IGNORE INTO finance_incoming_notices (id,business_id,account_id,amount_cents,counterparty,day,source_hash,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          n.id,
          n.business_id,
          a.id,
          n.amount_cents,
          n.counterparty,
          n.day,
          n.source_hash,
          "marlon",
          new Date().toISOString(),
        ).changes;
    }
    let removed = 0;
    for (const r of config.remove_test_requests || []) {
      const m = db
        .prepare("SELECT * FROM finance_movements WHERE id=?")
        .get(r.id);
      if (
        !m ||
        !m.is_payment_request ||
        m.created_by !== r.created_by ||
        m.amount_cents !== r.amount_cents ||
        m.counterparty !== r.counterparty ||
        m.description !== r.description ||
        db
          .prepare(
            "SELECT id FROM finance_payments WHERE request_id=? AND voided_at IS NULL",
          )
          .get(m.id)
      )
        throw new Error("Test request changed; do not remove");
      if (!m.hidden_at) {
        db.prepare(
          "UPDATE finance_movements SET status='rejected',hidden_at=?,review_note='Prueba retirada por solicitud de Marlon',updated_at=? WHERE id=?",
        ).run(new Date().toISOString(), new Date().toISOString(), m.id);
        audit(
          db,
          "system:authorized-bank-review",
          "request.test_removed",
          "request",
          m.id,
          m,
          {
            requested_by: "marlon",
            reason: "Prueba indicada por el propietario",
          },
        );
        removed++;
      }
    }
    const result = {
      applied: true,
      custodies,
      wallets,
      messages: mail.imported,
      statements,
      balances,
      notices,
      removed,
      statement_images,
      declarations,
      adjustments,
      confirmedBalances,
    };
    putPrivateSetting(db, key, result);
    return result;
  })();
}
export function applyPrivateBankReview(db) {
  const payload = process.env.FINANCE_BANK_REVIEW_PAYLOAD;
  if (!payload) return;
  try {
    const decrypted = decryptDocument(
        Buffer.from(payload.replace(/^gz:/, ""), "base64"),
      ),
      config = JSON.parse(
        (payload.startsWith("gz:")
          ? gunzipSync(decrypted, { maxOutputLength: 4 * 1024 * 1024 })
          : decrypted
        ).toString(),
      );
    const result = applyBankReview(db, config);
    if (result.applied)
      console.log("[finance] Bank review applied " + JSON.stringify(result));
  } catch (e) {
    console.error(
      "[finance] Authorized bank review needs attention: " + e.message,
    );
  }
}
export function incomingNotices(db, user) {
  if (
    user.role !== "owner" &&
    !["norma", "normita", "morelia", "german"].includes(user.username)
  )
    return [];
  const names = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z]{4,}/g) || [];
  return db
    .prepare(
      "SELECT n.*,a.bank,a.last_four FROM finance_incoming_notices n JOIN finance_accounts a ON a.id=n.account_id ORDER BY n.day DESC",
    )
    .all()
      .filter((n)=>!n.archived_at && (user.role === "owner" || user.business_ids.includes(n.business_id)))
    .map((n) => {
      const matches = db
        .prepare(
          "SELECT id,counterparty,status FROM finance_movements WHERE business_id=? AND kind='income' AND amount_cents=? AND (account_id IS NULL OR account_id=?) AND evidence_id IS NOT NULL AND hidden_at IS NULL AND status!='rejected' AND day BETWEEN date(?,'-2 days') AND date(?,'+2 days')",
        )
        .all(n.business_id, n.amount_cents, n.account_id, n.day, n.day)
        .filter((m) =>
          names(n.counterparty).some((w) => names(m.counterparty).includes(w)),
        );
      return {
        ...n,
        state: matches.length === 1 ? "receipt_received" : "awaiting_receipt",
        possible_movement_id: matches.length === 1 ? matches[0].id : null,
      };
    });
}
