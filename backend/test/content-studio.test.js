import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import sharp from 'sharp';
import { createToken } from '../src/auth.js';
import { initContentStudioDb, verifyContentStudioPassword } from '../src/content-studio-db.js';
import { buildPrompt, overlayContactDetails, overlayOfficialLogo, PRESETS, registerContentStudioRoutes } from '../src/content-studio-routes.js';

process.env.JWT_SECRET = 'content-studio-test-secret';
const sampleImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVR4nGM42Z0NRwzEcQDckhvxhhMR2AAAAABJRU5ErkJggg==';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE establishments (
      id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, status TEXT, module_type TEXT
    );
    INSERT INTO establishments VALUES
      (1, 'ESTUDIO CREATIVO', 'Estudio Creativo', 'active', 'content_studio'),
      (2, 'OTRO ESTUDIO', 'Otro estudio', 'active', 'content_studio'),
      (3, 'PRODUCALZA', 'Producalza', 'active', 'production');
  `);
  initContentStudioDb(db);
  db.prepare("INSERT INTO content_studio_settings (establishment_id, plan_name, monthly_limit, brand_name) VALUES (1, 'Prueba', 2, 'Marca Uno')").run();
  db.prepare("INSERT INTO content_studio_settings (establishment_id, plan_name, monthly_limit, brand_name) VALUES (2, 'Prueba', 2, 'Marca Dos')").run();
  db.prepare("INSERT INTO content_studio_users (id, establishment_id, name, business_name, username, password_hash, plan_name, monthly_limit, subscription_status, paid_until, status) VALUES (1, 1, 'Cliente', 'Zapatería Demo', 'cliente.demo', 'hash', 'Profesional', 80, 'paid', '2099-12-31', 'active')").run();
  db.prepare("INSERT INTO content_studio_logos (id, establishment_id, content_studio_user_id, name, image_data) VALUES (1, 1, NULL, 'Marjorie Botas', ?), (2, 1, NULL, 'Sebastian''s', ?), (3, 1, 1, 'Marjorie Botas', ?), (4, 1, 1, 'Sebastian''s', ?)").run(sampleImage, sampleImage, sampleImage, sampleImage);
  const calls = [];
  const researchCalls = [];
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  registerContentStudioRoutes(app, db, {
    generateImage: async (request) => {
      calls.push(request);
      return { imageData: sampleImage, revisedPrompt: 'mock' };
    },
    researchProduct: async (productName) => {
      researchCalls.push(productName);
      return 'Personaje de peluche asociado a un video viral de una vaquita que corre.';
    }
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/content-studio`;
  const token = createToken({ role: 'admin', username: 'studio', establishmentId: 1 });
  const supreme = createToken({ role: 'supreme', username: 'root' });
  const clientToken = createToken({ role: 'content_studio_user', username: 'cliente.demo', contentStudioUserId: 1, establishmentId: 1 });
  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token || token}` }
    });
    return { status: response.status, data: await response.json() };
  }
  async function waitForGeneration(id, token) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const result = await request(`/generations/${id}`, { token });
      if (result.data.generation?.status !== 'processing') return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('La generación de prueba no terminó');
  }
  return { db, server, request, calls, researchCalls, supreme, clientToken, waitForGeneration };
}

test('legacy logos remain available to existing users while future accounts start empty', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE establishments (id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, status TEXT, module_type TEXT);
    INSERT INTO establishments VALUES (1, 'ESTUDIO', 'Estudio', 'active', 'content_studio');
    CREATE TABLE content_studio_settings (
      establishment_id INTEGER PRIMARY KEY, plan_name TEXT NOT NULL DEFAULT 'Profesional', monthly_limit INTEGER NOT NULL DEFAULT 80,
      brand_name TEXT, brand_tone TEXT NOT NULL DEFAULT 'premium', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
    );
    INSERT INTO content_studio_settings (establishment_id) VALUES (1);
    CREATE TABLE content_studio_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, establishment_id INTEGER NOT NULL, name TEXT NOT NULL, business_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, plan_name TEXT NOT NULL DEFAULT 'Profesional', monthly_limit INTEGER NOT NULL DEFAULT 80,
      subscription_status TEXT NOT NULL DEFAULT 'inactive', paid_at TEXT, paid_until TEXT, brand_tone TEXT NOT NULL DEFAULT 'premium',
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
    );
    INSERT INTO content_studio_users (id, establishment_id, name, business_name, username, password_hash) VALUES (1, 1, 'Existente', 'Existente', 'existente', 'hash');
    CREATE TABLE content_studio_logos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, establishment_id INTEGER NOT NULL, name TEXT NOT NULL, image_data TEXT NOT NULL,
      created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare("INSERT INTO content_studio_logos (establishment_id, name, image_data) VALUES (1, 'Logo anterior', ?)").run(sampleImage);
  initContentStudioDb(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM content_studio_logos WHERE content_studio_user_id = 1').get().total, 1);
  assert.equal(db.prepare('SELECT user_logos_isolated FROM content_studio_settings WHERE establishment_id = 1').get().user_logos_isolated, 1);
  initContentStudioDb(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM content_studio_logos WHERE content_studio_user_id = 1').get().total, 1);
  db.prepare("INSERT INTO content_studio_users (establishment_id, name, business_name, username, password_hash) VALUES (1, 'Nuevo', 'Nuevo', 'nuevo', 'hash')").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM content_studio_logos WHERE content_studio_user_id = (SELECT id FROM content_studio_users WHERE username = 'nuevo')").get().total, 0);
  db.close();
});

test('prompt accepts any product, adapts the editorial model and prepares social formats', () => {
  const editorial = buildPrompt({ brand_name: 'Marjorie Botas', editorial_subject: 'female', product_name: 'vaquita que corre viral', research_context: 'Juguete infantil basado en un personaje viral.' }, PRESETS.editorial, true);
  const masculine = buildPrompt({ editorial_subject: 'male' }, PRESETS.editorial, false);
  const animal = buildPrompt({ editorial_subject: 'animal' }, PRESETS.editorial, false);
  const catalog = buildPrompt({}, PRESETS.catalog, false);
  const story = buildPrompt({ social_format: 'story', social_style: 'playful', product_features: 'suavidad y cierre lateral', creative_instruction: 'Que se sienta listo para regalar' }, PRESETS.social, false);
  const benefits = buildPrompt({ social_format: 'post', social_style: 'product', product_features: 'cuero genuino y plantilla acolchada' }, PRESETS.social, false);
  assert.match(editorial, /source-of-truth product/i);
  assert.match(editorial, /wearing, carrying, holding or using/i);
  assert.match(editorial, /adult woman by default/i);
  assert.match(editorial, /Choose a girl only when.+children/i);
  assert.match(masculine, /adult man by default/i);
  assert.match(animal, /believable animal model/i);
  assert.match(animal, /Never force human footwear/i);
  assert.match(editorial, /Do not include headlines/i);
  assert.match(editorial, /zipper visible only on the inward or rear shoe/i);
  assert.match(editorial, /composited by the application/i);
  assert.doesNotMatch(editorial, /Brand: Marjorie Botas/i);
  assert.match(catalog, /source photo contains exactly one shoe/i);
  assert.match(catalog, /rear shoe must show the internal-side zipper exactly once/i);
  assert.match(catalog, /every other non-footwear product.+never duplicate it/i);
  assert.match(story, /tall 9:16 story/i);
  assert.match(benefits, /central 1024 × 1280 area is the exact final canvas/i);
  assert.match(story, /witty product-specific Spanish concept/i);
  assert.match(story, /Optional real characteristics the user wants to highlight/i);
  assert.match(story, /Optional user creative direction/i);
  assert.match(benefits, /two or three short Spanish benefit callouts/i);
  assert.match(story, /Do not add a logo/i);
});

test('a paid client gets its own plan, usage, history and brand management', async (t) => {
  const { db, server, request, calls, researchCalls, clientToken, waitForGeneration } = fixture();
  t.after(() => { server.close(); db.close(); });
  const bootstrap = await request('/bootstrap', { token: clientToken });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.data.settings.plan_name, 'Profesional');
  assert.equal(bootstrap.data.settings.brand_name, 'Zapatería Demo');
  const savedContact = await request('/settings', { token: clientToken, method: 'PUT', body: JSON.stringify({ brand_name: 'Zapatería Demo', brand_tone: 'premium', contact_whatsapp: '0983763419', contact_location: 'Centro de Ambato' }) });
  assert.equal(savedContact.status, 200);
  assert.equal(savedContact.data.contact_whatsapp, '0983763419');
  assert.equal(savedContact.data.contact_location, 'Centro de Ambato');
  assert.equal(bootstrap.data.subscription.status, 'paid');
  assert.equal(bootstrap.data.subscription.active, true);
  assert.equal(bootstrap.data.can_manage_references, false);
  assert.deepEqual(bootstrap.data.users, []);
  assert.equal((await request('/users', { token: clientToken })).status, 403);

  assert.equal(bootstrap.data.logos.length, 2);
  assert.equal(bootstrap.data.can_manage_logos, true);
  const clientLogo = await request('/logos', { token: clientToken, method: 'POST', body: JSON.stringify({ name: 'Marca del cliente', image: sampleImage }) });
  assert.equal(clientLogo.status, 201);
  assert.equal(db.prepare('SELECT content_studio_user_id FROM content_studio_logos WHERE id = ?').get(clientLogo.data.id).content_studio_user_id, 1);
  assert.equal((await request(`/logos/${clientLogo.data.id}`, { token: clientToken, method: 'DELETE' })).status, 200);
  assert.equal((await request('/users', { token: clientToken, method: 'POST', body: JSON.stringify({ name: 'Otra persona', username: 'otra', password: 'Password25!' }) })).status, 403);
  const generated = await request('/generate', { token: clientToken, method: 'POST', body: JSON.stringify({ preset: 'catalog', logo_id: 3, product_name: 'vaquita que corre viral', product_image: sampleImage }) });
  assert.equal(generated.status, 202);
  const completed = await waitForGeneration(generated.data.generation.id, clientToken);
  assert.equal(completed.data.generation.status, 'completed');
  assert.equal(calls.length, 1);
  assert.deepEqual(researchCalls, ['vaquita que corre viral']);
  assert.match(calls[0].prompt, /Personaje de peluche asociado a un video viral/i);
  assert.equal(calls[0].images.length, 1);
  assert.equal(completed.data.generation.product_name, 'vaquita que corre viral');
  assert.doesNotMatch(calls[0].prompt, /Reproduce that supplied logo/i);
  assert.equal(db.prepare('SELECT content_studio_user_id FROM content_studio_generations WHERE id = ?').get(generated.data.generation.id).content_studio_user_id, 1);

  const unrelated = await request('/generate', { token: clientToken, method: 'POST', body: JSON.stringify({ preset: 'catalog', logo_id: 'none', product_image: sampleImage }) });
  assert.equal(unrelated.status, 202);
  await waitForGeneration(unrelated.data.generation.id, clientToken);
  assert.equal(researchCalls.length, 1);
  assert.doesNotMatch(calls[1].prompt, /vaquita que corre|video viral/i);

  const adminBootstrap = await request('/bootstrap');
  assert.equal(adminBootstrap.data.generations.length, 0);
  const clientBootstrap = await request('/bootstrap', { token: clientToken });
  assert.equal(clientBootstrap.data.generations.length, 2);
  assert.equal(clientBootstrap.data.usage, 2);
});

test('logos, exact social dimensions, history, limits and business isolation work together', async (t) => {
  const { db, server, request, calls, supreme, waitForGeneration } = fixture();
  t.after(() => { server.close(); db.close(); });

  const publicStudio = await request('/public');
  assert.equal(publicStudio.status, 200);
  assert.deepEqual(publicStudio.data.plans.map((plan) => plan.photos), [10, 25, 60, 150]);
  assert.equal(publicStudio.data.plans.find((plan) => plan.id === 'inicio').price, 9.5);
  assert.equal(publicStudio.data.contact.phone, '0983763419');
  const planOrder = await request('/public/orders', {
    method: 'POST', body: JSON.stringify({
      customer_name: 'Cliente Landing', business_name: 'Tienda Landing', whatsapp: '0981112233',
      email: 'cliente@landing.test', username: 'cliente.landing', password: 'Landing25!', plan_id: 'emprendedor'
    })
  });
  assert.equal(planOrder.status, 201);
  assert.equal(planOrder.data.order.amount, 20);
  assert.equal(planOrder.data.order.password_hash, undefined);
  const confirmedOrder = await request(`/plan-orders/${planOrder.data.order.id}/confirm`, {
    method: 'POST', body: JSON.stringify({ reference: 'TRANS-001' })
  });
  assert.equal(confirmedOrder.status, 200);
  assert.equal(confirmedOrder.data.user.username, 'cliente.landing');
  assert.equal(verifyContentStudioPassword('Landing25!', db.prepare("SELECT password_hash FROM content_studio_users WHERE username = 'cliente.landing'").get().password_hash), true);

  const createdUser = await request('/users', {
    method: 'POST', body: JSON.stringify({ name: 'Norma Llamuca', business_name: 'Norma Llamuca', username: 'norma.llamuca', password: 'NormaFoto25!', plan_name: 'Emprendedor', monthly_limit: 25, duration_days: 15 })
  });
  assert.equal(createdUser.status, 201);
  assert.equal(createdUser.data.monthly_limit, 25);
  assert.equal(createdUser.data.subscription_status, 'paid');
  const newUserToken = createToken({ role: 'content_studio_user', username: 'norma.llamuca', contentStudioUserId: createdUser.data.id, establishmentId: 1 });
  const newUserBootstrap = await request('/bootstrap', { token: newUserToken });
  assert.equal(newUserBootstrap.status, 200);
  assert.deepEqual(newUserBootstrap.data.logos, []);
  const storedUser = db.prepare('SELECT password_hash FROM content_studio_users WHERE id = ?').get(createdUser.data.id);
  assert.equal(verifyContentStudioPassword('NormaFoto25!', storedUser.password_hash), true);
  assert.equal((await request('/users', { method: 'POST', body: JSON.stringify({ name: 'Norma', username: 'norma.llamuca', password: 'OtraClave25!' }) })).status, 409);
  const listedUsers = await request('/users');
  assert.equal(listedUsers.status, 200);
  assert.equal(listedUsers.data.some((item) => item.username === 'norma.llamuca' && item.usage === 0), true);
  const renewedUser = await request(`/users/${createdUser.data.id}`, {
    method: 'PUT', body: JSON.stringify({ monthly_limit: 60, plan_name: 'Negocio', renew_days: 30, status: 'active' })
  });
  assert.equal(renewedUser.status, 200);
  assert.equal(renewedUser.data.monthly_limit, 60);
  assert.equal(renewedUser.data.subscription_status, 'paid');

  const createdLogo = await request('/logos', {
    method: 'POST', body: JSON.stringify({ name: 'Marca nueva', image: sampleImage })
  });
  assert.equal(createdLogo.status, 201);
  const savedContact = await request('/settings', { method: 'PUT', body: JSON.stringify({ brand_name: 'Marca Uno', brand_tone: 'premium', contact_whatsapp: '0983763419', contact_location: 'Centro de Ambato' }) });
  assert.equal(savedContact.status, 200);
  assert.equal(savedContact.data.contact_whatsapp, '0983763419');

  const foreignLogo = db.prepare("INSERT INTO content_studio_logos (establishment_id, name, image_data) VALUES (2, 'Ajena', ?)").run(sampleImage).lastInsertRowid;
  const foreignAttempt = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'catalog', logo_id: Number(foreignLogo), product_image: sampleImage }) });
  assert.equal(foreignAttempt.status, 400);
  const first = await request('/generate', {
    method: 'POST', body: JSON.stringify({ preset: 'editorial', editorial_subject: 'animal', logo_id: createdLogo.data.id, product_image: sampleImage })
  });
  assert.equal(first.status, 202);
  const firstCompleted = await waitForGeneration(first.data.generation.id);
  assert.equal(firstCompleted.data.usage, 1);
  assert.equal(calls[0].images.length, 1);
  assert.match(calls[0].prompt, /believable animal model/i);
  assert.equal(db.prepare('SELECT mood FROM content_studio_generations WHERE id = ?').get(first.data.generation.id).mood, 'animal');
  assert.equal(first.data.generation.reference_ids.length, 0);

  const second = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'social', logo_id: 2, include_contact: true, social_format: 'story', social_style: 'playful', product_image: sampleImage }) });
  assert.equal(second.status, 202);
  const secondCompleted = await waitForGeneration(second.data.generation.id);
  const output = Buffer.from(secondCompleted.data.generation.output_image_data.split(',')[1], 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
  assert.equal(calls[1].size, '1024x1536');
  assert.match(calls[1].prompt, /lower 12%/i);
  const limit = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'detail', logo_id: 'none', product_image: sampleImage }) });
  assert.equal(limit.status, 429);

  assert.equal((await request(`/logos/${createdLogo.data.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/generations/${first.data.generation.id}`, { method: 'DELETE' })).status, 200);
  const bootstrap = await request('/bootstrap');
  assert.equal(bootstrap.data.usage, 2);
  assert.equal(bootstrap.data.generations.length, 1);
  assert.equal(bootstrap.data.logos.length, 2);

  const wrongScope = await request('/bootstrap?establishment_id=3', { token: supreme });
  assert.equal(wrongScope.status, 403);
  const otherScope = await request('/bootstrap?establishment_id=2', { token: supreme });
  assert.equal(otherScope.status, 200);
  assert.equal(otherScope.data.logos.length, 1);
});

test('the official logo is composited after generation without changing the canvas proportions', async () => {
  const canvas = await sharp({
    create: { width: 600, height: 900, channels: 3, background: { r: 235, g: 225, b: 215 } }
  }).webp().toBuffer();
  const logo = await sharp({
    create: { width: 300, height: 120, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).composite([{ input: Buffer.from('<svg width="300" height="120"><text x="30" y="78" fill="#ef3b24" font-size="58">MARCA</text></svg>') }]).png().toBuffer();
  const result = await overlayOfficialLogo(
    `data:image/webp;base64,${canvas.toString('base64')}`,
    `data:image/png;base64,${logo.toString('base64')}`
  );
  const output = Buffer.from(result.split(',')[1], 'base64');
  const metadata = await sharp(output).metadata();
  const stats = await sharp(output).stats();
  assert.equal(metadata.width, 600);
  assert.equal(metadata.height, 900);
  assert.ok(stats.channels[0].min < 235);
});

test('the exact saved contact details are composited locally without changing the image size', async () => {
  const canvas = await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 238, g: 232, b: 224 } } }).webp().toBuffer();
  const result = await overlayContactDetails(`data:image/webp;base64,${canvas.toString('base64')}`, '0983763419', 'Centro de Ambato');
  const output = Buffer.from(result.split(',')[1], 'base64');
  const metadata = await sharp(output).metadata();
  const bottom = await sharp(output).extract({ left: 20, top: 760, width: 560, height: 120 }).stats();
  assert.equal(metadata.width, 600);
  assert.equal(metadata.height, 900);
  assert.ok(bottom.channels[0].min < 80);
});
