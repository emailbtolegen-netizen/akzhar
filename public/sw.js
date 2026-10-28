// Service worker: lets the site open without internet (poor mobile coverage in the village).
// - Pages: network first, the last saved copy when offline. The phones pages are saved in
//   advance, so the important numbers are always available.
// - Styles, scripts, icons, fonts, photos: served from the cache, refreshed in the background.
// - Videos, the admin panel and form submissions are never cached.
const VERSION = 'akz-v1';
const PRECACHE = ['/kk/phones', '/ru/phones', '/img/logo.svg', '/img/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) => /^\/(css|js|img)\//.test(url.pathname) || /\/media\/.+\.jpg$/.test(url.pathname) ||
  url.pathname.startsWith('/uploads/') || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/admin') || /\.(mp4|webm)$/.test(url.pathname) || req.headers.has('range')) return;

  if (req.mode === 'navigate') {
    if (url.origin !== location.origin) return;
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: false })
        .then((hit) => hit || caches.match(url.pathname.startsWith('/ru') ? '/ru/phones' : '/kk/phones'))),
    );
    return;
  }

  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const fresh = fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => hit);
        return hit || fresh;
      }),
    );
  }
});
