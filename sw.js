// Bump this when you want to force a clean refresh for everyone
const VERSION = "v2";
const CACHE_NAME = `lo-arcade-${VERSION}`;
const CORE_CACHE = `lo-arcade-core-${VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",

  // Game entry pages (optional — you can keep or remove)
  "./row-match/index.html",
  "./memory-game/index.html",
  "./slider-puzzle/index.html"
"./noughts-and-crosses/index.html"

];

// Install: precache core (optional)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => {
        // delete any older lo-arcade caches
        if (k.startsWith("lo-arcade-") && k !== CACHE_NAME && k !== CORE_CACHE) {
          return caches.delete(k);
        }
      })
    );
    await self.clients.claim();
  })());
});

// Helpers
async function cachePut(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
}

// Fetch:
// - HTML navigations: NETWORK-FIRST (so updates appear without clearing cache)
// - Other GET assets: STALE-WHILE-REVALIDATE (fast + updates quietly)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin
  if (url.origin !== self.location.origin) return;

  // Only handle GET
  if (req.method !== "GET") return;

  const isNavigation =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isNavigation) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // Cache the latest HTML
        await cachePut(CACHE_NAME, req, fresh.clone());
        return fresh;
      } catch (err) {
        // Offline fallback to cache
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  // For assets: Stale-While-Revalidate
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req)
      .then((res) => {
        if (res && res.ok) cachePut(CACHE_NAME, req, res.clone());
        return res;
      })
      .catch(() => null);

    // Return cached immediately if available, otherwise wait for network
    return cached || (await fetchPromise) || cached;
  })());
});
