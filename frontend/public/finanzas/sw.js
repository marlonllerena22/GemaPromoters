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
