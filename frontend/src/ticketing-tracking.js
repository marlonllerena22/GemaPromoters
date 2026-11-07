import { API_URL } from './api.js';

let loading;

export function loadTicketingTracking() {
  if (window.ProTicketsTikTok) return Promise.resolve(window.ProTicketsTikTok);
  if (!loading) {
    loading = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = new URL('/protickets/tiktok-pixel.js', new URL(API_URL, window.location.origin)).href;
      script.async = true;
      script.onload = () => resolve(window.ProTicketsTikTok || null);
      script.onerror = () => { loading = null; resolve(null); };
      document.head.appendChild(script);
    });
  }
  return loading;
}

export function ticketingAttribution() {
  if (window.ProTicketsTikTok) return window.ProTicketsTikTok.attribution();
  const ttclid = new URLSearchParams(window.location.search).get('ttclid') || '';
  return { ttclid };
}

export function trackTicketingEvent(event, properties, eventId, pixelId) {
  void loadTicketingTracking().then((tracking) => tracking?.track(event, properties, eventId, pixelId)).catch(() => {});
}

export function trackPaidOrder(order) {
  const purchase = order.tiktok_purchase;
  if (order.payment_status === 'paid' && purchase) {
    trackTicketingEvent('Purchase', purchase.properties, purchase.event_id, purchase.pixel_id);
  }
}
