/* Deliberately never cache financial API responses, documents, or authenticated views. */
const CACHE = "gema-finance-offline-v1";
const SHELL = [
  "/finanzas/offline.html",
  "/finanzas/icon-192.png",
  "/finanzas/icon-512.png",
];
function notificationUrl(value) {
  return [
    "/finanzas/pagos",
    "/finanzas/cheques",
    "/finanzas/tarjetas",
    "/finanzas/prestamos",
  ].includes(value)
    ? value
    : "/finanzas/pagos";
}
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter(
                (key) =>
                  key.startsWith("gema-finance-offline-") && key !== CACHE,
              )
              .map((key) => caches.delete(key)),
          ),
        ),
    ]),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith("/finanzas/") ||
    event.request.method !== "GET"
  )
    return;
  if (event.request.mode === "navigate")
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/finanzas/offline.html")),
    );
});
self.addEventListener("push", (event) => {
  let value = {};
  try {
    value = event.data?.json() || {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(
      typeof value.title === "string"
        ? value.title.slice(0, 120)
        : "Tienes una transferencia pendiente",
      {
        body:
          typeof value.body === "string"
            ? value.body.slice(0, 250)
            : "Abre Gema Finanzas para revisar la solicitud.",
        icon: "/finanzas/icon-192.png",
        badge: "/finanzas/icon-192.png",
        tag: /^gema-[a-z0-9_-]{1,64}$/.test(value.tag || "")
          ? value.tag
          : "gema-payment-requests",
        data: { url: notificationUrl(value.url) },
        requireInteraction: notificationUrl(value.url) === "/finanzas/pagos",
      },
    ).then(async () => {
      if (typeof value.test_id === "string" && /^[a-f0-9-]{36}$/.test(value.test_id)) {
        try { await fetch("/api/finance/push/receipt", { method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","x-finance-request":"1"},body:JSON.stringify({id:value.test_id}) }); } catch {}
      }
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = notificationUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const client = windows.find(
          (c) => new URL(c.url).origin === self.location.origin,
        );
        if (client) {
          await client.navigate(target);
          return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "GEMA_PAYABLES_UPDATED" && event.data.count === 0)
    event.waitUntil(
      self.registration
        .getNotifications({ tag: "gema-payment-requests" })
        .then((notes) => notes.forEach((n) => n.close())),
    );
});
