import crypto from 'node:crypto';
import sharp from 'sharp';

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function metaVersion() {
  return clean(process.env.META_GRAPH_API_VERSION || 'v26.0', 12).replace(/[^v0-9.]/gi, '') || 'v26.0';
}

function studioOrigin() {
  const configured = process.env.CONTENT_STUDIO_APP_URL
    || process.env.CONTENT_STUDIO_PUBLIC_URL
    || 'https://estudioscreativos.com';
  try { return new URL(configured).origin; }
  catch { return 'https://estudioscreativos.com'; }
}

function callbackUrl() {
  return `${studioOrigin()}/api/content-studio/social/meta/callback`;
}

function tokenKey() {
  const secret = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || '';
  return secret ? crypto.createHash('sha256').update(secret).digest() : null;
}

function mediaSigningKey() {
  const secret = process.env.SOCIAL_MEDIA_SIGNING_KEY || process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || '';
  return secret ? crypto.createHash('sha256').update(secret).digest() : null;
}

function metaConfigured() {
  return Boolean(
    process.env.META_APP_ID
    && process.env.META_APP_SECRET
    && process.env.META_LOGIN_CONFIG_ID
    && tokenKey()
    && mediaSigningKey()
  );
}

function encryptToken(value) {
  const key = tokenKey();
  if (!key) throw new Error('Falta configurar el cifrado de las conexiones sociales');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptToken(value) {
  const key = tokenKey();
  const [version, ivValue, tagValue, encryptedValue] = String(value || '').split('.');
  if (!key || version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('La conexión social necesita renovarse');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}

function ownerFor(req) {
  const establishmentId = Number(req.contentStudioEstablishment?.id || 0);
  const userId = Number(req.contentStudioUser?.id || 0);
  return {
    establishmentId,
    userId: userId || null,
    key: userId ? `user:${userId}` : `establishment:${establishmentId}:admin`
  };
}

function hasSocialPlan(req) {
  if (!req.contentStudioUser) return true;
  const active = ['paid', 'trial'].includes(req.contentStudioUser.subscription_status);
  const until = clean(req.contentStudioUser.paid_until, 10);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  return active && (!until || until >= today) && Number(req.contentStudioUser.credit_limit || req.contentStudioUser.monthly_limit || 0) >= 60;
}

function publicConnection(row) {
  return {
    id: row.id,
    page_id: row.page_id,
    page_name: row.page_name,
    instagram_account_id: row.instagram_account_id || '',
    instagram_username: row.instagram_username || '',
    has_facebook: true,
    has_instagram: Boolean(row.instagram_account_id),
    status: row.status,
    connected_at: row.created_at
  };
}

async function metaJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || 'Meta no pudo completar la solicitud');
    error.code = data.error?.code;
    throw error;
  }
  return data;
}

async function graphGet(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${metaVersion()}/${String(path).replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => value !== undefined && url.searchParams.set(key, value));
  return metaJson(url);
}

