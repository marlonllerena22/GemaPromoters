import { requireAuth } from './auth.js';

const PRESETS = {
  editorial: {
    name: 'Editorial con modelo',
    description: 'Una modelo real usando el producto con un outfit coherente.',
    size: '1024x1536',
    direction: `Create a high-end editorial fashion photograph with a believable adult female model naturally wearing the exact product. Build a tasteful outfit around the product. Use realistic anatomy, natural skin texture, correct scale, convincing contact shadows and commercial fashion lighting. The uploaded product must remain visually faithful in shape, construction, color, material, sole, stitching and distinctive details.`
  },
  catalog: {
    name: 'Catálogo de producto',
    description: 'Producto protagonista, limpio y listo para catálogo.',
    size: '1024x1024',
    direction: `Create a premium product catalog photograph. Keep the exact uploaded product as the sole hero, arranged naturally on a refined simple set. Preserve its real silhouette, proportions, construction, color, texture, sole, stitching and identifying details. Use controlled studio lighting, crisp focus and realistic contact shadows.`
  },
  social: {
    name: 'Post para redes',
    description: 'Pieza comercial con texto y detalles del producto.',
    size: '1024x1024',
    direction: `Create a polished social media advertising post for a professional retail brand. Keep the uploaded product completely faithful and clearly visible. Use an editorial grid, elegant hierarchy, ample breathing room and a realistic premium product photograph. Render only the exact short Spanish copy explicitly provided, spelled correctly. Do not invent prices, discounts, logos or claims.`
  },
  detail: {
    name: 'Detalle premium',
    description: 'Acercamiento a materiales, textura y acabados.',
    size: '1536x1024',
    direction: `Create a luxury close-up campaign photograph focused on the uploaded product's real craftsmanship, material and finishing. Preserve the exact product design and show credible macro texture, stitching and construction. Use subtle depth of field, realistic premium light and an uncluttered composition.`
  }
};

const MOODS = {
  light: 'minimal, bright, warm-neutral studio styling with soft natural light',
  warm: 'warm premium styling with stone, wood or soft textile accents and restrained earthy colors',
  urban: 'refined urban editorial styling with architectural shadows and contemporary neutral colors',
  color: 'confident brand-color styling with a clean commercial finish and balanced saturation'
};

const clean = (value, max = 160) => String(value ?? '').trim().slice(0, max);
const validDataImage = (value) => /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(String(value || ''));
const dataImageBytes = (value) => Math.ceil((String(value || '').split(',')[1]?.length || 0) * 0.75);

function safeJson(value, fallback = []) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function resolveScope(db, req) {
  const requested = Number(req.body?.establishment_id || req.query?.establishment_id || 0);
  const id = req.user?.role === 'supreme' ? requested : Number(req.user?.establishmentId || 0);
  if (!id) return null;
  const establishment = db.prepare("SELECT * FROM establishments WHERE id = ? AND status = 'active' AND module_type = 'content_studio'").get(id);
  if (establishment) {
    db.prepare(`INSERT OR IGNORE INTO content_studio_settings (establishment_id, plan_name, monthly_limit, brand_name, brand_tone) VALUES (?, 'Profesional', 80, ?, 'premium')`)
      .run(establishment.id, establishment.display_name || establishment.name);
  }
  return establishment;
}

function studioAuth(db) {
  return (req, res, next) => requireAuth(req, res, () => {
    if (!['admin', 'supreme'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Acceso exclusivo de Estudio Creativo' });
    }
    const establishment = resolveScope(db, req);
    if (!establishment) {
      return res.status(403).json({ message: 'Este negocio no tiene habilitado Estudio Creativo' });
    }
    req.contentStudioEstablishment = establishment;
    next();
  });
}

function buildPrompt(body, preset, referenceCount) {
  const details = [
    body.brand_name && `Brand: ${clean(body.brand_name)}.`,
    body.product_name && `Product name: ${clean(body.product_name)}.`,
    body.material && `Verified material: ${clean(body.material)}.`,
    body.color && `Verified color: ${clean(body.color)}.`,
    body.headline && `Exact visible headline: "${clean(body.headline, 80)}".`,
    body.brand_tone && `Brand personality: ${clean(body.brand_tone, 80)}.`
  ].filter(Boolean).join(' ');
  const referenceInstruction = referenceCount
    ? `The images after the first input are style references. Borrow only their broad visual language: lighting, mood, framing, color discipline and level of realism. Do not copy a reference composition, person, logo, text, trade dress or protected character. Never replace the product with an item from a reference.`
    : '';
  return [
    `The first image is the source-of-truth product photo. Create one original professional commercial image.`,
    preset.direction,
    `Art direction: ${MOODS[body.mood] || MOODS.light}.`,
    details,
    referenceInstruction,
    `The result must look photographed by a professional team, not synthetic. Avoid plastic textures, excessive glow, impossible reflections, warped geometry, duplicated parts, extra accessories, fake logos, gibberish and watermarks. Do not alter the product design. Return one finished image only.`
  ].filter(Boolean).join('\n\n');
}

async function defaultGenerate({ images, prompt, size }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada');
  const form = new FormData();
  form.append('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst');
  form.append('prompt', prompt);
  form.append('quality', 'high');
  form.append('size', size);
  form.append('output_format', 'webp');
  images.forEach((image, index) => {
    const match = image.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/is);
    const mime = match[1] === 'jpg' ? 'jpeg' : match[1];
    form.append('image[]', new Blob([Buffer.from(match[2], 'base64')], { type: `image/${mime}` }), `input-${index + 1}.${mime}`);
  });
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI no pudo generar la imagen');
  const encoded = data.data?.[0]?.b64_json;
  if (!encoded) throw new Error('OpenAI no devolvió una imagen');
  return { imageData: `data:image/webp;base64,${encoded}`, revisedPrompt: data.data?.[0]?.revised_prompt || '' };
}

