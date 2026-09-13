import crypto from 'node:crypto';

const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);

function graphVersion() {
  return clean(process.env.META_GRAPH_API_VERSION || 'v26.0', 12).replace(/[^v0-9.]/gi, '') || 'v26.0';
}

function publicOrigin() {
  const configured = process.env.CONTENT_STUDIO_APP_URL || process.env.CONTENT_STUDIO_PUBLIC_URL || 'https://estudioscreativos.com';
  try { return new URL(configured).origin; } catch { return 'https://estudioscreativos.com'; }
}

function encryptionKey() {
  const value = process.env.LUMI_TOKEN_ENCRYPTION_KEY || process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || '';
  return value ? crypto.createHash('sha256').update(value).digest() : null;
}

function encrypt(value) {
  const key = encryptionKey();
  if (!key) throw new Error('Falta configurar el cifrado seguro de Lumi');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decrypt(value) {
  const key = encryptionKey();
  const [version, iv, tag, payload] = String(value || '').split('.');
  if (!key || version !== 'v1' || !iv || !tag || !payload) throw new Error('La conexión de WhatsApp necesita renovarse');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
}

function ownerFor(req) {
  const establishmentId = Number(req.contentStudioEstablishment?.id || 0);
  const userId = Number(req.contentStudioUser?.id || 0);
  return { establishmentId, userId: userId || null, key: userId ? `user:${userId}` : `establishment:${establishmentId}:admin` };
}

function entitlement(req) {
  if (req.contentStudioSeller) return false;
  if (!req.contentStudioUser) return true;
  const until = clean(req.contentStudioUser.paid_until, 10);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  return Number(req.contentStudioUser.lumi_enabled) === 1
    && ['paid', 'trial'].includes(req.contentStudioUser.subscription_status)
    && (!until || until >= today);
}

function ensureAccount(db, owner, enabled) {
  let row = db.prepare('SELECT * FROM content_studio_lumi_accounts WHERE owner_key = ?').get(owner.key);
  if (!row && enabled) {
    const result = db.prepare(`INSERT INTO content_studio_lumi_accounts
      (establishment_id, content_studio_user_id, owner_key, subscription_status, assistant_active)
      VALUES (?, ?, ?, 'active', 0)`).run(owner.establishmentId, owner.userId, owner.key);
    row = db.prepare('SELECT * FROM content_studio_lumi_accounts WHERE id = ?').get(result.lastInsertRowid);
  } else if (row && enabled && row.subscription_status === 'inactive') {
    db.prepare("UPDATE content_studio_lumi_accounts SET subscription_status = 'active', updated_at = datetime('now', 'localtime') WHERE id = ?").run(row.id);
    row = db.prepare('SELECT * FROM content_studio_lumi_accounts WHERE id = ?').get(row.id);
  }
  return row;
}

function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    active: Number(row.assistant_active) === 1,
    connected: Boolean(row.phone_number_id && row.token_ciphertext),
    phone_display: row.phone_display || '',
    business_name: row.business_name || '',
    subscription_status: row.subscription_status,
    settings: {
      products_services: row.products_services || '', prices: row.prices || '', business_hours: row.business_hours || '',
      addresses: row.addresses || '', shipping: row.shipping || '', payment_methods: row.payment_methods || '',
      faqs: row.faqs || '', tone: row.tone || 'Cercano, profesional y claro', welcome_message: row.welcome_message || ''
    }
  };
}

function recentConversations(db, accountId, limit = 40) {
  return db.prepare(`SELECT id, customer_name, customer_phone, status, unread_count, last_message_at, last_message_preview
    FROM content_studio_lumi_conversations WHERE account_id = ? ORDER BY last_message_at DESC, id DESC LIMIT ?`)
    .all(accountId, limit);
}

function summary(db, accountId) {
  const result = db.prepare(`SELECT
    SUM(CASE WHEN date(last_message_at) = date('now', 'localtime') THEN 1 ELSE 0 END) AS today,
    SUM(CASE WHEN status = 'needs_attention' THEN 1 ELSE 0 END) AS needs_attention,
    SUM(CASE WHEN status = 'human' THEN 1 ELSE 0 END) AS human
    FROM content_studio_lumi_conversations WHERE account_id = ?`).get(accountId);
  return { today: Number(result?.today || 0), needs_attention: Number(result?.needs_attention || 0), human: Number(result?.human || 0) };
}

