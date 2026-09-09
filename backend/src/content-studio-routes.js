import { requireAuth } from './auth.js';
import { hashContentStudioPassword } from './content-studio-db.js';
import sharp from 'sharp';

const PRESETS = {
  editorial: {
    name: 'Editorial con modelo',
    description: 'Una modelo real usando el producto con un outfit coherente.',
    size: '1024x1536',
    direction: `Create a high-end editorial fashion photograph with a believable adult female model naturally wearing, carrying, holding or using the exact uploaded product in the way appropriate for that object. Build a tasteful scene or outfit around it. Use realistic anatomy, natural skin texture, correct scale, convincing contact shadows and commercial fashion lighting. Never add advertising copy or decorative text. The uploaded product must remain visually faithful in shape, construction, color, material and distinctive details.`
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
    direction: `Create a polished social media advertising design around the exact uploaded product. Combine a photorealistic commercial product image with strong graphic design, clean typography, deliberate hierarchy and generous breathing room. Invent one short, memorable Spanish headline appropriate to the visible product and render it correctly. You may add one very short supporting line, but never invent prices, discounts, contact details, technical specifications or unverifiable claims.`
  },
  detail: {
    name: 'Detalle premium',
    description: 'Acercamiento a materiales, textura y acabados.',
    size: '1536x1024',
    direction: `Create a luxury product-detail campaign composition focused on the uploaded object's real craftsmanship and finish. Preserve the exact product design. Show one elegant hero view plus two or three carefully framed macro detail views when the composition allows it, revealing only details truly visible in the source photo. Use credible texture, subtle depth of field, realistic premium light and an uncluttered layout without text.`
  }
};

const SOCIAL_FORMATS = {
  post: { label: 'Post 1080 × 1350', width: 1080, height: 1350, size: '1024x1536', instruction: 'Compose for a vertical 4:5 feed post. Keep all text and key product details inside a generous central safe area.' },
  story: { label: 'Historia 1080 × 1920', width: 1080, height: 1920, size: '1024x1536', instruction: 'Compose for a tall 9:16 story. Keep all text and key product details inside the central safe area, away from the top and bottom interface zones.' }
};

const SOCIAL_STYLES = {
  editorial: 'Fashion-editorial advertising: refined magazine composition, sophisticated headline, product feature callouts only when clearly visible, premium spacing and tasteful type.',
  playful: 'Playful bold advertising: one witty short Spanish headline, oversized expressive typography, energetic but controlled composition, clever scale and a polished modern campaign feel.',
  product: 'Product-focused advertising: strong product hero, concise benefit-led Spanish headline based only on what is visibly true, clean graphic blocks and optional close-up callouts.'
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
    if (!['admin', 'supreme', 'content_studio_user'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Acceso exclusivo de Estudio Creativo' });
    }
    const establishment = resolveScope(db, req);
    if (!establishment) {
      return res.status(403).json({ message: 'Este negocio no tiene habilitado Estudio Creativo' });
    }
    if (req.user.role === 'content_studio_user') {
      const studioUser = db.prepare("SELECT * FROM content_studio_users WHERE id = ? AND establishment_id = ? AND status = 'active'")
        .get(req.user.contentStudioUserId, establishment.id);
      if (!studioUser) return res.status(403).json({ message: 'Usuario de Estudio Creativo no disponible' });
      req.contentStudioUser = studioUser;
    }
    req.contentStudioEstablishment = establishment;
    next();
  });
}

function planSettings(req, establishmentSettings) {
  if (!req.contentStudioUser) return establishmentSettings;
  return {
    establishment_id: req.contentStudioUser.establishment_id,
    plan_name: req.contentStudioUser.plan_name,
    monthly_limit: req.contentStudioUser.monthly_limit,
    brand_name: req.contentStudioUser.business_name,
    brand_tone: req.contentStudioUser.brand_tone
  };
}

function activeSubscription(user) {
  if (!user) return true;
  const paidUntil = String(user.paid_until || '').slice(0, 10);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  return ['paid', 'trial'].includes(user.subscription_status) && (!paidUntil || paidUntil >= today);
}