function generationRow(row) {
  return { ...row, reference_ids: safeJson(row.reference_ids_json), reference_ids_json: undefined };
}

export function registerContentStudioRoutes(app, db, options = {}) {
  const guard = studioAuth(db);
  const generateImage = options.generateImage || defaultGenerate;

  app.get('/api/content-studio/bootstrap', guard, (req, res) => {
    const establishmentId = req.contentStudioEstablishment.id;
    const settings = db.prepare('SELECT * FROM content_studio_settings WHERE establishment_id = ?').get(establishmentId);
    const usage = db.prepare("SELECT COUNT(*) AS total FROM content_studio_generations WHERE establishment_id = ? AND status = 'completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')").get(establishmentId).total;
    const references = db.prepare('SELECT id, name, category, image_data, notes, created_at FROM content_studio_references WHERE establishment_id = ? ORDER BY created_at DESC, id DESC').all(establishmentId);
    const generations = db.prepare('SELECT * FROM content_studio_generations WHERE establishment_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 24').all(establishmentId).map(generationRow);
    res.json({
      establishment: { id: establishmentId, name: req.contentStudioEstablishment.display_name || req.contentStudioEstablishment.name },
      settings, usage, generation_available: Boolean(process.env.OPENAI_API_KEY) || Boolean(options.generateImage),
      presets: Object.entries(PRESETS).map(([id, item]) => ({ id, name: item.name, description: item.description, aspect_ratio: item.size })),
      references, generations
    });
  });

  app.post('/api/content-studio/references', guard, (req, res) => {
    const image = String(req.body.image || '');
    const name = clean(req.body.name, 80);
    const category = ['editorial', 'catalog', 'social', 'detail', 'general'].includes(req.body.category) ? req.body.category : 'general';
    if (!name || !validDataImage(image)) return res.status(400).json({ message: 'Nombre e imagen válida son obligatorios' });
    if (dataImageBytes(image) > 5 * 1024 * 1024) return res.status(413).json({ message: 'La referencia no puede superar 5 MB' });
    const result = db.prepare(`INSERT INTO content_studio_references (establishment_id, name, category, image_data, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(req.contentStudioEstablishment.id, name, category, image, clean(req.body.notes, 300), req.user.username || req.user.role);
    res.status(201).json(db.prepare('SELECT id, name, category, image_data, notes, created_at FROM content_studio_references WHERE id = ?').get(result.lastInsertRowid));
  });

  app.delete('/api/content-studio/references/:id', guard, (req, res) => {
    const result = db.prepare('DELETE FROM content_studio_references WHERE id = ? AND establishment_id = ?').run(req.params.id, req.contentStudioEstablishment.id);
    if (!result.changes) return res.status(404).json({ message: 'Referencia no encontrada' });
    res.json({ ok: true });
  });

  app.put('/api/content-studio/settings', guard, (req, res) => {
    const current = db.prepare('SELECT * FROM content_studio_settings WHERE establishment_id = ?').get(req.contentStudioEstablishment.id);
    const monthlyLimit = req.user.role === 'supreme' ? Math.max(1, Math.min(10000, Number(req.body.monthly_limit) || current.monthly_limit)) : current.monthly_limit;
    const planName = req.user.role === 'supreme' ? clean(req.body.plan_name, 60) || current.plan_name : current.plan_name;
    db.prepare(`UPDATE content_studio_settings SET brand_name = ?, brand_tone = ?, plan_name = ?, monthly_limit = ?, updated_at = datetime('now', 'localtime') WHERE establishment_id = ?`)
      .run(clean(req.body.brand_name, 100), clean(req.body.brand_tone, 80) || 'premium', planName, monthlyLimit, req.contentStudioEstablishment.id);
    res.json(db.prepare('SELECT * FROM content_studio_settings WHERE establishment_id = ?').get(req.contentStudioEstablishment.id));
  });

  app.post('/api/content-studio/generate', guard, async (req, res) => {
    const productImage = String(req.body.product_image || '');
    const preset = PRESETS[req.body.preset];
    if (!validDataImage(productImage)) return res.status(400).json({ message: 'Sube una foto válida del producto' });
    if (dataImageBytes(productImage) > 8 * 1024 * 1024) return res.status(413).json({ message: 'La foto del producto no puede superar 8 MB' });
    if (!preset) return res.status(400).json({ message: 'Selecciona un tipo de contenido' });
    const settings = db.prepare('SELECT * FROM content_studio_settings WHERE establishment_id = ?').get(req.contentStudioEstablishment.id);
    const referenceIds = [...new Set((Array.isArray(req.body.reference_ids) ? req.body.reference_ids : []).map(Number).filter(Boolean))].slice(0, 4);
    const references = referenceIds.length ? db.prepare(`SELECT id, image_data FROM content_studio_references WHERE establishment_id = ? AND id IN (${referenceIds.map(() => '?').join(',')})`).all(req.contentStudioEstablishment.id, ...referenceIds) : [];
    const prompt = buildPrompt({ ...req.body, brand_name: req.body.brand_name || settings.brand_name, brand_tone: settings.brand_tone }, preset, references.length);
    const reservation = db.transaction(() => {
      const occupied = db.prepare(`SELECT COUNT(*) AS total FROM content_studio_generations
        WHERE establishment_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
          AND (status = 'completed' OR (status = 'failed' AND error_message = '__processing__' AND created_at >= datetime('now', '-30 minutes')))`)
        .get(req.contentStudioEstablishment.id).total;
      if (occupied >= settings.monthly_limit) return null;
      const inserted = db.prepare(`INSERT INTO content_studio_generations
        (establishment_id, preset, product_name, brand_name, material, color, headline, mood, aspect_ratio, reference_ids_json, status, error_message, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', '__processing__', ?)`)
        .run(req.contentStudioEstablishment.id, req.body.preset, clean(req.body.product_name), clean(req.body.brand_name || settings.brand_name), clean(req.body.material), clean(req.body.color), clean(req.body.headline, 80), clean(req.body.mood) || 'light', preset.size, JSON.stringify(references.map((item) => item.id)), req.user.username || req.user.role);
      return inserted.lastInsertRowid;
    })();
    if (!reservation) return res.status(429).json({ message: 'Se alcanzó el límite mensual del plan' });
    try {
      const generated = await generateImage({ images: [productImage, ...references.map((item) => item.image_data)], prompt, size: preset.size, preset: req.body.preset });
      db.prepare("UPDATE content_studio_generations SET output_image_data = ?, revised_prompt = ?, status = 'completed', error_message = NULL WHERE id = ?")
        .run(generated.imageData, generated.revisedPrompt || '', reservation);
      const usage = db.prepare("SELECT COUNT(*) AS total FROM content_studio_generations WHERE establishment_id = ? AND status = 'completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')").get(req.contentStudioEstablishment.id).total;
      res.status(201).json({ generation: generationRow(db.prepare('SELECT * FROM content_studio_generations WHERE id = ?').get(reservation)), usage, monthly_limit: settings.monthly_limit });
    } catch (error) {
      db.prepare("UPDATE content_studio_generations SET status = 'failed', error_message = ? WHERE id = ?")
        .run(clean(error.message, 500), reservation);
      const configurationError = /OPENAI_API_KEY/.test(error.message);
      res.status(configurationError ? 503 : 502).json({ message: configurationError ? 'Falta configurar la clave de OpenAI en el servidor' : `No se pudo crear la imagen: ${clean(error.message, 220)}` });
    }
  });

  app.delete('/api/content-studio/generations/:id', guard, (req, res) => {
    const result = db.prepare("UPDATE content_studio_generations SET deleted_at = datetime('now', 'localtime'), output_image_data = NULL WHERE id = ? AND establishment_id = ? AND deleted_at IS NULL").run(req.params.id, req.contentStudioEstablishment.id);
    if (!result.changes) return res.status(404).json({ message: 'Creación no encontrada' });
    res.json({ ok: true });
  });
}

export { PRESETS, buildPrompt };
