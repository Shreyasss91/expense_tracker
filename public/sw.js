/**
 * Family Ledger service worker.
 *
 * Scope of ambition (deliberate): the app is auth-gated and server-rendered,
 * so full offline browsing is out. This worker buys two things:
 *
 *   1. PWA installability on Chromium builds that still expect a registered
 *      worker with a fetch handler.
 *   2. Offline Quick Add: once the shell is cached, a cold start with no
 *      network still renders the app (cached HTML + static chunks); the
 *      Quick Add sheet queues entries in IndexedDB and replays them when
 *      connectivity returns (see src/lib/offline-queue.ts).
 *
 * Server Actions are POSTs and never touch this worker; only same-origin
 * GETs are handled.
 */
const VERSION = "v1";
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept the auth endpoints or Next's build asset internals that
  // must always revalidate (HMR, RSC payloads).
  if (url.pathname.startsWith("/api")) return;

  // Navigations: network-first so logins/redirects stay fresh; fall back to
  // the last cached copy of the URL, then the offline page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          return cached || caches.match(OFFLINE_URL) || Response.error();
        }),
    );
    return;
  }

  // Immutable build output: cache-first forever.
  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
