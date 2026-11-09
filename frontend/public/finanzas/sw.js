/* Deliberately never cache financial API responses, documents, or authenticated views. */
const CACHE = "gema-finance-offline-v1";
const SHELL = [
  "/finanzas/offline.html",
  "/finanzas/icon-192.png",
  "/finanzas/icon-512.png",
];
self.addEventListener("install", (event) => {
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
    self.registration.showNotification("Tienes una transferencia pendiente", {
      body: "Abre Gema Finanzas para revisar la solicitud.",
      icon: "/finanzas/icon-192.png",
      badge: "/finanzas/icon-192.png",
      tag: "gema-payment-requests",
      data: { url: "/finanzas/pagos" },
      requireInteraction: true,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const client = windows.find(
          (c) => new URL(c.url).origin === self.location.origin,
        );
        if (client) {
          await client.navigate("/finanzas/pagos");
          return client.focus();
        }
        return self.clients.openWindow("/finanzas/pagos");
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
