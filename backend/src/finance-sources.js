import { audit, financeDay } from "./finance-db.js";
import crypto from "node:crypto";
import { importSale, tableExists } from "./finance-service.js";
import { privateSetting } from "./finance-operations.js";
const sourceTime = (value) => {
  const s = String(value || "").replace(" ", "T");
  return Date.parse(
    /(Z|[+-]\d{2}:\d{2})$/.test(s)
      ? s
      : s + (process.env.FINANCE_LEGACY_TIMESTAMP_OFFSET || "Z"),
  );
};

export function syncInternalSources(db, user) {
  const cutoff = privateSetting(db, "opening_cutoff");
  return db.transaction(() => {
    let payments = 0,
      sales = 0;
    if (tableExists(db, "production_order_payments")) {
      const rows = db
        .prepare(
          `SELECT p.*,o.order_number,c.name customer_name FROM production_order_payments p
        JOIN production_orders o ON o.id=p.order_id JOIN production_clients c ON c.id=o.client_id
        WHERE o.deleted_at IS NULL AND p.payment_type<>'saldo'`,
        )
        .all();
      for (const p of rows) {
        if (
          db
            .prepare(
              "SELECT id FROM finance_movements WHERE production_payment_id=? AND production_payment_owned=1",
            )
            .get(p.id)
        )
          continue;
        const old = db
          .prepare(
            "SELECT * FROM finance_movements WHERE source_system='producalza' AND business_id='producalza' AND external_id=?",
          )
          .get(String(p.id));
        if (
          !old &&
          cutoff &&
          (!Number.isFinite(sourceTime(p.created_at)) ||
            sourceTime(p.created_at) <= Date.parse(cutoff))
        )
          continue;
        // Legacy evidence must never override a bank-reconciled transaction.
        if (old && old.status !== "reported") continue;
        if (p.status !== "paid" || p.amount <= 0) {
          if (old) {
            db.prepare(
              "UPDATE finance_movements SET status='rejected',review_note='El registro de origen ya no figura pagado',updated_at=? WHERE id=?",
            ).run(new Date().toISOString(), old.id);
            audit(
              db,
              user.username,
              "legacy.cancelled",
              "movement",
              old.id,
              old,
              { source_status: p.status },
              "producalza",
            );
          }
          continue;
        }
        const amount = Math.round(p.amount * 100);
        const date = String(p.payment_date || p.created_at).slice(0, 10);
        if (
          old &&
          old.amount_cents === amount &&
          old.reference === (p.reference || "") &&
          old.day === date
        )
          continue;
        if (old) {
          db.prepare(
            "UPDATE finance_movements SET amount_cents=?,day=?,reference=?,updated_at=? WHERE id=?",
          ).run(
            amount,
            date,
            p.reference || "",
            new Date().toISOString(),
            old.id,
          );
          audit(
            db,
            user.username,
            "legacy.updated",
            "movement",
            old.id,
            old,
            { amount_cents: amount, day: date },
            "producalza",
          );
        } else {
          const result = db
            .prepare(
              `INSERT INTO finance_movements (business_id,unit_id,kind,amount_cents,day,category,counterparty,description,reference,status,order_id,source_system,external_id,created_by)
            VALUES ('producalza','producalza-fabrica','income',?,?,'Abono de pedido',?,?,?,'reported',?,'producalza',?,?)`,
            )
            .run(
              amount,
              date,
              p.customer_name,
              `Abono histórico · ${p.order_number || p.order_id}. Acreditación pendiente de contrastar.`,
              p.reference || "",
              p.order_id,
              String(p.id),
              user.username,
            );
          audit(
            db,
            user.username,
            "legacy.imported",
            "movement",
            result.lastInsertRowid,
            null,
            { source: "producalza", payment_id: p.id },
            "producalza",
          );
        }
        payments++;
      }
    }
    if (tableExists(db, "ticketing_orders")) {
      const rows = db
        .prepare(
          `SELECT o.*,e.title event_title FROM ticketing_orders o JOIN ticketing_events e ON e.id=o.event_id`,
        )
        .all();
      for (const o of rows) {
        if (
          cutoff &&
          Math.max(sourceTime(o.created_at) || 0, sourceTime(o.paid_at) || 0) <=
            Date.parse(cutoff) &&
          !db
            .prepare(
              "SELECT id FROM finance_sales WHERE source_system='protickets' AND external_id=?",
            )
            .get(String(o.id))
        )
          continue;
        const unitId = `gemashow-event-${o.event_id}`;
        db.prepare(
          "INSERT OR IGNORE INTO finance_units (id,business_id,name,kind,source_id) VALUES (?,'gemashow',?,'event',?)",
        ).run(unitId, o.event_title, String(o.event_id));
        const state =
          o.payment_status === "paid"
            ? "active"
            : o.payment_status === "refunded"
              ? "refunded"
              : ["rejected", "expired"].includes(o.payment_status)
                ? "cancelled"
                : "pending";
        const total = Math.round(o.total * 100);
        const timestamp = String(o.updated_at || o.created_at);
        // Render's existing naive source timestamps are UTC. Override only after auditing a legacy dataset.
        const withZone = (value) => {
          const normalized = value.replace(" ", "T");
          return new Date(
            /(Z|[+-]\d{2}:\d{2})$/.test(normalized)
              ? normalized
              : `${normalized}${process.env.FINANCE_LEGACY_TIMESTAMP_OFFSET || "Z"}`,
          ).toISOString();
        };
        let version = withZone(timestamp);
        const revision = crypto
          .createHash("sha256")
          .update(
            JSON.stringify([
              o.event_id,
              o.order_number,
              o.paid_at,
              o.created_at,
              o.updated_at,
              o.total,
              o.payment_method,
              o.payment_status,
            ]),
          )
          .digest("hex");
        const previous = db
          .prepare(
            "SELECT * FROM finance_sales WHERE source_system='protickets' AND business_id='gemashow' AND external_id=?",
          )
          .get(String(o.id));
        if (
          previous &&
          JSON.parse(previous.payload_json).source_revision === revision
        )
          continue;
        // Internal source tables have second-resolution timestamps. Their current snapshot is authoritative.
        if (previous && version <= previous.source_updated_at)
          version = new Date(
            Date.parse(previous.source_updated_at) + 1,
          ).toISOString();
        const result = importSale(
          db,
          {
            business_id: "gemashow",
            unit_id: unitId,
            source_system: "protickets",
            external_id: String(o.id),
            source_revision: revision,
            document_number: o.order_number,
            day: financeDay(withZone(String(o.paid_at || o.created_at))),
            total_cents: total,
            refunded_cents: state === "refunded" ? total : 0,
            state,
            payments:
              state === "active"
                ? [
                    {
                      method:
                        o.payment_method === "transfer"
                          ? "transfer"
                          : "payphone",
                      amount_cents: total,
                    },
                  ]
                : [],
            source_updated_at: version,
          },
          user.username,
        );
        if (!result.ignored) sales++;
      }
    }
    const detail = tableExists(db, "production_orders")
      ? "Pedidos y abonos internos disponibles. Los abonos históricos no acreditan saldo bancario."
      : "Vista de demostración sin conexión al repositorio operativo.";
    db.prepare(
      `INSERT INTO finance_sync_log (source,last_run,count,state,detail) VALUES ('internal',?,?,'ready',?)
      ON CONFLICT(source) DO UPDATE SET last_run=excluded.last_run,count=excluded.count,state=excluded.state,detail=excluded.detail`,
    ).run(new Date().toISOString(), payments + sales, detail);
    audit(
      db,
      user.username,
      "sources.synced",
      "integration",
      "internal",
      null,
      { payments, sales },
    );
    return { payments, sales };
  })();
}

