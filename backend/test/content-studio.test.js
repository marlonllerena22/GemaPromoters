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
  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token || token}` }
    });
    return { status: response.status, data: await response.json() };
  }
  return { db, server, request, calls, supreme };
}

test('prompt keeps the product as source of truth and references as style only', () => {
  const prompt = buildPrompt({ mood: 'warm', product_name: 'Bota Ámbar', headline: 'Camina diferente' }, PRESETS.social, 3);
  assert.match(prompt, /source-of-truth product/i);
  assert.match(prompt, /Borrow only their broad visual language/i);
  assert.match(prompt, /Do not copy a reference composition/i);
  assert.match(prompt, /Camina diferente/);
});

test('references, generation history, plan limit and business isolation work together', async (t) => {
  const { db, server, request, calls, supreme } = fixture();
  t.after(() => { server.close(); db.close(); });

  const createdReference = await request('/references', {
    method: 'POST', body: JSON.stringify({ name: 'Luz editorial', category: 'editorial', image: sampleImage, notes: 'Sombras suaves' })
  });
  assert.equal(createdReference.status, 201);

  const foreignReference = db.prepare("INSERT INTO content_studio_references (establishment_id, name, category, image_data) VALUES (2, 'Ajena', 'general', ?)").run(sampleImage).lastInsertRowid;
  const first = await request('/generate', {
    method: 'POST', body: JSON.stringify({ preset: 'editorial', mood: 'warm', product_image: sampleImage, reference_ids: [createdReference.data.id, Number(foreignReference)], product_name: 'Bota Ámbar' })
  });
  assert.equal(first.status, 201);
  assert.equal(first.data.usage, 1);
  assert.equal(calls[0].images.length, 2);
  assert.equal(first.data.generation.reference_ids.length, 1);

  const second = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'catalog', product_image: sampleImage }) });
  assert.equal(second.status, 201);
  const limit = await request('/generate', { method: 'POST', body: JSON.stringify({ preset: 'detail', product_image: sampleImage }) });
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
