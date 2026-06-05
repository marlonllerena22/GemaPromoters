import dotenv from 'dotenv';
import { db, initDb, toMoney } from './db.js';

dotenv.config();
initDb();

const promoters = [
  ['Camila Vera', '0912345678', '0991112222', '@camilavera', 'GEMA-CAMI', 'active'],
  ['Mateo Rios', '0923456789', '0983334444', '@mateorios', 'GEMA-MATEO', 'active'],
  ['Sofia Andrade', '0934567890', '0975556666', '@sofiandrade', 'GEMA-SOFI', 'inactive']
];

const insertPromoter = db.prepare(
  'INSERT OR IGNORE INTO promoters (name, cedula, whatsapp, instagram, code, status) VALUES (?, ?, ?, ?, ?, ?)'
);

for (const promoter of promoters) {
  insertPromoter.run(...promoter);
}

const camila = db.prepare("SELECT id FROM promoters WHERE code = 'GEMA-CAMI'").get();
const mateo = db.prepare("SELECT id FROM promoters WHERE code = 'GEMA-MATEO'").get();

const insertSale = db.prepare(
  `INSERT INTO sales
   (promoter_id, customer, customer_whatsapp, location, quantity, unit_price, total, commission, sale_date, payment_status)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now', 'localtime'), ?)`
);

if (db.prepare('SELECT COUNT(*) AS total FROM sales').get().total === 0) {
  const demoSales = [
    [camila.id, 'Andrea Molina', '0990001111', 'VIP', 2, 35, 'paid'],
    [camila.id, 'Luis Zambrano', '0990002222', 'General', 3, 20, 'pending'],
    [mateo.id, 'Karen Lopez', '0990003333', 'Preferencia', 1, 28, 'paid']
  ];

  for (const [promoterId, customer, whatsapp, location, quantity, price, status] of demoSales) {
    const total = toMoney(quantity * price);
    insertSale.run(promoterId, customer, whatsapp, location, quantity, price, total, toMoney(total * 0.03), status);
  }
}

console.log('Datos de ejemplo listos.');