async function graphJson(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${String(path).replace(/^\//, '')}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Meta no pudo completar la conexión');
  return data;
}

async function sendWhatsApp(account, to, body) {
  const token = decrypt(account.token_ciphertext);
  return graphJson(`${account.phone_number_id}/messages`, {
    method: 'POST', token,
    body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: clean(body, 3800) } }
  });
}

function responseText(data) {
  return (data?.output || []).flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text').map((item) => item.text || '').join('\n').trim();
}

function conversationHistory(db, conversationId, limit = 14) {
  return db.prepare(`SELECT sender, body, created_at FROM content_studio_lumi_messages
    WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`).all(conversationId, limit).reverse();
}

async function createLumiReply(db, account, conversation, incoming) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Lumi todavía no tiene conectado su motor de IA');
  const history = conversationHistory(db, conversation.id).map((item) => `${item.sender === 'customer' ? 'Cliente' : item.sender === 'human' ? 'Dueño' : 'Lumi'}: ${item.body}`).join('\n');
  const knowledge = [
    ['Productos y servicios', account.products_services], ['Precios', account.prices], ['Horarios', account.business_hours],
    ['Direcciones', account.addresses], ['Envíos', account.shipping], ['Formas de pago', account.payment_methods],
    ['Preguntas frecuentes', account.faqs], ['Tono', account.tone], ['Saludo preferido', account.welcome_message]
  ].filter(([, value]) => clean(value)).map(([label, value]) => `${label}: ${clean(value, 5000)}`).join('\n');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.LUMI_OPENAI_MODEL || process.env.OPENAI_COPY_MODEL || 'gpt-5.4-nano',
      input: `Eres Lumi, asistente de ventas por WhatsApp de ${clean(account.business_name, 120) || 'este negocio'}.
Responde en español, con el tono indicado, de manera breve, cálida y útil. Usa solamente la información confirmada abajo. Nunca inventes precios, stock, horarios, políticas ni condiciones. Haz máximo una pregunta a la vez. Si falta información, si el cliente pide hablar con una persona, reclama, reporta un pago o requiere una decisión del dueño, marca requires_attention=true y dile que una persona continuará. No menciones que eres un modelo ni detalles técnicos.

INFORMACIÓN DEL NEGOCIO
${knowledge || 'El negocio aún no completó información. Deriva las preguntas concretas a una persona.'}

CONVERSACIÓN RECIENTE
${history}
Cliente: ${clean(incoming, 2000)}

Devuelve únicamente JSON válido con esta forma: {"reply":"respuesta para WhatsApp","requires_attention":false}.`,
      max_output_tokens: 260, reasoning: { effort: 'none' }, store: false
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Lumi no pudo preparar la respuesta');
  const raw = responseText(data).replace(/^```json\s*|\s*```$/g, '');
  const parsed = JSON.parse(raw);
  return { reply: clean(parsed.reply, 3800), requiresAttention: Boolean(parsed.requires_attention) };
}

function upsertConversation(db, accountId, contactId, name, body) {
  db.prepare(`INSERT INTO content_studio_lumi_conversations
    (account_id, wa_contact_id, customer_name, customer_phone, status, unread_count, last_message_at, last_message_preview)
    VALUES (?, ?, ?, ?, 'lumi_attending', 1, datetime('now', 'localtime'), ?)
    ON CONFLICT(account_id, wa_contact_id) DO UPDATE SET
      customer_name = COALESCE(NULLIF(excluded.customer_name, ''), customer_name), customer_phone = excluded.customer_phone,
      unread_count = unread_count + 1, last_message_at = datetime('now', 'localtime'), last_message_preview = excluded.last_message_preview,
      status = CASE WHEN status IN ('human', 'needs_attention') THEN status ELSE 'lumi_attending' END, updated_at = datetime('now', 'localtime')`)
    .run(accountId, contactId, clean(name, 120), contactId, clean(body, 220));
  return db.prepare('SELECT * FROM content_studio_lumi_conversations WHERE account_id = ? AND wa_contact_id = ?').get(accountId, contactId);
}

