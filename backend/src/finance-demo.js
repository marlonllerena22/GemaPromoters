import crypto from "node:crypto";
import { audit, financeDay, passwordHash } from "./finance-db.js";
import { importSale } from "./finance-service.js";

export function seedFinanceDemo(db) {
  if (db.prepare("SELECT id FROM finance_members LIMIT 1").get()) return;
  db.transaction(() => {
    db.prepare(
      "INSERT INTO finance_members (name,username,password_hash,role,business_ids) VALUES (?,?,?,?,?)",
    ).run(
      "Administrador",
      "demo",
      passwordHash(crypto.randomBytes(24).toString("hex")),
      "owner",
      JSON.stringify(["producalza", "marjorie", "gemashow", "personal"]),
    );
    const today = financeDay();
    const month = today.slice(0, 7);
    const opening = `${month}-01`;
    const account = db.prepare(
      "INSERT INTO finance_accounts (business_id,name,bank,kind,last_four,custodian,opening_cents,opening_date) VALUES (?,?,?,?,?,?,?,?)",
    );
    const pichincha = Number(
      account.run(
        null,
        "Cuenta principal",
        "Pichincha",
        "bank",
        "4028",
        "Administrador",
        1854000,
        opening,
      ).lastInsertRowid,
    );
    const produ = Number(
      account.run(
        "producalza",
        "Operación Producalza",
        "Produbanco",
        "bank",
        "1836",
        "Administrador",
        1236000,
        opening,
      ).lastInsertRowid,
    );
    const marj = Number(
      account.run(
        "marjorie",
        "Recaudación locales",
        "Guayaquil",
        "bank",
        "7291",
        "Administrador",
        864000,
        opening,
      ).lastInsertRowid,
    );
    const gema = Number(
      account.run(
        "gemashow",
        "Producción de eventos",
        "Pacífico",
        "bank",
        "0512",
        "Administrador",
        428000,
        opening,
      ).lastInsertRowid,
    );
    const payphone = Number(
      account.run(
        "gemashow",
        "Ticketera",
        "Payphone",
        "wallet",
        "2026",
        "Ticketera",
        194000,
        opening,
      ).lastInsertRowid,
    );
    account.run(
      "personal",
      "Gastos personales",
      "Deuna",
      "wallet",
      "8540",
      "Administrador",
      18500,
      opening,
    );
    account.run(
      "marjorie",
      "Caja · Norte",
      "Efectivo",
      "cash",
      "",
      "Encargado Norte",
      25000,
      opening,
    );
    account.run(
      "gemashow",
      "Fondos por entregar",
      "Custodia",
      "custody",
      "",
      "Henry",
      120000,
      opening,
    );
    account.run(
      "personal",
      "Consumos personales",
      "Tarjeta",
      "card",
      "936",
      "Administrador",
      -42800,
      opening,
    );
    db.prepare(
      "INSERT INTO finance_units (id,business_id,name,kind) VALUES ('gemashow-demo-event','gemashow','Noche en vivo · evento de ejemplo','event')",
    ).run();
    const days = Number(today.slice(-2));
    const insertMovement =
      db.prepare(`INSERT INTO finance_movements (business_id,unit_id,account_id,kind,amount_cents,day,due_date,category,counterparty,description,reference,payment_method,status,created_by,reviewed_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertBank = db.prepare(
      "INSERT INTO finance_bank_transactions (account_id,day,amount_cents,reference,description,fingerprint,batch_id,created_by) VALUES (?,?,?,?,?,?,?,?)",
    );
    const add = (
      business,
      unit,
      accountId,
      kind,
      amount,
      date,
      category,
      name,
      status,
      description = "",
      method = "transfer",
      due = null,
    ) => {
      const reference = `DEMO-${business.slice(0, 2).toUpperCase()}-${date.slice(-2)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const id = Number(
        insertMovement.run(
          business,
          unit,
          accountId,
          kind,
          amount,
          date,
          due,
          category,
          name,
          description,
          reference,
          method,
          status,
          "demo",
          status === "approved" ? "demo" : null,
        ).lastInsertRowid,
      );
      if (status === "reconciled") {
        const bank = insertBank.run(
          accountId,
          date,
          kind === "income" ? amount : -amount,
          reference,
          name,
          crypto.randomUUID(),
          "demostracion",
          "demo",
        );
        db.prepare(
          "INSERT INTO finance_allocations (bank_transaction_id,movement_id,amount_cents,created_by) VALUES (?,?,?,?)",
        ).run(bank.lastInsertRowid, id, amount, "demo");
      }
      return id;
    };
    for (let day = 1; day <= days; day++) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      add(
        "producalza",
        "producalza-fabrica",
        produ,
        "income",
        32000 + ((day * 1937) % 57000),
        date,
        "Abono de pedido",
        `Cliente de ejemplo ${day}`,
        "reconciled",
        `Abono de pedido · información ficticia`,
      );
      add(
        "marjorie",
        "marjorie-norte",
        marj,
        "income",
        28000 + ((day * 2691) % 29000),
        date,
        "Ventas de local",
        "Local Norte",
        "reconciled",
        "Depósito de recaudación · ejemplo",
      );
      add(
        "producalza",
        "producalza-fabrica",
        produ,
        "expense",
        12000 + ((day * 1273) % 19000),
        date,
        "Materiales",
        "Proveedor de materiales",
        "reconciled",
        "Compra de materiales · ejemplo",
      );
      if (day % 2 === 0)
        add(
          "gemashow",
          "gemashow-demo-event",
          gema,
          "expense",
          9500 + day * 1300,
          date,
          "Producción de evento",
          "Servicios de producción",
          "reconciled",
          "Pago de producción · ejemplo",
        );
      for (const [index, unit] of [
        "norte",
        "valle",
        "bosque",
        "sur",
      ].entries()) {
        const total = 42000 + day * 1300 + index * 2500;
        importSale(
          db,
          {
            business_id: "marjorie",
            unit_id: `marjorie-${unit}`,
            source_system: "demo",
            external_id: `${date}-${unit}`,
            document_number: `EJ-${day}${index}`,
            day: date,
            total_cents: total,
            refunded_cents: 0,
            state: "active",
            payments: [
              { method: "cash", amount_cents: 20000 },
              { method: "card", amount_cents: 12000 },
              { method: "transfer", amount_cents: total - 32000 },
            ],
            source_updated_at: `${date}T18:00:00-05:00`,
          },
          "demo",
        );
      }
      importSale(
        db,
        {
          business_id: "gemashow",
          unit_id: "gemashow-demo-event",
          source_system: "demo",
          external_id: `evento-${date}`,
          document_number: `PT-EJ-${day}`,
          day: date,
          total_cents: 38000 + day * 400,
          refunded_cents: 0,
          state: "active",
          payments: [{ method: "payphone", amount_cents: 38000 + day * 400 }],
          source_updated_at: `${date}T19:00:00-05:00`,
        },
        "demo",
      );
    }
    add(
      "producalza",
      "producalza-fabrica",
      pichincha,
      "income",
      38500,
      today,
      "Abono de pedido",
      "Cliente de ejemplo",
      "pending",
      "Comprobante recibido por Normita. Pendiente de verificar acreditación.",
    );
    add(
      "producalza",
      "producalza-fabrica",
      produ,
      "expense",
      124500,
      today,
      "Materiales",
      "Proveedor de suelas",
      "pending",
      "Solicitud de pago de materiales",
      "transfer",
      today,
    );
    add(
      "marjorie",
      "marjorie-valle",
      marj,
      "expense",
      89000,
      today,
      "Arriendo",
      "Arriendo · Valle",
      "approved",
      "Compromiso pendiente de pago",
      "transfer",
      `${month}-15`,
    );
    add(
      "gemashow",
      "gemashow-demo-event",
      gema,
      "expense",
      65000,
      today,
      "Producción de evento",
      "Equipo técnico",
      "pending",
      "Anticipo solicitado para el evento",
      "transfer",
      `${month}-20`,
    );
    add(
      "personal",
      null,
      null,
      "expense",
      4200,
      today,
      "Gasolina",
      "Estación de servicio",
      "pending",
      "Consumo personal por clasificar",
      "card",
    );
    add(
      "producalza",
      "producalza-fabrica",
      null,
      "income",
      25000,
      today,
      "Abono de pedido",
      "Abono histórico de ejemplo",
      "reported",
      "Registro anterior sin evidencia bancaria",
    );
    insertBank.run(
      pichincha,
      today,
      38500,
      "DEMO-RECIBIDO-01",
      "Transferencia por identificar",
      crypto.randomUUID(),
      "demostracion",
      "demo",
    );
    const rule = db.prepare(
      "INSERT INTO finance_recurring (business_id,unit_id,name,category,counterparty,amount_cents,due_day,created_by) VALUES (?,?,?,?,?,?,?,?)",
    );
    rule.run(
      "marjorie",
      "marjorie-norte",
      "Arriendo del local Norte",
      "Arriendo",
      "Arrendador Norte",
      120000,
      5,
      "demo",
    );
    rule.run(
      "marjorie",
      "marjorie-bosque",
      "Internet del local",
      "Servicios",
      "Proveedor de internet",
      4500,
      12,
      "demo",
    );
    rule.run(
      "marjorie",
      null,
      "Publicidad mensual",
      "Publicidad",
      "Agencia de redes",
      35000,
      15,
      "demo",
    );
    const budget = db.prepare(
      "INSERT INTO finance_budgets (business_id,month,category,amount_cents) VALUES (?,?,?,?)",
    );
    budget.run("producalza", month, "Materiales", 450000);
    budget.run("marjorie", month, "Arriendo", 400000);
    budget.run("gemashow", month, "Producción de evento", 250000);
    const a = db
      .prepare("SELECT * FROM finance_accounts WHERE id=?")
      .get(produ);
    const balance =
      a.opening_cents +
      db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents),0) n FROM finance_bank_transactions WHERE account_id=?",
        )
        .get(produ).n;
    db.prepare(
      "UPDATE finance_accounts SET verified_cents=?,verified_at=? WHERE id=?",
    ).run(balance, `${today}T23:59:59-05:00`, produ);
    db.prepare(
      "UPDATE finance_sync_log SET state='demo',detail='Datos ficticios de demostración. Conexión real pendiente.'",
    ).run();
    audit(db, "demo", "demo.created", "environment", "demo", null, {
      fictitious: true,
    });
  })();
}
