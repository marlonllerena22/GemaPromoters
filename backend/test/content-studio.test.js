import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import sharp from 'sharp';
import { createToken } from '../src/auth.js';
import { initContentStudioDb, verifyContentStudioPassword } from '../src/content-studio-db.js';
import crypto from 'node:crypto';
import { buildPrompt, normalizeLogoForStorage, PRESETS, registerContentStudioRoutes, resizeSocialOutput } from '../src/content-studio-routes.js';

process.env.JWT_SECRET = 'content-studio-test-secret';
const sampleImageBuffer = await sharp({ create: { width: 180, height: 220, channels: 3, background: '#9a6245' } }).png().toBuffer();
const sampleImage = `data:image/png;base64,${sampleImageBuffer.toString('base64')}`;

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE establishments (
      id INTEGER PRIMARY KEY, name TEXT, display_name TEXT, status TEXT, module_type TEXT
    );
    INSERT INTO establishments VALUES
      (1, 'ESTUDIOS CREATIVOS', 'Estudios Creativos', 'active', 'content_studio'),
      (2, 'OTRO ESTUDIO', 'Otro estudio', 'active', 'content_studio'),
      (3, 'PRODUCALZA', 'Producalza', 'active', 'production');
  `);
  initContentStudioDb(db);
  db.prepare("INSERT INTO content_studio_settings (establishment_id, plan_name, monthly_limit, brand_name) VALUES (1, 'Prueba', 2, 'Marca Uno')").run();
  db.prepare("INSERT INTO content_studio_settings (establishment_id, plan_name, monthly_limit, brand_name) VALUES (2, 'Prueba', 2, 'Marca Dos')").run();
  db.prepare("INSERT INTO content_studio_users (id, establishment_id, name, business_name, username, password_hash, credit_limit, plan_name, monthly_limit, subscription_status, paid_until, status) VALUES (1, 1, 'Cliente', 'Zapatería Demo', 'cliente.demo', 'hash', 80, 'Profesional', 80, 'paid', '2099-12-31', 'active')").run();
  db.prepare("INSERT INTO content_studio_logos (id, establishment_id, content_studio_user_id, name, image_data) VALUES (1, 1, NULL, 'Marjorie Botas', ?), (2, 1, NULL, 'Sebastian''s', ?), (3, 1, 1, 'Marjorie Botas', ?), (4, 1, 1, 'Sebastian''s', ?)").run(sampleImage, sampleImage, sampleImage, sampleImage);
  const calls = [];
  const researchCalls = [];
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  registerContentStudioRoutes(app, db, {
    generateImage: async (request) => {
      calls.push(request);
      const [width, height] = String(request.size).split('x').map(Number);
      const generated = await sharp({ create: { width, height, channels: 3, background: '#9a6245' } }).webp().toBuffer();
      return { imageData: `data:image/webp;base64,${generated.toString('base64')}`, revisedPrompt: 'mock' };
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
    INSERT INTO content_studio_users (id, establishment_id, name, business_name, username, password_hash) VALUES
      (1, 1, 'Existente', 'Existente', 'existente', 'hash'),
      (2, 1, 'Martha Bosque', 'Martha Bosque', 'martha.bosque', 'hash'),
      (3, 1, 'Norma Llamuca', 'Norma Llamuca', 'norma.llamuca', 'hash');
    CREATE TABLE content_studio_logos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, establishment_id INTEGER NOT NULL, name TEXT NOT NULL, image_data TEXT NOT NULL,
      created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare("INSERT INTO content_studio_logos (establishment_id, name, image_data) VALUES (1, 'Logo anterior', ?)").run(sampleImage);
  initContentStudioDb(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM content_studio_logos WHERE content_studio_user_id = 1').get().total, 1);
  assert.equal(db.prepare('SELECT credit_limit FROM content_studio_users WHERE id = 1').get().credit_limit, 80);
  assert.equal(db.prepare("SELECT can_delete_generations FROM content_studio_users WHERE username = 'martha.bosque'").get().can_delete_generations, 0);
  assert.equal(db.prepare("SELECT can_delete_generations FROM content_studio_users WHERE username = 'norma.llamuca'").get().can_delete_generations, 0);
  assert.equal(db.prepare("SELECT can_delete_generations FROM content_studio_users WHERE username = 'existente'").get().can_delete_generations, 1);
  assert.equal(db.prepare('SELECT user_logos_isolated FROM content_studio_settings WHERE establishment_id = 1').get().user_logos_isolated, 1);
  initContentStudioDb(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM content_studio_logos WHERE content_studio_user_id = 1').get().total, 1);
  db.prepare("INSERT INTO content_studio_users (establishment_id, name, business_name, username, password_hash) VALUES (1, 'Nuevo', 'Nuevo', 'nuevo', 'hash')").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM content_studio_logos WHERE content_studio_user_id = (SELECT id FROM content_studio_users WHERE username = 'nuevo')").get().total, 0);
  assert.equal(db.prepare("SELECT credit_limit FROM content_studio_users WHERE username = 'nuevo'").get().credit_limit, 0);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_studio_payment_events'").get());
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
  assert.match(editorial, /only permitted extra closure is one internal-side zipper/i);
  assert.match(editorial, /second reference image is the exact official brand logo/i);
  assert.doesNotMatch(editorial, /Brand: Marjorie Botas/i);
  assert.match(catalog, /source photo contains exactly one footwear item/i);
  assert.match(catalog, /rear matching boot must show one realistic internal-side zipper/i);
  assert.match(catalog, /must never become a simplified, smooth or generic version/i);
  assert.match(catalog, /textured panels, material changes, overlays, diagonal seams/i);
  assert.match(catalog, /every other non-footwear product.+never duplicate it/i);
  assert.match(story, /complete edge-to-edge vertical 9:16 Story\/Reel/i);
  assert.match(benefits, /complete edge-to-edge vertical 4:5 Instagram feed post/i);
  assert.match(story, /witty product-specific Spanish concept/i);
  assert.match(story, /Optional real characteristics the user wants to highlight/i);
  assert.match(story, /The user explained what they want to achieve with this image/i);
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
  assert.equal(bootstrap.data.subscription.status, 'paid');
  assert.equal(bootstrap.data.subscription.active, true);
  assert.equal(bootstrap.data.can_manage_references, false);
  assert.deepEqual(bootstrap.data.users, []);
  assert.equal((await request('/users', { token: clientToken })).status, 403);

  assert.equal(bootstrap.data.logos.length, 0);
  const initialLogos = await request('/logos', { token: clientToken });
  assert.equal(initialLogos.data.logos.length, 2);
  assert.equal(bootstrap.data.can_manage_logos, true);
  const clientLogo = await request('/logos', { token: clientToken, method: 'POST', body: JSON.stringify({ name: 'Marca del cliente', image: sampleImage }) });
  assert.equal(clientLogo.status, 201);
  assert.match(clientLogo.data.image_data, /^data:image\/png;base64,/);
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
  assert.equal(calls[0].images.length, 2);
  assert.equal(completed.data.generation.product_name, 'vaquita que corre viral');
  assert.match(calls[0].prompt, /second reference image is the exact official brand logo/i);
  assert.equal(db.prepare('SELECT content_studio_user_id FROM content_studio_generations WHERE id = ?').get(generated.data.generation.id).content_studio_user_id, 1);

  const unrelated = await request('/generate', { token: clientToken, method: 'POST', body: JSON.stringify({ preset: 'catalog', logo_id: 'none', product_image: sampleImage }) });
  assert.equal(unrelated.status, 202);
  await waitForGeneration(unrelated.data.generation.id, clientToken);
  assert.equal(researchCalls.length, 1);
  assert.doesNotMatch(calls[1].prompt, /vaquita que corre|video viral/i);

  const adminBootstrap = await request('/bootstrap');
  assert.equal(adminBootstrap.data.generations.length, 0);
  const clientBootstrap = await request('/bootstrap', { token: clientToken });
  assert.equal(clientBootstrap.data.generations.length, 0);
  const clientHistory = await request('/generations', { token: clientToken });
  assert.equal(clientHistory.data.generations.length, 2);
  assert.equal(clientBootstrap.data.usage, 2);
});

test('advanced batches persist their group and enforce the required plan on the server', async (t) => {
  const { db, server, request, clientToken, waitForGeneration } = fixture();
  t.after(() => { server.close(); db.close(); });

  const collection = await request('/generate', {
    token: clientToken,
    method: 'POST',
    body: JSON.stringify({
      preset: 'social',
      product_image: sampleImage,
      creative_instruction: 'Colección con luz y paleta compartidas',
      creation_group_id: 'collection-test-1',
      creation_group_type: 'collection',
      creation_group_position: 2
    })
  });
  assert.equal(collection.status, 202);
  const completed = await waitForGeneration(collection.data.generation.id, clientToken);
  assert.equal(completed.data.generation.creation_group_id, 'collection-test-1');
  assert.equal(completed.data.generation.creation_group_type, 'collection');
  assert.equal(completed.data.generation.creation_group_position, 2);
  assert.equal(completed.data.generation.headline, 'Colección con luz y paleta compartidas');

  const premiumOnly = await request('/generate', {
    token: clientToken,
    method: 'POST',
    body: JSON.stringify({
      preset: 'social',
      product_image: sampleImage,
      creation_group_id: 'week-test-1',
      creation_group_type: 'week',
      creation_group_position: 1
    })
  });
  assert.equal(premiumOnly.status, 403);
  assert.equal(premiumOnly.data.code, 'ADVANCED_PLAN_REQUIRED');
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

  const foreignLogo = db.prepare("INSERT INTO content_studio_logos (establishment_id, name, image_data) VALUES (2, 'Ajena', ?)").run(sampleImage).lastInsertRowid;
  const foreignAttempt = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'catalog', logo_id: Number(foreignLogo), product_image: sampleImage }) });
  assert.equal(foreignAttempt.status, 400);
  const first = await request('/generate', {
    method: 'POST', body: JSON.stringify({ preset: 'editorial', editorial_subject: 'animal', logo_id: createdLogo.data.id, product_image: sampleImage })
  });
  assert.equal(first.status, 202);
  const firstCompleted = await waitForGeneration(first.data.generation.id);
  assert.equal(firstCompleted.data.generation.status, 'completed');
  assert.equal(firstCompleted.data.usage, 1);
  assert.equal(calls[0].images.length, 2);
  assert.match(calls[0].prompt, /believable animal model/i);
  assert.equal(db.prepare('SELECT mood FROM content_studio_generations WHERE id = ?').get(first.data.generation.id).mood, 'animal');
  assert.equal(first.data.generation.reference_ids.length, 0);

  const second = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'social', logo_id: 2, contact_whatsapp: '0983763419', contact_location: 'Centro de Ambato', social_format: 'story', social_style: 'playful', product_image: sampleImage }) });
  assert.equal(second.status, 202);
  const secondCompleted = await waitForGeneration(second.data.generation.id);
  const output = Buffer.from(secondCompleted.data.generation.output_image_data.split(',')[1], 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
  assert.equal(calls[1].size, '864x1536');
  assert.match(calls[1].prompt, /WhatsApp: 0983763419/i);
  assert.match(calls[1].prompt, /Location: Centro de Ambato/i);
  const limit = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'detail', logo_id: 'none', product_image: sampleImage }) });
  assert.equal(limit.status, 429);

  assert.equal((await request(`/logos/${createdLogo.data.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/generations/${first.data.generation.id}`, { method: 'DELETE' })).status, 200);
  const bootstrap = await request('/bootstrap');
  assert.equal(bootstrap.data.usage, 2);
  assert.equal(bootstrap.data.generations.length, 0);
  assert.equal(bootstrap.data.logos.length, 0);
  assert.equal((await request('/generations')).data.generations.length, 1);
  assert.equal((await request('/logos')).data.logos.length, 2);

  const wrongScope = await request('/bootstrap?establishment_id=3', { token: supreme });
  assert.equal(wrongScope.status, 403);
  const otherScope = await request('/bootstrap?establishment_id=2', { token: supreme });
  assert.equal(otherScope.status, 200);
  assert.equal(otherScope.data.logos.length, 0);
  assert.equal((await request('/logos?establishment_id=2', { token: supreme })).data.logos.length, 1);
});

test('a verified magic link creates a zero-credit account once and generation routes it to a plan', async (t) => {
  const { db, server, request } = fixture();
  t.after(() => { server.close(); db.close(); });
  const token = 'one-use-login-token';
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare(`INSERT INTO content_studio_magic_links
    (establishment_id, email, token_hash, expires_at) VALUES (1, 'nuevo@estudio.test', ?, datetime('now', '+20 minutes'))`).run(tokenHash);

  const verified = await request('/auth/magic-link/verify', { method: 'POST', body: JSON.stringify({ token }) });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.user.email, 'nuevo@estudio.test');
  assert.deepEqual(verified.data.user.auth_methods, ['magic_link']);
  const account = db.prepare("SELECT * FROM content_studio_users WHERE email = 'nuevo@estudio.test'").get();
  assert.equal(account.credit_limit, 0);
  assert.equal(account.subscription_status, 'inactive');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM content_studio_logos WHERE content_studio_user_id = ?').get(account.id).total, 0);

  const reused = await request('/auth/magic-link/verify', { method: 'POST', body: JSON.stringify({ token }) });
  assert.equal(reused.status, 400);
  const newUserToken = verified.data.token;
  const bootstrap = await request('/bootstrap', { token: newUserToken });
  assert.equal(bootstrap.data.available_credits, 0);
  assert.equal(bootstrap.data.subscription.active, false);
  const generation = await request('/generate', { token: newUserToken, method: 'POST', body: JSON.stringify({ preset: 'catalog', logo_id: 'none', product_image: sampleImage }) });
  assert.equal(generation.status, 403);
  assert.equal(generation.data.code, 'PLAN_REQUIRED');

  const order = await request('/plan-orders', { token: newUserToken, method: 'POST', body: JSON.stringify({ plan_id: 'emprendedor', business_name: 'Negocio Nuevo', whatsapp: '0981112233' }) });
  assert.equal(order.status, 201);
  assert.equal(order.data.order.content_studio_user_id, account.id);
  const confirmed = await request(`/plan-orders/${order.data.order.id}/confirm`, { method: 'POST', body: JSON.stringify({ reference: 'BANCO-25' }) });
  assert.equal(confirmed.status, 200);
  const active = await request('/bootstrap', { token: newUserToken });
  assert.equal(active.data.subscription.active, true);
  assert.equal(active.data.available_credits, 25);
});

test('social output preserves the native aspect ratio and never crops the generated canvas', async () => {
  for (const format of [{ sourceWidth: 1024, sourceHeight: 1280, width: 1080, height: 1350 }, { sourceWidth: 864, sourceHeight: 1536, width: 1080, height: 1920 }]) {
    const source = await sharp({ create: { width: format.sourceWidth, height: format.sourceHeight, channels: 3, background: '#eee8df' } })
      .composite([{ input: Buffer.from(`<svg width="${format.sourceWidth}" height="${format.sourceHeight}"><rect x="0" y="0" width="32" height="${format.sourceHeight}" fill="#713e2b"/><rect x="${format.sourceWidth - 32}" y="0" width="32" height="${format.sourceHeight}" fill="#713e2b"/></svg>`) }])
      .png().toBuffer();
    const result = await resizeSocialOutput(`data:image/png;base64,${source.toString('base64')}`, format);
    const buffer = Buffer.from(result.split(',')[1], 'base64');
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.width, format.width);
    assert.equal(metadata.height, format.height);
    assert.equal(metadata.format, 'webp');
  }
  const wrongRatio = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#eee8df' } }).png().toBuffer();
  await assert.rejects(
    resizeSocialOutput(`data:image/png;base64,${wrongRatio.toString('base64')}`, { width: 1080, height: 1350 }),
    /proporción distinta/i
  );
});

test('new logos are normalized and stored as transparent-capable PNG references', async () => {
  const source = await sharp({ create: { width: 180, height: 90, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="180" height="90"><rect x="20" y="20" width="140" height="50" fill="#c88743"/></svg>') }])
    .webp().toBuffer();
  const normalized = await normalizeLogoForStorage(`data:image/webp;base64,${source.toString('base64')}`);
  const metadata = await sharp(Buffer.from(normalized.split(',')[1], 'base64')).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.hasAlpha, true);
});

test('the administrator controls whether each user can delete generated images', async (t) => {
  const { db, server, request, clientToken, waitForGeneration } = fixture();
  t.after(() => { server.close(); db.close(); });
  const created = await request('/generate', { token: clientToken, method: 'POST', body: JSON.stringify({ preset: 'catalog', logo_id: 'none', product_image: sampleImage }) });
  assert.equal(created.status, 202);
  await waitForGeneration(created.data.generation.id, clientToken);

  const blocked = await request('/users/1', { method: 'PUT', body: JSON.stringify({ can_delete_generations: false }) });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.data.can_delete_generations, 0);
  const blockedBootstrap = await request('/bootstrap', { token: clientToken });
  assert.equal(blockedBootstrap.data.can_delete_generations, false);
  const denied = await request(`/generations/${created.data.generation.id}`, { token: clientToken, method: 'DELETE' });
  assert.equal(denied.status, 403);

  const allowed = await request('/users/1', { method: 'PUT', body: JSON.stringify({ can_delete_generations: true }) });
  assert.equal(allowed.data.can_delete_generations, 1);
  assert.equal((await request(`/generations/${created.data.generation.id}`, { token: clientToken, method: 'DELETE' })).status, 200);
});
