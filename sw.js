/* SAMAHITA service worker — plain JS, no build step. */
const CACHE = 'samahita-v2';
const ASSETS = 'samahita-assets-v2'; // hashed /_astro/ files: never trimmed, old versions go on activate
const MEDIA = 'samahita-media-v2';
const MEDIA_MAX = 300;
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const SHELL = [
  '/', '/panchang/', '/khoj/', '/vrat/',
  '/today-index.json', '/nirnaya-index.json', '/search-index.json', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
].map((p) => BASE + p);

const ok = (res) => res && res.status === 200 && res.type !== 'opaque' && res.type !== 'opaqueredirect' && !res.redirected;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // one missing file must not abort the install
      Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MEDIA && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MEDIA_MAX; i++) await cache.delete(keys[i]); // keys() is insertion order
}

async function cacheFirst(req, name, trimmed) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (ok(res)) {
    await cache.put(req, res.clone());
    if (trimmed) trim(cache);
  }
  return res;
}

async function networkFirst(req) {
  const u = new URL(req.url);
  const key = u.origin + u.pathname; // ?query variants share one entry
  const cache = await caches.open(CACHE);
  try {
    const res = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 4000);
      fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
    });
    if (ok(res)) cache.put(key, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(key)) || (await cache.match(BASE + '/')) || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (ok(res)) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE + '/')) return;
  const p = url.pathname;
  if (p.startsWith(BASE + '/pagefind/')) return; // straight to network
  if (p.startsWith(BASE + '/_astro/')) {
    e.respondWith(cacheFirst(req, ASSETS, false));
  } else if (p.startsWith(BASE + '/scans/') || /\.(woff2?|ttf|otf)$/.test(p)) {
    e.respondWith(cacheFirst(req, MEDIA, true));
  } else if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith(networkFirst(req));
  } else if (p.endsWith('.json')) {
    e.respondWith(staleWhileRevalidate(req));
  }
});
