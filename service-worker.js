const CACHE_NAME = "drbck-public-v2";
const IMAGE_CACHE = "drbck-public-images-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./logo.jpg",
  "./manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("drbck-public-") &&
      key !== CACHE_NAME && key !== IMAGE_CACHE).map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return;

  // Cache les photos distantes (notamment Supabase) pour les visites suivantes.
  if (request.destination === "image" && url.protocol.startsWith("http")) {
    const refresh = fetch(request).then(response => {
      if (response && (response.ok || response.type === "opaque")) {
        return caches.open(IMAGE_CACHE).then(cache =>
          cache.put(request, response.clone()).then(() => response)
        );
      }
      return response;
    });
    event.waitUntil(refresh.then(() => undefined).catch(() => {}));
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      return refresh;
    })());
    return;
  }

  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  event.respondWith(
    fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match("./index.html")))
  );
});
