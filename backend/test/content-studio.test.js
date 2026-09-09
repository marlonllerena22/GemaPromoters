import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import express from 'express';
import sharp from 'sharp';
import { createToken } from '../src/auth.js';
import { initContentStudioDb } from '../src/content-studio-db.js';
import { buildPrompt, PRESETS, registerContentStudioRoutes } from '../src/content-studio-routes.js';

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
  db.prepare("INSERT INTO content_studio_logos (id, establishment_id, name, image_data) VALUES (1, 1, 'Marjorie Botas', ?), (2, 1, 'Sebastian''s', ?)").run(sampleImage, sampleImage);
  const calls = [];
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  registerContentStudioRoutes(app, db, {
    generateImage: async (request) => {
      calls.push(request);
      return { imageData: sampleImage, revisedPrompt: 'mock' };
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

test('prompt accepts any product, keeps editorial text-free and prepares social formats', () => {
  const editorial = buildPrompt({ brand_name: 'Marjorie Botas' }, PRESETS.editorial, true);
  const story = buildPrompt({ social_format: 'story', social_style: 'playful' }, PRESETS.social, false);
  assert.match(editorial, /source-of-truth product/i);
  assert.match(editorial, /wearing, carrying, holding or using/i);
  assert.match(editorial, /Do not include headlines/i);
  assert.match(story, /tall 9:16 story/i);
  assert.match(story, /witty short Spanish headline/i);
  assert.match(story, /Do not add a logo/i);
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

  assert.equal(bootstrap.data.logos.length, 2);
  assert.equal(bootstrap.data.can_manage_logos, false);
  const forbiddenLogo = await request('/logos', { token: clientToken, method: 'POST', body: JSON.stringify({ name: 'No permitido', image: sampleImage }) });
  assert.equal(forbiddenLogo.status, 403);
  const generated = await request('/generate', { token: clientToken, method: 'POST', body: JSON.stringify({ preset: 'catalog', logo_id: 1, product_image: sampleImage }) });
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

test('logos, exact social dimensions, history, limits and business isolation work together', async (t) => {
  const { db, server, request, calls, supreme, waitForGeneration } = fixture();
  t.after(() => { server.close(); db.close(); });

  const createdLogo = await request('/logos', {
    method: 'POST', body: JSON.stringify({ name: 'Marca nueva', image: sampleImage })
  });
  assert.equal(createdLogo.status, 201);

  const foreignLogo = db.prepare("INSERT INTO content_studio_logos (establishment_id, name, image_data) VALUES (2, 'Ajena', ?)").run(sampleImage).lastInsertRowid;
  const foreignAttempt = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'catalog', logo_id: Number(foreignLogo), product_image: sampleImage }) });
  assert.equal(foreignAttempt.status, 400);
  const first = await request('/generate', {
    method: 'POST', body: JSON.stringify({ preset: 'editorial', logo_id: createdLogo.data.id, product_image: sampleImage })
  });
  assert.equal(first.status, 202);
  const firstCompleted = await waitForGeneration(first.data.generation.id);
  assert.equal(firstCompleted.data.usage, 1);
  assert.equal(calls[0].images.length, 2);
  assert.equal(first.data.generation.reference_ids.length, 0);

  const second = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'social', logo_id: 2, social_format: 'story', social_style: 'playful', product_image: sampleImage }) });
  assert.equal(second.status, 202);
  const secondCompleted = await waitForGeneration(second.data.generation.id);
  const output = Buffer.from(secondCompleted.data.generation.output_image_data.split(',')[1], 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
  assert.equal(calls[1].size, '1024x1536');
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