export function startFinanceSyncWorker(db) {
  if (
    process.env.FINANCE_INTERNAL_SYNC_ENABLED === "0" ||
    (!tableExists(db, "production_orders") &&
      !tableExists(db, "ticketing_orders"))
  )
    return null;
  const execute = () => {
    if (!db.open) return;
    if (
      !db
        .prepare(
          "SELECT id FROM finance_members WHERE role='owner' AND active=1",
        )
        .get()
    )
      return;
    try {
      syncInternalSources(db, { username: "system:internal-sync" });
    } catch {
      db.prepare(
        `INSERT INTO finance_sync_log (source,last_run,state,detail) VALUES ('internal',?,'attention','La sincronización no terminó. Revisa las fuentes antes de utilizar sus totales.')
        ON CONFLICT(source) DO UPDATE SET state=excluded.state,detail=excluded.detail`,
      ).run(new Date().toISOString());
      console.error("[finance] Internal synchronization needs review");
    }
  };
  const startup = setTimeout(execute, 1500);
  startup.unref();
  const interval = setInterval(execute, 60_000);
  interval.unref();
  return { startup, interval };
}

export function productionOrders(db, query = "") {
  if (!tableExists(db, "production_orders")) return [];
  return db
    .prepare(
      `SELECT o.id,o.order_number,o.order_date,c.name customer_name,
    COALESCE((SELECT SUM(total_pairs*unit_price) FROM production_order_models WHERE order_id=o.id),0)+o.shipping_value-o.discount_value total,
    COALESCE((SELECT SUM(amount) FROM production_order_payments WHERE order_id=o.id AND status='paid' AND payment_type<>'saldo'),0) paid
    FROM production_orders o JOIN production_clients c ON c.id=o.client_id
    WHERE o.deleted_at IS NULL AND o.order_type='order' AND (o.order_number LIKE ? OR c.name LIKE ?) ORDER BY o.id DESC LIMIT 30`,
    )
    .all(`%${query}%`, `%${query}%`);
}
