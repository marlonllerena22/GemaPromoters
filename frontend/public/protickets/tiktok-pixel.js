(function () {
  if (window.ProTicketsTikTok) return;
  var script = document.currentScript;
  var apiOrigin = new URL(script.src).origin;
  var sent = new Set();
  function readClickId() {
    var current = new URLSearchParams(location.search).get('ttclid') || '';
    if (current && /^[A-Za-z0-9._~-]{1,2000}$/.test(current)) {
      try { sessionStorage.setItem('protickets_ttclid', current); } catch (_) {}
      return current;
    }
    try { return sessionStorage.getItem('protickets_ttclid') || ''; } catch (_) { return ''; }
  }
  var clickId = readClickId();
  var pixelId = '';
  var tracking = window.ProTicketsTikTok = {
    attribution: function () {
      var cookie = document.cookie.split(';').find(function (item) { return item.trim().startsWith('_ttp='); });
      return { ttclid: readClickId(), ttp: cookie ? cookie.trim().slice(5) : '' };
    },
    track: async function (event, properties, eventId, expectedPixel) {
      if (!await tracking.ready || (expectedPixel && expectedPixel !== pixelId)) return;
      var key = 'protickets_tiktok_' + pixelId + '_' + eventId;
      if (eventId) {
        if (sent.has(key)) return;
        try { if (localStorage.getItem(key)) return; } catch (_) {}
      }
      window.ttq.instance(pixelId).track(event, properties || {}, eventId ? { event_id: eventId } : {});
      if (eventId) {
        sent.add(key);
        try { localStorage.setItem(key, '1'); } catch (_) {}
      }
    }
  };
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href]');
    if (!link || !clickId) return;
    var url = new URL(link.href, location.href);
    if (url.origin === apiOrigin && url.pathname.startsWith('/tickets')) {
      url.searchParams.set('ttclid', clickId);
      link.href = url.href;
    }
  }, true);
  tracking.ready = fetch(apiOrigin + '/api/ticketing/public/tracking', { credentials: 'omit' })
    .then(function (response) { if (!response.ok) throw new Error(); return response.json(); })
    .then(function (settings) {
      pixelId = settings.tiktok_pixel_id;
      if (!/^[A-Za-z0-9]{10,40}$/.test(pixelId || '')) return false;
      window.TiktokAnalyticsObject = 'ttq';
      var ttq = window.ttq = window.ttq || [];
      ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready',
        'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
      ttq.setAndDefer = function (target, method) {
        target[method] = function () { target.push([method].concat(Array.prototype.slice.call(arguments))); };
      };
      ttq.methods.forEach(function (method) { if (!ttq[method]) ttq.setAndDefer(ttq, method); });
      ttq.instance = ttq.instance || function (id) {
        var instance = ttq._i[id] || [];
        ttq.methods.forEach(function (method) { if (!instance[method]) ttq.setAndDefer(instance, method); });
        return instance;
      };
      ttq.load = ttq.load || function (id) {
        ttq._i = ttq._i || {};
        ttq._i[id] = [];
        ttq._i[id]._u = 'https://analytics.tiktok.com/i18n/pixel/events.js';
        ttq._t = ttq._t || {};
        ttq._t[id] = +new Date();
        ttq._o = ttq._o || {};
        ttq._o[id] = {};
        var sdk = document.createElement('script');
        sdk.async = true;
        sdk.src = ttq._i[id]._u + '?sdkid=' + encodeURIComponent(id) + '&lib=ttq';
        document.head.appendChild(sdk);
      };
      ttq.load(pixelId);
      ttq.page();
      return true;
    }).catch(function () { return false; });
})();