function buildPrompt(body, preset, hasBrandLogo = false) {
  const details = [
    body.brand_name && `Brand: ${clean(body.brand_name)}.`,
    body.brand_direction && `Brand art direction: ${clean(body.brand_direction, 220)}.`
  ].filter(Boolean).join(' ');
  const logoInstruction = hasBrandLogo
    ? `The final input image is the official brand logo. Reproduce that supplied logo faithfully, legibly and only once in the finished commercial image. Keep its original wording, symbol, proportions and colors; do not redraw, translate or invent brand marks.`
    : `Do not add a logo, brand name or invented brand mark.`;
  const socialFormat = SOCIAL_FORMATS[body.social_format] || SOCIAL_FORMATS.post;
  const socialInstruction = preset === PRESETS.social
    ? `${socialFormat.instruction} ${SOCIAL_STYLES[body.social_style] || SOCIAL_STYLES.editorial}`
    : `Do not include headlines, captions, labels or advertising copy. When an official logo is supplied, it is the only permitted visible lettering.`;
  return [
    `The first image is the source-of-truth product photo. Create one original professional commercial image.`,
    preset.direction,
    `Art direction: ${MOODS.light}.`,
    details,
    socialInstruction,
    logoInstruction,
    `The result must look photographed by a professional team, not synthetic. Avoid plastic textures, excessive glow, impossible reflections, warped geometry, duplicated parts, extra accessories, fake logos, gibberish and watermarks. Do not alter the product design. Return one finished image only.`
  ].filter(Boolean).join('\n\n');
}

