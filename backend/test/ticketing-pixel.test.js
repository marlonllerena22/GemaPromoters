import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../frontend/public/protickets/tiktok-pixel.js', import.meta.url), 'utf8');

function pixelContext(pixelId) {
  const scripts = [];
  const handlers = {};
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const context = vm.createContext({
    window: {}, URL, URLSearchParams, Set, Date,
    location: { origin: 'https://www.joseandrea.com', href: 'https://www.joseandrea.com/?ttclid=E.C.P.ad',
      search: '?ttclid=E.C.P.ad' },
    localStorage: storage, sessionStorage: storage,
    document: { currentScript: { src: 'https://www.promotersec.com/protickets/tiktok-pixel.js' }, cookie: '_ttp=cookie-value',
      createElement: () => ({}), head: { appendChild: (script) => scripts.push(script) },
      addEventListener: (name, handler) => { handlers[name] = handler; } },
    fetch: async (url, options) => {
      assert.equal(url, 'https://www.promotersec.com/api/ticketing/public/tracking');
      assert.equal(options.credentials, 'omit');
      return { ok: true, json: async () => ({ tiktok_pixel_id: pixelId }) };
    }
  });
  vm.runInContext(source, context);
  return { context, scripts, handlers, tracking: context.window.ProTicketsTikTok };
}

test('the landing forwards TikTok attribution to ProTickets and queues each paid order once', async () => {
  const id = 'TESTPIXEL1234567890';
  const f = pixelContext(id);
  assert.equal(await f.tracking.ready, true);
  assert.equal(f.scripts.length, 1);
  assert.match(f.scripts[0].src, /analytics\.tiktok\.com.*sdkid=TESTPIXEL1234567890/);
  assert.equal(f.context.window.ttq[0][0], 'page');
  const link = { href: 'https://www.promotersec.com/tickets/evento/jose-andrea-macas-2026' };
  f.handlers.click({ target: { closest: () => link } });
  assert.equal(new URL(link.href).searchParams.get('ttclid'), 'E.C.P.ad');
  assert.equal(f.tracking.attribution().ttp, 'cookie-value');
  await Promise.all([
    f.tracking.track('Purchase', { currency: 'USD', value: 31.5 }, 'order-1', id),
    f.tracking.track('Purchase', { currency: 'USD', value: 31.5 }, 'order-1', id)
  ]);
  const events = f.context.window.ttq._i[id].filter(Array.isArray);
  assert.equal(events.length, 1);
  assert.equal(events[0][1], 'Purchase');
  assert.equal(events[0][2].value, 31.5);
  assert.equal(events[0][3].event_id, 'order-1');
  await f.tracking.track('Purchase', {}, 'order-2', 'OTHERPIXEL12345678');
  assert.equal(f.context.window.ttq._i[id].filter(Array.isArray).length, 1);
});

test('an unconfigured pixel does not send events to a made-up account', async () => {
  const f = pixelContext('');
  await f.tracking.track('Purchase', { value: 10 }, 'order-1');
  assert.equal(f.scripts.length, 0);
  assert.equal(f.context.window.ttq, undefined);
});