async function processInbound(db, account, message, contact) {
  if (!message?.id || !message?.from) return;
  const existing = db.prepare('SELECT id FROM content_studio_lumi_messages WHERE external_message_id = ?').get(message.id);
  if (existing) return;
  const body = clean(message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || message.image?.caption || `[${message.type || 'mensaje'}]`, 3800);
  const conversation = upsertConversation(db, account.id, message.from, contact?.profile?.name, body);
  db.prepare(`INSERT INTO content_studio_lumi_messages
    (conversation_id, external_message_id, direction, sender, body, delivery_status, metadata_json)
    VALUES (?, ?, 'inbound', 'customer', ?, 'received', ?)`)
    .run(conversation.id, message.id, body, JSON.stringify({ type: message.type || 'unknown' }));
  if (account.content_studio_user_id) {
    const enabled = db.prepare(`SELECT 1 FROM content_studio_users WHERE id = ? AND status = 'active' AND lumi_enabled = 1
      AND subscription_status IN ('paid', 'trial') AND (paid_until IS NULL OR date(paid_until) >= date('now', 'localtime'))`).get(account.content_studio_user_id);
    if (!enabled) {
      db.prepare("UPDATE content_studio_lumi_accounts SET assistant_active = 0, subscription_status = 'inactive' WHERE id = ?").run(account.id);
      return;
    }
  }
  if (!Number(account.assistant_active) || account.subscription_status !== 'active' || ['human', 'needs_attention'].includes(conversation.status)) return;

  let generated;
  try {
    generated = await createLumiReply(db, account, conversation, body);
  } catch (error) {
    generated = { reply: 'Gracias por escribirnos. Necesito que una persona del negocio continúe contigo y ya dejé tu conversación marcada para atención.', requiresAttention: true };
  }
  if (!generated.reply) return;
  const sent = await sendWhatsApp(account, message.from, generated.reply);
  db.prepare(`INSERT INTO content_studio_lumi_messages
    (conversation_id, external_message_id, direction, sender, body, delivery_status)
    VALUES (?, ?, 'outbound', 'lumi', ?, 'sent')`)
    .run(conversation.id, sent.messages?.[0]?.id || null, generated.reply);
  db.prepare(`UPDATE content_studio_lumi_conversations SET status = ?, last_message_at = datetime('now', 'localtime'),
    last_message_preview = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
    .run(generated.requiresAttention ? 'needs_attention' : 'waiting', generated.reply.slice(0, 220), conversation.id);
}

async function processWebhook(db, payload) {
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = clean(value.metadata?.phone_number_id, 100);
      if (!phoneNumberId) continue;
      const account = db.prepare("SELECT * FROM content_studio_lumi_accounts WHERE phone_number_id = ? AND token_ciphertext IS NOT NULL").get(phoneNumberId);
      if (!account) continue;
      db.prepare("UPDATE content_studio_lumi_accounts SET last_webhook_at = datetime('now', 'localtime') WHERE id = ?").run(account.id);
      for (const status of value.statuses || []) {
        if (status.id) db.prepare('UPDATE content_studio_lumi_messages SET delivery_status = ? WHERE external_message_id = ?').run(clean(status.status, 30), status.id);
      }
      for (const message of value.messages || []) {
        await processInbound(db, account, message, (value.contacts || []).find((item) => item.wa_id === message.from));
      }
    }
  }
}

export function registerContentStudioLumiRoutes(app, db, guard) {
  app.get('/api/content-studio/lumi/webhook', (req, res) => {
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
    if (req.query['hub.mode'] === 'subscribe' && expected && req.query['hub.verify_token'] === expected) return res.status(200).send(req.query['hub.challenge']);
    return res.sendStatus(403);
  });

  app.post('/api/content-studio/lumi/webhook', (req, res) => {
    const secret = process.env.META_APP_SECRET || '';
    const signature = String(req.headers['x-hub-signature-256'] || '');
    const expected = secret && req.rawBody ? `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex')}` : '';
    if (!expected || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.sendStatus(403);
    res.sendStatus(200);
    void processWebhook(db, req.body).catch((error) => console.error('Lumi webhook:', error.message));
  });

  app.get('/api/content-studio/lumi', guard, (req, res) => {
    if (req.contentStudioSeller) return res.status(403).json({ message: 'Lumi Business está disponible para cuentas de negocio' });
    const entitled = entitlement(req);
    const owner = ownerFor(req);
    const account = ensureAccount(db, owner, entitled);
    const configured = Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && encryptionKey());
    res.json({
      entitled, price: 180, account: publicAccount(account),
      connection_ready: configured,
      connection_missing: configured ? [] : [
        !process.env.META_APP_ID && 'META_APP_ID', !process.env.META_APP_SECRET && 'META_APP_SECRET',
        !process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID && 'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID',
        !process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', !encryptionKey() && 'LUMI_TOKEN_ENCRYPTION_KEY'
      ].filter(Boolean),
      embed: configured ? { app_id: process.env.META_APP_ID, config_id: process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID, graph_version: graphVersion() } : null,
      webhook_url: `${publicOrigin()}/api/content-studio/lumi/webhook`,
      summary: account ? summary(db, account.id) : { today: 0, needs_attention: 0, human: 0 },
      conversations: account ? recentConversations(db, account.id) : []
    });
  });

  app.post('/api/content-studio/lumi/connect/complete', guard, async (req, res) => {
    if (!entitlement(req)) return res.status(403).json({ message: 'Necesitas Lumi Business para conectar WhatsApp' });
    const code = clean(req.body.code, 1000);
    const wabaId = clean(req.body.waba_id, 100);
    const requestedPhoneId = clean(req.body.phone_number_id, 100);
    if (!code || !wabaId) return res.status(400).json({ message: 'Meta no devolvió todos los datos de la cuenta' });
    try {
      const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
      tokenUrl.searchParams.set('client_id', process.env.META_APP_ID || '');
      tokenUrl.searchParams.set('client_secret', process.env.META_APP_SECRET || '');
      tokenUrl.searchParams.set('code', code);
      const tokenResponse = await fetch(tokenUrl);
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error?.message || 'Meta no entregó el acceso de WhatsApp');
      const token = tokenData.access_token;
      const [waba, phones] = await Promise.all([
        graphJson(`${wabaId}?fields=id,name`, { token }),
        graphJson(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`, { token })
      ]);
      const phone = (phones.data || []).find((item) => item.id === requestedPhoneId) || phones.data?.[0];
      if (!phone) throw new Error('La cuenta no tiene un número de WhatsApp disponible');
      await graphJson(`${wabaId}/subscribed_apps`, { method: 'POST', token, body: {} });
      const owner = ownerFor(req);
      const account = ensureAccount(db, owner, true);
      db.prepare(`UPDATE content_studio_lumi_accounts SET whatsapp_business_account_id = ?, phone_number_id = ?, phone_display = ?,
        business_name = ?, token_ciphertext = ?, token_expires_at = ?, assistant_active = 1,
        subscription_status = 'active', updated_at = datetime('now', 'localtime') WHERE id = ?`)
        .run(waba.id, phone.id, phone.display_phone_number || '', phone.verified_name || waba.name || '', encrypt(token), tokenData.expires_in ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString() : null, account.id);
      res.json({ ok: true, account: publicAccount(db.prepare('SELECT * FROM content_studio_lumi_accounts WHERE id = ?').get(account.id)) });
    } catch (error) { res.status(400).json({ message: error.message }); }
  });

  app.put('/api/content-studio/lumi/settings', guard, (req, res) => {
    if (!entitlement(req)) return res.status(403).json({ message: 'Necesitas Lumi Business para guardar esta configuración' });
    const account = ensureAccount(db, ownerFor(req), true);
    const fields = ['products_services', 'prices', 'business_hours', 'addresses', 'shipping', 'payment_methods', 'faqs', 'tone', 'welcome_message'];
    const values = fields.map((field) => clean(req.body[field], field === 'tone' ? 240 : 10000));
    const active = typeof req.body.active === 'boolean' ? Number(req.body.active) : Number(account.assistant_active);
    db.prepare(`UPDATE content_studio_lumi_accounts SET products_services = ?, prices = ?, business_hours = ?, addresses = ?, shipping = ?,
      payment_methods = ?, faqs = ?, tone = ?, welcome_message = ?, assistant_active = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(...values, active, account.id);
    res.json({ account: publicAccount(db.prepare('SELECT * FROM content_studio_lumi_accounts WHERE id = ?').get(account.id)) });
  });

  app.get('/api/content-studio/lumi/conversations/:id/messages', guard, (req, res) => {
    if (!entitlement(req)) return res.status(403).json({ message: 'Necesitas Lumi Business' });
    const account = ensureAccount(db, ownerFor(req), true);
    const conversation = db.prepare('SELECT * FROM content_studio_lumi_conversations WHERE id = ? AND account_id = ?').get(req.params.id, account.id);
    if (!conversation) return res.status(404).json({ message: 'Conversación no encontrada' });
    db.prepare('UPDATE content_studio_lumi_conversations SET unread_count = 0 WHERE id = ?').run(conversation.id);
    const messages = db.prepare('SELECT id, direction, sender, body, delivery_status, created_at FROM content_studio_lumi_messages WHERE conversation_id = ? ORDER BY id ASC').all(conversation.id);
    res.json({ conversation: { ...conversation, unread_count: 0 }, messages });
  });

  app.post('/api/content-studio/lumi/conversations/:id/take', guard, (req, res) => {
    if (!entitlement(req)) return res.status(403).json({ message: 'Necesitas Lumi Business' });
    const account = ensureAccount(db, ownerFor(req), true);
    const result = db.prepare(`UPDATE content_studio_lumi_conversations SET status = 'human', human_taken_at = datetime('now', 'localtime'),
      updated_at = datetime('now', 'localtime') WHERE id = ? AND account_id = ?`).run(req.params.id, account.id);
    if (!result.changes) return res.status(404).json({ message: 'Conversación no encontrada' });
    res.json({ ok: true });
  });

  app.post('/api/content-studio/lumi/conversations/:id/release', guard, (req, res) => {
    if (!entitlement(req)) return res.status(403).json({ message: 'Necesitas Lumi Business' });
    const account = ensureAccount(db, ownerFor(req), true);
    const result = db.prepare(`UPDATE content_studio_lumi_conversations SET status = 'waiting', human_taken_at = NULL,
      updated_at = datetime('now', 'localtime') WHERE id = ? AND account_id = ?`).run(req.params.id, account.id);
    if (!result.changes) return res.status(404).json({ message: 'Conversación no encontrada' });
    res.json({ ok: true });
  });

  app.post('/api/content-studio/lumi/conversations/:id/reply', guard, async (req, res) => {
    if (!entitlement(req)) return res.status(403).json({ message: 'Necesitas Lumi Business' });
    const body = clean(req.body.body, 3800);
    if (!body) return res.status(400).json({ message: 'Escribe una respuesta' });
    const account = ensureAccount(db, ownerFor(req), true);
    const conversation = db.prepare('SELECT * FROM content_studio_lumi_conversations WHERE id = ? AND account_id = ?').get(req.params.id, account.id);
    if (!conversation) return res.status(404).json({ message: 'Conversación no encontrada' });
    try {
      const sent = await sendWhatsApp(account, conversation.wa_contact_id, body);
      db.prepare(`INSERT INTO content_studio_lumi_messages
        (conversation_id, external_message_id, direction, sender, body, delivery_status) VALUES (?, ?, 'outbound', 'human', ?, 'sent')`)
        .run(conversation.id, sent.messages?.[0]?.id || null, body);
      db.prepare(`UPDATE content_studio_lumi_conversations SET status = 'human', last_message_at = datetime('now', 'localtime'),
        last_message_preview = ?, human_taken_at = COALESCE(human_taken_at, datetime('now', 'localtime')) WHERE id = ?`).run(body.slice(0, 220), conversation.id);
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ message: error.message }); }
  });
}
