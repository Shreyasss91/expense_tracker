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

/**
 * §2.11 — Web Push. The push subscription lives on the clients; this worker
 * only renders the notification when the push service delivers one. The
 * payload is a small JSON object ({ title, body, url }) encrypted by the
 * server with draft-ietf-webpush-encryption; the browser decrypts it before
 * this handler runs, so `event.data.json()` is plain text.
 */
self.addEventListener("push", (event) => {
  let payload = { title: "Family Ledger", body: "You have an update.", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // fall back to the default above
  }

  const icon = "/icon";
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon,
      badge: icon,
      tag: payload.url, // collapse repeats for the same destination
      data: { url: payload.url || "/" },
      // Budget/review nudges are routine, not emergencies.
      requireInteraction: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const target = (event.notification?.data?.url as string) || "/";
  event.notification.close();

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer an already-open tab: focus it and navigate, rather than opening
      // a second instance (the PWA is display:standalone).
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          // navigate() exists on WindowClient; guards for older impls.
          if ("navigate" in client) await (client as WindowClient).navigate(target);
          return;
        }
      }
      const opened = await self.clients.openWindow(target);
      return opened;
    })(),
  );
});
