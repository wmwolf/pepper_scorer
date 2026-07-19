/*
 * Pepper Scorer service worker — app-shell + offline install support.
 *
 * SCOPE / BASE PATH: this file is served from `<base>sw.js` (prod: `/pepper_scorer/sw.js`,
 * dev: `/sw.js`) and self-derives BASE from its own location, so it works under both the
 * GitHub Pages sub-path deploy and local dev without any build-time templating.
 *
 * CACHE STRATEGY (chosen to NOT worsen the known GH-Pages index.html CDN staleness):
 *   - navigations (HTML) .......... network-first  (fresh when online; cached shell only offline)
 *   - hashed build assets `_astro/*` cache-first    (content-hashed => immutable & safe)
 *   - other same-origin GET ....... stale-while-revalidate
 *   - cross-origin (Firebase / Google Identity / googleapis) .... passthrough, never cached
 *
 * VERSIONING: bump CACHE_VERSION on any change that should invalidate old caches. `activate`
 * deletes every `pepper-*` cache except the current one.
 *
 * ===================================================================================
 * KILL SWITCH (how to revoke a bad service worker for already-installed users):
 * Replace the ENTIRE body of this file with the following and deploy — on the next visit
 * every client unregisters, drops its caches, and reloads onto the plain network:
 *
 *     self.addEventListener('install', () => self.skipWaiting());
 *     self.addEventListener('activate', (event) => {
 *       event.waitUntil((async () => {
 *         await self.registration.unregister();
 *         for (const key of await caches.keys()) await caches.delete(key);
 *         for (const client of await self.clients.matchAll()) client.navigate(client.url);
 *       })());
 *     });
 *
 * Because registration uses `updateViaCache: 'none'` (see register-sw.ts), the browser fetches
 * this script bypassing the HTTP cache on every update check, so the kill switch propagates fast.
 * ===================================================================================
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `pepper-${CACHE_VERSION}`;

// BASE ends with a slash: '/pepper_scorer/' in prod, '/' in dev.
const BASE = self.location.pathname.replace(/sw\.js$/, '');

// App-shell resources to precache so a fresh install works fully offline.
const PRECACHE_URLS = [
  BASE, // the app root (index) — navigation fallback
  `${BASE}offline.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}icons/icon-192.png`,
  `${BASE}icons/icon-512.png`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Precache individually so one missing/404 URL can't abort the whole install.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('pepper-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
      // Warm the cache (while online) with the app's pages and their hashed CSS/JS. On the very
      // first visit the SW isn't controlling yet, so the page's own subresource requests bypass
      // it and never get cached — without this, the first offline load would render unstyled.
      await warmCache();
    })(),
  );
});

// Fetch the navigable pages and precache the content-hashed `_astro/*` assets they reference,
// so a full styled experience is available offline right after the first (online) visit.
async function warmCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const pages = [BASE, `${BASE}game/`, `${BASE}account/`];
    const assetUrls = new Set();
    for (const page of pages) {
      try {
        const res = await fetch(page, { cache: 'reload' });
        if (!res.ok) continue;
        await cache.put(page, res.clone());
        const html = await res.text();
        const re = /(?:href|src)="([^"]*_astro\/[^"?#]+\.(?:css|js))"/g;
        let match;
        while ((match = re.exec(html))) {
          assetUrls.add(new URL(match[1], self.location.origin).pathname);
        }
      } catch {
        /* offline or page missing — skip */
      }
    }
    await Promise.all(
      [...assetUrls].map((u) =>
        cache.add(new Request(u, { cache: 'reload' })).catch(() => undefined),
      ),
    );
  } catch {
    /* cache warming is best-effort */
  }
}

// Allow the page to trigger an immediate activation of a waiting worker.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Only handle our own origin. Firebase RTDB, Google Identity Services, and googleapis
  // must never be intercepted or cached — let the browser talk to them directly.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so online users always get fresh HTML (the GH-Pages HTML
  // cache problem is not made worse); fall back to cache only when the network fails.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // Content-hashed build output is immutable — cache-first is safe and fast.
  if (url.pathname.startsWith(`${BASE}_astro/`)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Everything else same-origin (icons, manifest, images): stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirstNavigation(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    // Cache a copy of the fetched page for offline use.
    cache.put(req, fresh.clone()).catch(() => undefined);
    return fresh;
  } catch {
    // Offline: try the exact page, then the app shell, then the offline page.
    return (
      (await cache.match(req)) ||
      (await cache.match(BASE)) ||
      (await cache.match(`${BASE}offline.html`)) ||
      new Response('You are offline.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh.ok) cache.put(req, fresh.clone()).catch(() => undefined);
  return fresh;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone()).catch(() => undefined);
      return res;
    })
    .catch(() => undefined);
  return cached || (await network) || new Response('', { status: 504 });
}
