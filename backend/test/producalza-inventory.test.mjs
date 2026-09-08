import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'producalza-inventory-'));
process.env.DB_PATH = path.join(tempDirectory, 'test.sqlite');

const { db, initDb } = await import('../src/db.js');
const { createToken } = await import('../src/auth.js');
const { registerProducalzaRoutes } = await import('../src/producalza-routes.js');
const { default: express } = await import('express');

let server;

try {
  initDb();

  const business = db.prepare("SELECT id FROM establishments WHERE name = 'PRODUCALZA'").get();
  assert.ok(business?.id, 'Producalza establishment was not created');

  const summary = db.prepare(
    `SELECT COUNT(DISTINCT items.id) AS item_count,
            COALESCE(SUM(variants.quantity), 0) AS total_quantity
     FROM production_inventory_items AS items
     JOIN production_inventory_variants AS variants ON variants.item_id = items.id
     WHERE items.establishment_id = ?`
  ).get(business.id);
  assert.equal(summary.item_count, 72);
  assert.equal(summary.total_quantity, 2176);

  const categories = db.prepare(
    `SELECT category FROM production_inventory_items
     WHERE establishment_id = ? GROUP BY category ORDER BY category`
  ).all(business.id).map((row) => row.category);
  assert.deepEqual(categories, ['Plantas', 'Plantas niñas', 'Suelas', 'Tacos']);

  const s070 = db.prepare(
    `SELECT items.color, variants.variant_label, variants.quantity
     FROM production_inventory_items AS items
     JOIN production_inventory_variants AS variants ON variants.item_id = items.id
     WHERE items.establishment_id = ? AND items.name = 'S 070'
     ORDER BY items.color`
  ).all(business.id);
  assert.deepEqual(s070, [
    { color: 'Cafe', variant_label: 'Sin talla', quantity: 25 },
    { color: 'Negro', variant_label: 'Sin talla', quantity: 50 }
  ]);

  const warehouse = db.prepare(
    `SELECT id, username, password, role, can_view_all_orders, is_local_secretary, is_warehouse, status
     FROM production_users WHERE establishment_id = ? AND username = 'bodega'`
  ).get(business.id);
  assert.deepEqual(warehouse, {
    id: warehouse.id,
    username: 'bodega',
    password: 'bodega123',
    role: 'vendor',
    can_view_all_orders: 0,
    is_local_secretary: 0,
    is_warehouse: 1,
    status: 'active'
  });

  const beforeSecondInit = summary.total_quantity;
  const legacyItem = db.prepare('SELECT * FROM production_inventory_items WHERE establishment_id = ? LIMIT 1').get(business.id);
  const legacyVariants = db.prepare('SELECT * FROM production_inventory_variants WHERE item_id = ?').all(legacyItem.id);
  const legacyHistory = db.prepare('SELECT * FROM production_inventory_movements WHERE item_id = ?').all(legacyItem.id);
  db.prepare("UPDATE production_inventory_items SET category = ' Modelo ', photo_url = 'foto-conservada', alerts_disabled = 1 WHERE id = ?").run(legacyItem.id);
  initDb();
  const migratedItem = db.prepare('SELECT * FROM production_inventory_items WHERE id = ?').get(legacyItem.id);
  assert.equal(migratedItem.category, 'Plantas');
  assert.equal(migratedItem.qr_token, legacyItem.qr_token);
  assert.equal(migratedItem.code, legacyItem.code);
  assert.equal(migratedItem.photo_url, 'foto-conservada');
  assert.equal(migratedItem.alerts_disabled, 1);
  assert.deepEqual(db.prepare('SELECT * FROM production_inventory_variants WHERE item_id = ?').all(legacyItem.id), legacyVariants);
  assert.deepEqual(db.prepare('SELECT * FROM production_inventory_movements WHERE item_id = ?').all(legacyItem.id), legacyHistory);
  const afterSecondInit = db.prepare(
    `SELECT COALESCE(SUM(variants.quantity), 0) AS total_quantity
     FROM production_inventory_items AS items
     JOIN production_inventory_variants AS variants ON variants.item_id = items.id
     WHERE items.establishment_id = ?`
  ).get(business.id).total_quantity;
  assert.equal(afterSecondInit, beforeSecondInit, 'The initial seed must not duplicate stock');

  const app = express();
  app.use(express.json({ limit: '20mb' }));
  registerProducalzaRoutes(app, db, () => business.id);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/producalza`;
  const warehouseToken = createToken({
    role: 'production_vendor',
    username: 'bodega',
    productionUserId: warehouse.id,
    establishmentId: business.id,
    isWarehouse: true
  });
  const adminToken = createToken({
    role: 'production_admin',
    username: 'producalza',
    establishmentId: business.id
  });
  const sellerToken = createToken({
    role: 'production_vendor',
    username: 'vendedor',
    productionUserId: 999,
    establishmentId: business.id
  });
  const warehouseHeaders = { Authorization: `Bearer ${warehouseToken}`, 'Content-Type': 'application/json' };
  const adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  const inventoryResponse = await fetch(`${baseUrl}/inventory`, { headers: warehouseHeaders });
  assert.equal(inventoryResponse.status, 200);
  const inventory = await inventoryResponse.json();
  assert.equal(inventory.summary.item_count, 72);
  assert.equal(inventory.summary.total_quantity, 2176);
  assert.equal(inventory.can_manage_inventory, true);

  const sellerResponse = await fetch(`${baseUrl}/inventory`, {
    headers: { Authorization: `Bearer ${sellerToken}` }
  });
  assert.equal(sellerResponse.status, 403);

  const stockedItem = inventory.items.find((item) => item.variants.some((variant) => variant.quantity > 0));
  const stockedVariant = stockedItem.variants.find((variant) => variant.quantity > 0);
  const movementResponse = await fetch(`${baseUrl}/inventory/${stockedItem.id}/movements`, {
    method: 'POST',
    headers: warehouseHeaders,
    body: JSON.stringify({
      movement_type: 'out',
      variant_id: stockedVariant.id,
      quantity: 1,
      responsible_person: 'Prueba Bodega',
      purpose: 'Prueba automatica'
    })
  });
  assert.equal(movementResponse.status, 201);
  const movement = await movementResponse.json();
  assert.equal(
    movement.item.variants.find((variant) => variant.id === stockedVariant.id).quantity,
    stockedVariant.quantity - 1
  );
  assert.match(movement.movement.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const forbiddenResponse = await fetch(`${baseUrl}/inventory/${stockedItem.id}/movements`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      movement_type: 'in',
      variant_id: stockedVariant.id,
      quantity: 1,
      responsible_person: 'Admin',
      purpose: 'No autorizado'
    })
  });
  assert.equal(forbiddenResponse.status, 403);

  const photoResponse = await fetch(`${baseUrl}/inventory/${stockedItem.id}`, {
    method: 'PATCH',
    headers: warehouseHeaders,
    body: JSON.stringify({ photo_url: 'data:image/webp;base64,QUJD' })
  });
  assert.equal(photoResponse.status, 200);
  assert.equal((await photoResponse.json()).photo_url, 'data:image/webp;base64,QUJD');

  const createResponse = await fetch(`${baseUrl}/inventory`, {
    method: 'POST',
    headers: warehouseHeaders,
    body: JSON.stringify({
      name: 'Material de prueba',
      category: 'Pruebas',
      color: 'Negro',
      price: '12.35',
      variants: [{ label: '34', quantity: 2 }, { label: '35', quantity: 3 }]
    })
  });
  assert.equal(createResponse.status, 201);
  const createdItem = await createResponse.json();
  assert.equal(createdItem.variants.length, 2);
  assert.equal(createdItem.total_quantity, 5);

  const bulkMovementResponse = await fetch(`${baseUrl}/inventory/${createdItem.id}/movements`, {
    method: 'POST',
    headers: warehouseHeaders,
    body: JSON.stringify({
      movement_type: 'out',
      movements: [
        { variant_id: createdItem.variants[0].id, quantity: 1 },
        { variant_id: createdItem.variants[1].id, quantity: 2 }
      ],
      responsible_person: 'Prueba Bodega',
      purpose: 'Salida de varias tallas'
    })
  });
  assert.equal(bulkMovementResponse.status, 201);
  const bulkMovement = await bulkMovementResponse.json();
  assert.equal(bulkMovement.movements.length, 2);
  assert.equal(bulkMovement.item.variants[0].quantity, 1);
  assert.equal(bulkMovement.item.variants[1].quantity, 1);

  const rejectedBulkResponse = await fetch(`${baseUrl}/inventory/${createdItem.id}/movements`, {
    method: 'POST',
    headers: warehouseHeaders,
    body: JSON.stringify({
      movement_type: 'out',
      movements: [
        { variant_id: createdItem.variants[0].id, quantity: 1 },
        { variant_id: createdItem.variants[1].id, quantity: 5 }
      ],
      responsible_person: 'Prueba Bodega',
      purpose: 'Validar operacion completa'
    })
  });
  assert.equal(rejectedBulkResponse.status, 400);
  const afterRejectedBulk = await fetch(`${baseUrl}/inventory/${createdItem.id}`, { headers: warehouseHeaders });
  const unchangedItem = await afterRejectedBulk.json();
  assert.equal(unchangedItem.variants[0].quantity, 1);
  assert.equal(unchangedItem.variants[1].quantity, 1);

  const qrResponse = await fetch(`${baseUrl}/inventory/qr/${createdItem.qr_token}.png`);
  assert.equal(qrResponse.status, 200);
  assert.match(qrResponse.headers.get('content-type') || '', /^image\/png/);
  assert.ok((await qrResponse.arrayBuffer()).byteLength > 1000);

  const request = async (route, method = 'GET', body, headers = warehouseHeaders) => {
    const response = await fetch(baseUrl + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const muted = await request(`/inventory/${createdItem.id}`, 'PATCH', { alerts_disabled: true });
  assert.equal(muted.status, 200);
  assert.equal(muted.data.alerts_disabled, 1);
  assert.equal((await request(`/inventory/${createdItem.id}`)).data.alerts_disabled, 1);
  assert.equal((await request(`/inventory/${createdItem.id}`, 'PATCH', { color: 'Cafe' })).data.alerts_disabled, 1);
  assert.equal((await request(`/inventory/${createdItem.id}`, 'PATCH', { alerts_disabled: 'false' })).status, 400);
  assert.equal((await request(`/inventory/${createdItem.id}`, 'PATCH', { alerts_disabled: false }, adminHeaders)).status, 403);
  assert.equal((await request(`/inventory/${createdItem.id}`, 'PATCH', { alerts_disabled: false })).data.alerts_disabled, 0);

  const newCategories = (await request('/inventory')).data.categories.map((row) => row.category);
  assert.ok(newCategories.includes('Pruebas'));
  assert.ok(!newCategories.some((name) => /^modelos?$/i.test(name)));
  const reclassified = await request(`/inventory/${createdItem.id}`, 'PATCH', { category: 'Modelos' });
  assert.equal(reclassified.data.category, 'Plantas');
  assert.equal(reclassified.data.total_quantity, unchangedItem.total_quantity);

  const inventorySnapshot = () => ({
    items: db.prepare('SELECT * FROM production_inventory_items ORDER BY id').all(),
    variants: db.prepare('SELECT * FROM production_inventory_variants ORDER BY id').all(),
    movements: db.prepare('SELECT * FROM production_inventory_movements ORDER BY id').all()
  });
  const beforePrices = inventorySnapshot();
  const initialPrices = await request('/warehouse-prices');
  assert.equal(initialPrices.status, 200);
  assert.equal(initialPrices.data.length, beforePrices.items.filter((item) => item.status === 'active').length);
  const createdPrice = initialPrices.data.find((row) => row.id === createdItem.id);
  assert.deepEqual(createdPrice, {
    id: createdItem.id,
    price_id: createdPrice.price_id,
    code: createdItem.code,
    category: 'Plantas',
    name: 'Material de prueba',
    color: 'Cafe',
    unit: 'unidades',
    photo_url: '',
    price: 12.35
  });
  assert.equal(createdPrice.total_quantity, undefined);
  assert.equal(db.prepare('SELECT price_cents, inventory_item_id FROM production_warehouse_prices WHERE inventory_item_id = ?').get(createdItem.id).price_cents, 1235);
  assert.equal((await request(`/warehouse-prices/${createdItem.id}`, 'PUT', { price: '10.00' }, adminHeaders)).status, 403);
  assert.equal((await request('/warehouse-prices', 'GET', undefined, { Authorization: `Bearer ${sellerToken}` })).status, 403);
  for (const price of ['', null, -1, '1.005', 'Infinity', 'no es precio']) {
    assert.equal((await request(`/warehouse-prices/${createdItem.id}`, 'PUT', { price })).status, 400);
  }
  assert.equal((await request('/warehouse-prices/999999', 'PUT', { price: 1 })).status, 404);
  const priceUpdated = await request(`/warehouse-prices/${createdItem.id}`, 'PUT', { price: '14.90' });
  assert.equal(priceUpdated.status, 200);
  assert.equal(priceUpdated.data.id, createdItem.id);
  assert.equal(priceUpdated.data.name, 'Material de prueba');
  assert.equal(priceUpdated.data.price, 14.9);
  const priceListAfterUpdate = await request('/warehouse-prices', 'GET', undefined, adminHeaders);
  assert.equal(priceListAfterUpdate.data.find((row) => row.id === createdItem.id).price, 14.9);
  assert.equal((await request(`/warehouse-prices/${createdItem.id}`, 'DELETE', undefined, adminHeaders)).status, 403);
  assert.equal((await request(`/warehouse-prices/${createdItem.id}`, 'DELETE')).status, 200);
  assert.equal((await request('/warehouse-prices')).data.find((row) => row.id === createdItem.id).price, null);
  assert.deepEqual(inventorySnapshot(), beforePrices, 'Price updates must never touch stock or inventory history');

  console.log('Inventory verified: category migration preserves data, alerts persist, prices mirror materials, permissions, movements, photos and QR labels.');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