async function graphPost(path, body) {
  return metaJson(`https://graph.facebook.com/${metaVersion()}/${String(path).replace(/^\//, '')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  });
}

function responseText(data) {
  return (data?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text')
    .map((item) => item.text || '')
    .join('\n')
    .trim();
}

async function createCopy(generation, brandName) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('La generación de copy todavía no está disponible');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_COPY_MODEL || process.env.OPENAI_RESEARCH_MODEL || 'gpt-5.4-nano',
      input: `Escribe un copy breve en español para publicar esta creación comercial en Instagram y Facebook.
Marca: ${clean(brandName, 100) || 'sin nombre indicado'}.
Producto: ${clean(generation.product_name, 100) || 'producto visible en la imagen'}.
Tipo de creación: ${clean(generation.preset, 40)}.
Objetivo indicado: ${clean(generation.headline, 260) || 'presentar el producto de forma atractiva'}.

Entrega únicamente el copy final, sin títulos ni explicaciones. Debe sonar natural, cercano y profesional; incluir una llamada a la acción suave, máximo 2 emojis y entre 3 y 5 hashtags relevantes. No inventes precios, descuentos, ubicación, materiales, beneficios ni características que no fueron proporcionados. Máximo 650 caracteres.`,
      max_output_tokens: 240,
      reasoning: { effort: 'none' },
      store: false
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'No se pudo crear el copy');
  const copy = clean(responseText(data), 650);
  if (!copy) throw new Error('No se pudo crear el copy');
  return copy;
}

function mediaSignature(generationId, expires) {
  const key = mediaSigningKey();
  if (!key) throw new Error('Falta configurar la firma de medios');
  return crypto.createHmac('sha256', key).update(`${generationId}.${expires}`).digest('base64url');
}

function signedMediaUrl(generationId) {
  const expires = Math.floor(Date.now() / 1000) + 20 * 60;
  const signature = mediaSignature(generationId, expires);
  return `${studioOrigin()}/api/content-studio/social/media/${generationId}?expires=${expires}&signature=${encodeURIComponent(signature)}`;
}

function ownedGeneration(db, req, generationId) {
  const owner = ownerFor(req);
  const userCondition = owner.userId ? 'AND content_studio_user_id = ?' : 'AND content_studio_user_id IS NULL';
  const params = owner.userId ? [owner.userId] : [];
  return db.prepare(`SELECT * FROM content_studio_generations
    WHERE id = ? AND establishment_id = ? ${userCondition}
      AND status = 'completed' AND deleted_at IS NULL AND output_image_data IS NOT NULL`)
    .get(generationId, owner.establishmentId, ...params);
}

function savePublication(db, req, connection, generation, network, copyText, result) {
  const owner = ownerFor(req);
  db.prepare(`INSERT INTO content_studio_social_publications
    (establishment_id, content_studio_user_id, connection_id, generation_id, network, copy_text,
     status, external_post_id, permalink, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(owner.establishmentId, owner.userId, connection.id, generation.id, network, copyText,
      result.ok ? 'published' : 'failed', result.id || null, result.permalink || null, result.error || null);
}

async function publishInstagram(connection, accessToken, imageUrl, caption) {
  const container = await graphPost(`${connection.instagram_account_id}/media`, {
    image_url: imageUrl,
    caption,
    access_token: accessToken
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const status = await graphGet(container.id, { fields: 'status_code', access_token: accessToken });
    if (status.status_code === 'FINISHED') {
      const published = await graphPost(`${connection.instagram_account_id}/media_publish`, {
        creation_id: container.id,
        access_token: accessToken
      });
      let permalink = '';
      try { permalink = (await graphGet(published.id, { fields: 'permalink', access_token: accessToken })).permalink || ''; }
      catch { /* The publication itself already succeeded. */ }
      return { id: published.id, permalink };
    }
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') throw new Error('Instagram no pudo preparar la imagen');
    await wait(1200);
  }
  throw new Error('Instagram tardó demasiado en preparar la imagen. Inténtalo nuevamente.');
}

async function publishFacebook(connection, accessToken, imageUrl, caption) {
  const published = await graphPost(`${connection.page_id}/photos`, {
    url: imageUrl,
    caption,
    published: 'true',
    access_token: accessToken
  });
  return { id: published.post_id || published.id || '', permalink: '' };
}

function callbackPage({ ok, message }) {
  const origin = studioOrigin();
  const payload = JSON.stringify({ type: 'estudios-meta-connected', ok, message }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Estudios Creativos</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f3ee;color:#20231e;font:16px system-ui;text-align:center}.card{margin:20px;padding:32px;border:1px solid #dedbd2;border-radius:20px;background:white;max-width:430px}h1{margin:0 0 12px}p{color:#6f716a;line-height:1.55}</style></head><body><main class="card"><h1>${ok ? 'Conexión terminada' : 'No se pudo conectar'}</h1><p>${String(message).replace(/[&<>"']/g, '')}</p><p>Esta ventana se cerrará automáticamente.</p></main><script>window.opener&&window.opener.postMessage(${payload},${JSON.stringify(origin)});setTimeout(()=>window.close(),900);</script></body></html>`;
}

function signedRequestPayload(value) {
  const [signaturePart, payloadPart] = String(value || '').split('.');
  if (!signaturePart || !payloadPart || !process.env.META_APP_SECRET) throw new Error('Solicitud de Meta no válida');
  const expected = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(payloadPart).digest();
  const received = Buffer.from(signaturePart, 'base64url');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) throw new Error('Firma de Meta no válida');
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  if (String(payload.algorithm || '').toUpperCase() !== 'HMAC-SHA256' || !payload.user_id) throw new Error('Solicitud de Meta incompleta');
  return payload;
}

function revokeMetaUser(db, metaUserId) {
  return db.prepare(`UPDATE content_studio_social_connections
    SET status = 'revoked', token_ciphertext = '', updated_at = datetime('now', 'localtime')
    WHERE provider = 'meta' AND meta_user_id = ? AND status != 'revoked'`).run(clean(metaUserId, 100)).changes;
}

export function registerContentStudioSocialRoutes(app, db, guard) {
  app.post('/api/content-studio/social/meta/deauthorize', (req, res) => {
    try {
      const payload = signedRequestPayload(req.body?.signed_request);
      revokeMetaUser(db, payload.user_id);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ message: error.message || 'No se pudo cancelar la autorización' });
    }
  });

  app.post('/api/content-studio/social/meta/data-deletion', (req, res) => {
    try {
      const payload = signedRequestPayload(req.body?.signed_request);
      const confirmationCode = crypto.randomBytes(12).toString('hex');
      const revoked = revokeMetaUser(db, payload.user_id);
      db.prepare(`INSERT INTO content_studio_social_deletions
        (confirmation_code, meta_user_id, connections_revoked) VALUES (?, ?, ?)`)
        .run(confirmationCode, clean(payload.user_id, 100), revoked);
      res.json({
        url: `${studioOrigin()}/eliminar-datos?codigo=${encodeURIComponent(confirmationCode)}`,
        confirmation_code: confirmationCode
      });
    } catch (error) {
      res.status(400).json({ message: error.message || 'No se pudo procesar la eliminación' });
    }
  });

  app.get('/api/content-studio/social/meta/data-deletion/:code', (req, res) => {
    const row = db.prepare(`SELECT confirmation_code, connections_revoked, status, created_at
      FROM content_studio_social_deletions WHERE confirmation_code = ?`).get(clean(req.params.code, 80));
    if (!row) return res.status(404).json({ message: 'No encontramos esta solicitud' });
    res.json(row);
  });

  app.get('/api/content-studio/social', guard, (req, res) => {
    const owner = ownerFor(req);
    const connections = db.prepare(`SELECT * FROM content_studio_social_connections
      WHERE owner_key = ? AND status = 'active' ORDER BY updated_at DESC, id DESC`).all(owner.key).map(publicConnection);
    const publications = db.prepare(`SELECT publications.id, publications.generation_id, publications.network,
      publications.status, publications.external_post_id, publications.permalink, publications.error_message,
      publications.created_at, connections.page_name, connections.instagram_username
      FROM content_studio_social_publications publications
      JOIN content_studio_social_connections connections ON connections.id = publications.connection_id
      WHERE publications.establishment_id = ? ${owner.userId ? 'AND publications.content_studio_user_id = ?' : 'AND publications.content_studio_user_id IS NULL'}
      ORDER BY publications.id DESC LIMIT 20`).all(owner.establishmentId, ...(owner.userId ? [owner.userId] : []));
    res.json({
      configured: metaConfigured(),
      entitled: hasSocialPlan(req),
      minimum_plan: 'Negocio',
      connections,
      publications,
      callback_url: callbackUrl()
    });
  });

  app.post('/api/content-studio/social/connect', guard, (req, res) => {
    if (!metaConfigured()) return res.status(503).json({ message: 'La conexión con Meta todavía necesita las credenciales del servidor' });
    if (!hasSocialPlan(req)) return res.status(403).json({ code: 'SOCIAL_PLAN_REQUIRED', message: 'La publicación directa está disponible desde el plan Negocio.' });
    const owner = ownerFor(req);
    const state = crypto.randomBytes(32).toString('base64url');
    db.prepare("DELETE FROM content_studio_meta_oauth_states WHERE expires_at < datetime('now', 'localtime') OR used_at IS NOT NULL").run();
    db.prepare(`INSERT INTO content_studio_meta_oauth_states
      (state_hash, establishment_id, content_studio_user_id, owner_key, expires_at)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime', '+10 minutes'))`)
      .run(hash(state), owner.establishmentId, owner.userId, owner.key);
    const authorization = new URL(`https://www.facebook.com/${metaVersion()}/dialog/oauth`);
    authorization.searchParams.set('client_id', process.env.META_APP_ID);
    authorization.searchParams.set('redirect_uri', callbackUrl());
    authorization.searchParams.set('state', state);
    authorization.searchParams.set('response_type', 'code');
    authorization.searchParams.set('config_id', clean(process.env.META_LOGIN_CONFIG_ID, 100));
    authorization.searchParams.set('scope', 'pages_show_list,pages_read_engagement,pages_manage_posts,business_management,instagram_basic,instagram_content_publish');
    res.json({ authorization_url: authorization.toString() });
  });

  app.get('/api/content-studio/social/meta/callback', async (req, res) => {
    const state = clean(req.query.state, 240);
    const code = clean(req.query.code, 2000);
    if (!state || !code || req.query.error) {
      return res.status(400).type('html').send(callbackPage({ ok: false, message: clean(req.query.error_description, 300) || 'Meta canceló la autorización.' }));
    }
    try {
      const oauth = db.transaction(() => {
        const row = db.prepare(`SELECT * FROM content_studio_meta_oauth_states
          WHERE state_hash = ? AND used_at IS NULL AND expires_at >= datetime('now', 'localtime')`).get(hash(state));
        if (!row) throw new Error('La solicitud de conexión venció. Inténtalo nuevamente.');
        const consumed = db.prepare("UPDATE content_studio_meta_oauth_states SET used_at = datetime('now', 'localtime') WHERE id = ? AND used_at IS NULL").run(row.id);
        if (!consumed.changes) throw new Error('Esta solicitud ya fue utilizada.');
        return row;
      })();
      const shortToken = await graphGet('oauth/access_token', {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: callbackUrl(),
        code
      });
      let userToken = shortToken.access_token;
      let expiresIn = Number(shortToken.expires_in || 0);
      try {
        const longToken = await graphGet('oauth/access_token', {
          grant_type: 'fb_exchange_token',
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          fb_exchange_token: userToken
        });
        userToken = longToken.access_token || userToken;
        expiresIn = Number(longToken.expires_in || expiresIn);
      } catch { /* A valid short token can still finish the connection. */ }
      const metaUser = await graphGet('me', { fields: 'id', access_token: userToken });
      const pages = await graphGet('me/accounts', {
        fields: 'id,name,access_token,tasks,instagram_business_account{id,username}',
        limit: '100',
        access_token: userToken
      });
      if (!pages.data?.length) throw new Error('No encontramos una Página de Facebook administrada por esta cuenta.');
      const expiry = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
      const upsert = db.prepare(`INSERT INTO content_studio_social_connections
        (establishment_id, content_studio_user_id, owner_key, provider, meta_user_id, page_id, page_name,
         instagram_account_id, instagram_username, token_ciphertext, token_expires_at, status)
        VALUES (?, ?, ?, 'meta', ?, ?, ?, ?, ?, ?, ?, 'active')
        ON CONFLICT(owner_key, provider, page_id) DO UPDATE SET
          meta_user_id = excluded.meta_user_id, page_name = excluded.page_name, instagram_account_id = excluded.instagram_account_id,
          instagram_username = excluded.instagram_username, token_ciphertext = excluded.token_ciphertext,
          token_expires_at = excluded.token_expires_at, status = 'active', updated_at = datetime('now', 'localtime')`);
      db.transaction(() => pages.data.forEach((page) => {
        upsert.run(oauth.establishment_id, oauth.content_studio_user_id, oauth.owner_key,
          clean(metaUser.id, 100), clean(page.id, 100), clean(page.name, 160), clean(page.instagram_business_account?.id, 100) || null,
          clean(page.instagram_business_account?.username, 160) || null, encryptToken(page.access_token), expiry);
      }))();
      return res.type('html').send(callbackPage({ ok: true, message: `${pages.data.length} página${pages.data.length === 1 ? '' : 's'} disponible${pages.data.length === 1 ? '' : 's'} en Estudios Creativos.` }));
    } catch (error) {
      return res.status(400).type('html').send(callbackPage({ ok: false, message: error.message || 'No se pudo completar la conexión.' }));
    }
  });

  app.delete('/api/content-studio/social/connections/:id', guard, (req, res) => {
    const owner = ownerFor(req);
    const removed = db.prepare(`UPDATE content_studio_social_connections
      SET status = 'revoked', token_ciphertext = '', updated_at = datetime('now', 'localtime')
      WHERE id = ? AND owner_key = ? AND status = 'active'`).run(req.params.id, owner.key);
    if (!removed.changes) return res.status(404).json({ message: 'Conexión no encontrada' });
    res.json({ ok: true });
  });

  app.post('/api/content-studio/social/copy', guard, async (req, res) => {
    if (!hasSocialPlan(req)) return res.status(403).json({ code: 'SOCIAL_PLAN_REQUIRED', message: 'El copy automático está disponible desde el plan Negocio.' });
    const generation = ownedGeneration(db, req, Number(req.body?.generation_id || 0));
    if (!generation) return res.status(404).json({ message: 'Creación no encontrada' });
    if (clean(generation.social_copy, 650)) return res.json({ copy: clean(generation.social_copy, 650), cached: true });
    try {
      const brandName = req.contentStudioUser?.business_name
        || db.prepare('SELECT brand_name FROM content_studio_settings WHERE establishment_id = ?').get(req.contentStudioEstablishment.id)?.brand_name;
      const copy = await createCopy(generation, brandName);
      db.prepare('UPDATE content_studio_generations SET social_copy = ? WHERE id = ?').run(copy, generation.id);
      res.json({ copy });
    } catch (error) {
      res.status(502).json({ message: error.message || 'No se pudo crear el copy' });
    }
  });

  app.post('/api/content-studio/social/publish', guard, async (req, res) => {
    if (!metaConfigured()) return res.status(503).json({ message: 'La publicación con Meta todavía no está configurada' });
    if (!hasSocialPlan(req)) return res.status(403).json({ code: 'SOCIAL_PLAN_REQUIRED', message: 'La publicación directa está disponible desde el plan Negocio.' });
    const owner = ownerFor(req);
    const generation = ownedGeneration(db, req, Number(req.body?.generation_id || 0));
    if (!generation) return res.status(404).json({ message: 'Creación no encontrada' });
    const connection = db.prepare(`SELECT * FROM content_studio_social_connections
      WHERE id = ? AND owner_key = ? AND status = 'active'`).get(req.body?.connection_id, owner.key);
    if (!connection) return res.status(404).json({ message: 'Selecciona una conexión social válida' });
    const targets = [...new Set((Array.isArray(req.body?.targets) ? req.body.targets : []).filter((item) => ['facebook', 'instagram'].includes(item)))];
    if (!targets.length) return res.status(400).json({ message: 'Selecciona Facebook, Instagram o ambos' });
    if (targets.includes('instagram') && !connection.instagram_account_id) return res.status(400).json({ message: 'Esta Página no tiene un Instagram profesional conectado' });
    const copyText = clean(req.body?.copy, 2200);
    if (!copyText) return res.status(400).json({ message: 'Escribe o genera el copy antes de publicar' });
    let accessToken;
    try { accessToken = decryptToken(connection.token_ciphertext); }
    catch (error) { return res.status(409).json({ message: error.message }); }
    const imageUrl = signedMediaUrl(generation.id);
    const results = [];
    for (const network of targets) {
      try {
        const published = network === 'instagram'
          ? await publishInstagram(connection, accessToken, imageUrl, copyText)
          : await publishFacebook(connection, accessToken, imageUrl, copyText);
        const result = { network, ok: true, ...published };
        savePublication(db, req, connection, generation, network, copyText, result);
        results.push(result);
      } catch (error) {
        const result = { network, ok: false, error: clean(error.message, 500) };
        savePublication(db, req, connection, generation, network, copyText, result);
        results.push(result);
      }
    }
    res.json({ results, published: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length });
  });

  app.get('/api/content-studio/social/media/:id', async (req, res) => {
    const generationId = Number(req.params.id || 0);
    const expires = Number(req.query.expires || 0);
    const signature = clean(req.query.signature, 200);
    const now = Math.floor(Date.now() / 1000);
    if (!generationId || expires < now || expires > now + 25 * 60 || !signature) return res.status(403).end();
    let expected;
    try { expected = mediaSignature(generationId, expires); }
    catch { return res.status(503).end(); }
    const received = Buffer.from(signature);
    const comparison = Buffer.from(expected);
    if (received.length !== comparison.length || !crypto.timingSafeEqual(received, comparison)) return res.status(403).end();
    const generation = db.prepare(`SELECT output_image_data FROM content_studio_generations
      WHERE id = ? AND status = 'completed' AND deleted_at IS NULL AND output_image_data IS NOT NULL`).get(generationId);
    if (!generation) return res.status(404).end();
    try {
      const encoded = String(generation.output_image_data).split(',')[1];
      const jpeg = await sharp(Buffer.from(encoded, 'base64')).flatten({ background: '#ffffff' }).jpeg({ quality: 94, mozjpeg: true }).toBuffer();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=900');
      res.send(jpeg);
    } catch {
      res.status(500).end();
    }
  });
}