async function defaultGenerate({ images, prompt, size }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada');
  const form = new FormData();
  form.append('model', process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('quality', process.env.OPENAI_IMAGE_QUALITY || 'medium');
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

async function resizeSocialOutput(imageData, format) {
  const encoded = String(imageData || '').split(',')[1];
  if (!encoded) throw new Error('La imagen generada no se pudo preparar');
  const source = Buffer.from(encoded, 'base64');
  const background = await sharp(source)
    .resize(format.width, format.height, { fit: 'cover', position: 'centre' })
    .blur(24)
    .modulate({ brightness: 0.82, saturation: 0.82 })
    .toBuffer();
  const foreground = await sharp(source)
    .resize(format.width, format.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const output = await sharp(background)
    .composite([{ input: foreground, gravity: 'centre' }])
    .webp({ quality: 92 })
    .toBuffer();
  return `data:image/webp;base64,${output.toString('base64')}`;
}

function generationRow(row) {
  const processing = row?.status === 'failed' && row?.error_message === '__processing__';
  return {
    ...row,
    status: processing ? 'processing' : row.status,
    error_message: processing ? null : row.error_message,
    reference_ids: safeJson(row.reference_ids_json),
    reference_ids_json: undefined
  };
}

export function registerContentStudioRoutes(app, db, options = {}) {
  const guard = studioAuth(db);
  const generateImage = options.generateImage || defaultGenerate;

  app.get('/api/content-studio/bootstrap', guard, (req, res) => {
    const establishmentId = req.contentStudioEstablishment.id;
    const establishmentSettings = db.prepare('SELECT * FROM content_studio_settings WHERE establishment_id = ?').get(establishmentId);
    const settings = planSettings(req, establishmentSettings);
    const userCondition = req.contentStudioUser ? 'AND content_studio_user_id = ?' : 'AND content_studio_user_id IS NULL';
    const userParams = req.contentStudioUser ? [req.contentStudioUser.id] : [];
    const usage = db.prepare(`SELECT COUNT(*) AS total FROM content_studio_generations WHERE establishment_id = ? ${userCondition} AND status = 'completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')`).get(establishmentId, ...userParams).total;
    const logos = db.prepare('SELECT id, name, image_data, created_at FROM content_studio_logos WHERE establishment_id = ? ORDER BY created_at ASC, id ASC').all(establishmentId);
    const generations = db.prepare(`SELECT * FROM content_studio_generations WHERE establishment_id = ? ${userCondition} AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 24`).all(establishmentId, ...userParams).map(generationRow);
    const subscriptionActive = activeSubscription(req.contentStudioUser);
    res.json({
      establishment: { id: establishmentId, name: req.contentStudioEstablishment.display_name || req.contentStudioEstablishment.name },
      settings, usage, generation_available: subscriptionActive && (Boolean(process.env.OPENAI_API_KEY) || Boolean(options.generateImage)),
      can_manage_references: false,
      can_manage_logos: true,
      subscription: req.contentStudioUser ? { status: req.contentStudioUser.subscription_status, active: subscriptionActive, paid_until: req.contentStudioUser.paid_until } : { status: 'internal', active: true, paid_until: null },
      logos,
      social_formats: Object.entries(SOCIAL_FORMATS).map(([id, item]) => ({ id, label: item.label, width: item.width, height: item.height })),
      social_styles: [
        { id: 'editorial', name: 'Editorial de moda', description: 'Elegante, con composición de revista y detalles visuales.' },
        { id: 'playful', name: 'Divertido y audaz', description: 'Texto grande, creativo y con personalidad.' },
        { id: 'product', name: 'Producto y beneficios', description: 'Producto protagonista con mensajes comerciales breves.' }
      ],
      presets: Object.entries(PRESETS).map(([id, item]) => ({ id, name: item.name, description: item.description, aspect_ratio: item.size })),
      references: [], generations
    });
  });

  app.post('/api/content-studio/users', guard, (req, res) => {
    if (req.contentStudioUser) return res.status(403).json({ message: 'Solo el administrador puede crear cuentas' });
    const name = clean(req.body.name, 100);
    const businessName = clean(req.body.business_name, 100) || name;
    const username = clean(req.body.username, 80).toLowerCase();
    const password = String(req.body.password || '');
    const monthlyLimit = Math.max(1, Math.min(10000, Number(req.body.monthly_limit) || 25));
    const durationDays = Math.max(1, Math.min(365, Number(req.body.duration_days) || 15));
    const planName = clean(req.body.plan_name, 60) || 'Emprendedor';
    if (!name || !username || password.length < 8) return res.status(400).json({ message: 'Nombre, usuario y contraseña de al menos 8 caracteres son obligatorios' });
    if (db.prepare('SELECT id FROM content_studio_users WHERE LOWER(username) = ?').get(username)) {
      return res.status(409).json({ message: 'Ese nombre de usuario ya existe' });
    }
    const result = db.prepare(
      `INSERT INTO content_studio_users
       (establishment_id, name, business_name, username, password_hash, plan_name, monthly_limit, subscription_status, paid_at, paid_until, brand_tone, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', date('now', 'localtime'), date('now', 'localtime', ?), 'premium', 'active')`
    ).run(req.contentStudioEstablishment.id, name, businessName, username, hashContentStudioPassword(password), planName, monthlyLimit, `+${durationDays} days`);
    res.status(201).json(db.prepare(
      `SELECT id, name, business_name, username, plan_name, monthly_limit, subscription_status, paid_at, paid_until, status, created_at
       FROM content_studio_users WHERE id = ?`
    ).get(result.lastInsertRowid));
  });

  app.post('/api/content-studio/logos', guard, (req, res) => {
    const image = String(req.body.image || '');
    const name = clean(req.body.name, 80);
    if (!name || !validDataImage(image)) return res.status(400).json({ message: 'Nombre e imagen válida son obligatorios' });
    if (dataImageBytes(image) > 5 * 1024 * 1024) return res.status(413).json({ message: 'El logo no puede superar 5 MB' });
    const result = db.prepare('INSERT INTO content_studio_logos (establishment_id, name, image_data, created_by) VALUES (?, ?, ?, ?)')
      .run(req.contentStudioEstablishment.id, name, image, req.user.username || req.user.role);
    res.status(201).json(db.prepare('SELECT id, name, image_data, created_at FROM content_studio_logos WHERE id = ?').get(result.lastInsertRowid));
  });

  app.delete('/api/content-studio/logos/:id', guard, (req, res) => {
    const result = db.prepare('DELETE FROM content_studio_logos WHERE id = ? AND establishment_id = ?').run(req.params.id, req.contentStudioEstablishment.id);
    if (!result.changes) return res.status(404).json({ message: 'Logo no encontrado' });
    res.json({ ok: true });
  });

  app.post('/api/content-studio/references', guard, (req, res) => {
    if (req.contentStudioUser) return res.status(403).json({ message: 'La biblioteca de referencias la administra Estudio Creativo' });
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
    if (req.contentStudioUser) return res.status(403).json({ message: 'La biblioteca de referencias la administra Estudio Creativo' });
    const result = db.prepare('DELETE FROM content_studio_references WHERE id = ? AND establishment_id = ?').run(req.params.id, req.contentStudioEstablishment.id);
    if (!result.changes) return res.status(404).json({ message: 'Referencia no encontrada' });
    res.json({ ok: true });
  });

  app.put('/api/content-studio/settings', guard, (req, res) => {
    if (req.contentStudioUser) {
      db.prepare("UPDATE content_studio_users SET business_name = ?, brand_tone = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
        .run(clean(req.body.brand_name, 100) || req.contentStudioUser.business_name, clean(req.body.brand_tone, 80) || 'premium', req.contentStudioUser.id);
      const user = db.prepare('SELECT * FROM content_studio_users WHERE id = ?').get(req.contentStudioUser.id);
      return res.json(planSettings({ contentStudioUser: user }, null));
    }
    const current = db.prepare('SELECT * FROM content_studio_settings WHERE establishment_id = ?').get(req.contentStudioEstablishment.id);
    const monthlyLimit = req.user.role === 'supreme' ? Math.max(1, Math.min(10000, Number(req.body.monthly_limit) || current.monthly_limit)) : current.monthly_limit;
    const planName = req.user.role === 'supreme' ? clean(req.body.plan_name, 60) || current.plan_name : current.plan_name;
    db.prepare(`UPDATE content_studio_settings SET brand_name = ?, brand_tone = ?, plan_name = ?, monthly_limit = ?, updated_at = datetime('now', 'localtime') WHERE establishment_id = ?`)
      .run(clean(req.body.brand_name, 100), clean(req.body.brand_tone, 80) || 'premium', planName, monthlyLimit, req.contentStudioEstablishment.id);
    res.json(db.prepare('SELECT * FROM content_studio_settings WHERE establishment_id = ?').get(req.contentStudioEstablishment.id));
  });

  app.post('/api/content-studio/generate', guard, (req, res) => {
    const productImage = String(req.body.product_image || '');
    const preset = PRESETS[req.body.preset];
    const logoId = Number(req.body.logo_id || 0);
    const logo = logoId ? db.prepare('SELECT id, name, image_data FROM content_studio_logos WHERE id = ? AND establishment_id = ?').get(logoId, req.contentStudioEstablishment.id) : null;
    const socialFormat = SOCIAL_FORMATS[req.body.social_format] || SOCIAL_FORMATS.post;
    const generationSize = req.body.preset === 'social' ? socialFormat.size : preset?.size;
    const outputRatio = req.body.preset === 'social' ? `${socialFormat.width}x${socialFormat.height}` : preset?.size;
    if (!validDataImage(productImage)) return res.status(400).json({ message: 'Sube una foto válida del producto' });
    if (dataImageBytes(productImage) > 8 * 1024 * 1024) return res.status(413).json({ message: 'La foto del producto no puede superar 8 MB' });
    if (!preset) return res.status(400).json({ message: 'Selecciona un tipo de contenido' });
    if (logoId && !logo) return res.status(400).json({ message: 'El logo seleccionado ya no está disponible' });
    const establishmentSettings = db.prepare('SELECT * FROM content_studio_settings WHERE establishment_id = ?').get(req.contentStudioEstablishment.id);
    const settings = planSettings(req, establishmentSettings);
    if (!activeSubscription(req.contentStudioUser)) return res.status(403).json({ message: 'Tu plan no está activo. Contacta al administrador para renovarlo.' });
    const prompt = buildPrompt({ ...req.body, brand_name: logo?.name || '', brand_direction: logo ? 'Use the visual character and colors of the supplied official logo with restraint.' : 'Create a neutral premium identity around the product.' }, preset, Boolean(logo));
    const studioUserId = req.contentStudioUser?.id || null;
    const userCondition = studioUserId ? 'AND content_studio_user_id = ?' : 'AND content_studio_user_id IS NULL';
    const userParams = studioUserId ? [studioUserId] : [];
    const reservation = db.transaction(() => {
      const occupied = db.prepare(`SELECT COUNT(*) AS total FROM content_studio_generations
        WHERE establishment_id = ? ${userCondition} AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
          AND (status = 'completed' OR (status = 'failed' AND error_message = '__processing__' AND created_at >= datetime('now', '-30 minutes')))`)
        .get(req.contentStudioEstablishment.id, ...userParams).total;
      if (occupied >= settings.monthly_limit) return null;
      const inserted = db.prepare(`INSERT INTO content_studio_generations
        (establishment_id, content_studio_user_id, preset, product_name, brand_name, material, color, headline, mood, aspect_ratio, reference_ids_json, status, error_message, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', '__processing__', ?)`)
        .run(req.contentStudioEstablishment.id, studioUserId, req.body.preset, '', logo?.name || '', '', '', '', req.body.preset === 'social' ? clean(req.body.social_style, 40) || 'editorial' : 'light', outputRatio, '[]', req.user.username || req.user.role);
      return inserted.lastInsertRowid;
    })();
    if (!reservation) return res.status(429).json({ message: 'Se alcanzó el límite mensual del plan' });
    const queued = generationRow(db.prepare('SELECT * FROM content_studio_generations WHERE id = ?').get(reservation));
    res.status(202).json({ generation: queued, usage: Number(db.prepare(`SELECT COUNT(*) AS total FROM content_studio_generations WHERE establishment_id = ? ${userCondition} AND status = 'completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')`).get(req.contentStudioEstablishment.id, ...userParams).total), monthly_limit: settings.monthly_limit });

    void Promise.resolve().then(async () => {
      try {
        const generated = await generateImage({ images: [productImage, ...(logo ? [logo.image_data] : [])], prompt, size: generationSize, preset: req.body.preset });
        const outputImage = req.body.preset === 'social' ? await resizeSocialOutput(generated.imageData, socialFormat) : generated.imageData;
        db.prepare("UPDATE content_studio_generations SET output_image_data = ?, revised_prompt = ?, status = 'completed', error_message = NULL WHERE id = ?")
          .run(outputImage, generated.revisedPrompt || '', reservation);
      } catch (error) {
        db.prepare("UPDATE content_studio_generations SET status = 'failed', error_message = ? WHERE id = ?")
          .run(clean(error.message, 500), reservation);
      }
    });
  });

  app.get('/api/content-studio/generations/:id', guard, (req, res) => {
    const userCondition = req.contentStudioUser ? 'AND content_studio_user_id = ?' : 'AND content_studio_user_id IS NULL';
    const userParams = req.contentStudioUser ? [req.contentStudioUser.id] : [];
    const row = db.prepare(`SELECT * FROM content_studio_generations WHERE id = ? AND establishment_id = ? ${userCondition} AND deleted_at IS NULL`)
      .get(req.params.id, req.contentStudioEstablishment.id, ...userParams);
    if (!row) return res.status(404).json({ message: 'Creación no encontrada' });
    const generation = generationRow(row);
    const usage = db.prepare(`SELECT COUNT(*) AS total FROM content_studio_generations WHERE establishment_id = ? ${userCondition} AND status = 'completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')`)
      .get(req.contentStudioEstablishment.id, ...userParams).total;
    res.json({ generation, usage });
  });

  app.delete('/api/content-studio/generations/:id', guard, (req, res) => {
    const userCondition = req.contentStudioUser ? 'AND content_studio_user_id = ?' : 'AND content_studio_user_id IS NULL';
    const userParams = req.contentStudioUser ? [req.contentStudioUser.id] : [];
    const result = db.prepare(`UPDATE content_studio_generations SET deleted_at = datetime('now', 'localtime'), output_image_data = NULL WHERE id = ? AND establishment_id = ? ${userCondition} AND deleted_at IS NULL`).run(req.params.id, req.contentStudioEstablishment.id, ...userParams);
    if (!result.changes) return res.status(404).json({ message: 'Creación no encontrada' });
    res.json({ ok: true });
  });
}

export { PRESETS, buildPrompt };
