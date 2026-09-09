import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import { createToken } from '../src/auth.js';
import { initContentStudioDb } from '../src/content-studio-db.js';
import { buildPrompt, PRESETS, registerContentStudioRoutes } from '../src/content-studio-routes.js';

process.env.JWT_SECRET = 'content-studio-test-secret';
const sampleImage = 'data:image/png;base64,iVBORw0KGgo=';

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
  const calls = [];
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  registerContentStudioRoutes(app, db, {
    generateImage: async (request) => {
      calls.push(request);
      return { imageData: 'data:image/webp;base64,b3V0cHV0', revisedPrompt: 'mock' };
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
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await request(`/generations/${id}`, { token });
      if (result.data.generation?.status !== 'processing') return result;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('La generación de prueba no terminó');
  }
  return { db, server, request, calls, supreme, clientToken, waitForGeneration };
}

test('prompt keeps the product as source of truth and references as style only', () => {
  const prompt = buildPrompt({ mood: 'warm', product_name: 'Bota Ámbar', headline: 'Camina diferente' }, PRESETS.social, 3);
  assert.match(prompt, /source-of-truth product/i);
  assert.match(prompt, /Borrow only their broad visual language/i);
  assert.match(prompt, /Do not copy a reference composition/i);
  assert.match(prompt, /Camina diferente/);
});

test('a paid client gets its own plan, usage and history without admin access to references', async (t) => {
  const { db, server, request, calls, clientToken, waitForGeneration } = fixture();
  t.after(() => { server.close(); db.close(); });
  const bootstrap = await request('/bootstrap', { token: clientToken });
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.data.settings.plan_name, 'Profesional');
  assert.equal(bootstrap.data.settings.brand_name, 'Zapatería Demo');
  assert.equal(bootstrap.data.subscription.status, 'paid');
  assert.equal(bootstrap.data.subscription.active, true);
  assert.equal(bootstrap.data.can_manage_references, false);

  const forbiddenReference = await request('/references', { token: clientToken, method: 'POST', body: JSON.stringify({ name: 'No permitida', image: sampleImage }) });
  assert.equal(forbiddenReference.status, 403);
  const generated = await request('/generate', { token: clientToken, method: 'POST', body: JSON.stringify({ preset: 'catalog', brand_id: 'marjorie', product_image: sampleImage }) });
  assert.equal(generated.status, 202);
  const completed = await waitForGeneration(generated.data.generation.id, clientToken);
  assert.equal(completed.data.generation.status, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].images.length, 2);
  assert.equal(db.prepare('SELECT content_studio_user_id FROM content_studio_generations WHERE id = ?').get(generated.data.generation.id).content_studio_user_id, 1);

  const adminBootstrap = await request('/bootstrap');
  assert.equal(adminBootstrap.data.generations.length, 0);
  const clientBootstrap = await request('/bootstrap', { token: clientToken });
  assert.equal(clientBootstrap.data.generations.length, 1);
  assert.equal(clientBootstrap.data.usage, 1);
});

test('references, generation history, plan limit and business isolation work together', async (t) => {
  const { db, server, request, calls, supreme, waitForGeneration } = fixture();
  t.after(() => { server.close(); db.close(); });

  const createdReference = await request('/references', {
    method: 'POST', body: JSON.stringify({ name: 'Luz editorial', category: 'editorial', image: sampleImage, notes: 'Sombras suaves' })
  });
  assert.equal(createdReference.status, 201);

  const foreignReference = db.prepare("INSERT INTO content_studio_references (establishment_id, name, category, image_data) VALUES (2, 'Ajena', 'general', ?)").run(sampleImage).lastInsertRowid;
  const first = await request('/generate', {
    method: 'POST', body: JSON.stringify({ preset: 'editorial', brand_id: 'marjorie', product_image: sampleImage, reference_ids: [createdReference.data.id, Number(foreignReference)] })
  });
  assert.equal(first.status, 202);
  const firstCompleted = await waitForGeneration(first.data.generation.id);
  assert.equal(firstCompleted.data.usage, 1);
  assert.equal(calls[0].images.length, 3);
  assert.equal(first.data.generation.reference_ids.length, 1);

  const second = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'catalog', brand_id: 'sebastians', product_image: sampleImage }) });
  assert.equal(second.status, 202);
  await waitForGeneration(second.data.generation.id);
  const limit = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'detail', brand_id: 'marjorie', product_image: sampleImage }) });
  assert.equal(limit.status, 429);

  assert.equal((await request(`/generations/${first.data.generation.id}`, { method: 'DELETE' })).status, 200);
  const bootstrap = await request('/bootstrap');
  assert.equal(bootstrap.data.usage, 2);
  assert.equal(bootstrap.data.generations.length, 1);

  const wrongScope = await request('/bootstrap?establishment_id=3', { token: supreme });
  assert.equal(wrongScope.status, 403);
  const otherScope = await request('/bootstrap?establishment_id=2', { token: supreme });
  assert.equal(otherScope.status, 200);
  assert.equal(otherScope.data.references.length, 1);
});
