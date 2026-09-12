/*
 * HOMATCH SERVICE WORKER
 *
 * Written by hand rather than generated, because the thing that matters here
 * is what is NOT cached, and that is easier to be sure of in thirty lines
 * than in a Workbox config.
 *
 * WHAT THIS CACHES
 *   The app shell and immutable build assets. Vite fingerprints every file
 *   under /assets/, so a hashed URL can be cached forever and a new build
 *   simply requests different URLs.
 *
 * WHAT THIS MUST NEVER CACHE, AND WHY
 *   Anything with a customer in it. A verification report, a contract
 *   analysis, a wallet balance, an auth token, a document the customer
 *   uploaded — none of it goes in the Cache API. A cache is shared per
 *   ORIGIN, not per session, so a cached authenticated response is a
 *   response that can outlive a sign-out and be served to whoever uses the
 *   device next. This is why the fetch handler below bails out on anything
 *   that is not a same-origin GET for a static asset, and why Supabase and
 *   every /functions/, /rest/, /auth/ and /storage/ path is refused
 *   explicitly rather than by omission.
 *
 * NAVIGATION
 *   Network first. Homatch is not an offline product — a verification needs
 *   the backend — so a stale shell served ahead of a reachable network would
 *   only hide real failures. The cached shell is the fallback for a genuine
 *   offline navigation, so an installed app opens to something rather than
 *   to the browser's dinosaur.
 */

const VERSION = 'homatch-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

/* Enough to paint something when genuinely offline. Deliberately small: the
   real assets are fingerprinted and cached on first use instead. */
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.png', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // Anything from a previous VERSION goes, so a bad cache cannot
        // outlive one deploy.
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

/** Paths that carry customer data and must always go to the network. */
function isPrivate(url) {
  return /\/(functions|rest|auth|storage|realtime)\//.test(url.pathname)
    || url.hostname.endsWith('.supabase.co');
}

/** Fingerprinted build output: safe to keep, because the name changes. */
function isImmutableAsset(url) {
  return url.origin === self.location.origin
    && (/^\/assets\//.test(url.pathname) || /^\/images\//.test(url.pathname));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // A cache can only ever answer a GET. Everything else — and every request
  // that carries credentials — goes straight to the network, untouched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isPrivate(url)) return;
  if (url.origin !== self.location.origin) return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        // Only a good, basic response is worth keeping.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(ASSETS).then((c) => c.put(request, copy));
        }
        return res;
      })),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((hit) => hit || Response.error())),
    );
  }
});

/* Lets the page tell a waiting worker to take over, so an update does not
   wait for every tab to close. The page asks; the worker never forces it
   mid-session, which would swap the bundle under a running form. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
