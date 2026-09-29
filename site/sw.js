/* Corte Seco service worker: opens offline after the first visit. */
const V = 'corte-seco-8e67f48653';
const SHELL = ["./", "index.html", "manifest.webmanifest", "asr-core.js", "asr-worker.js", "face-worker.js", "lib/mediabunny.js", "lib/mediabunny-aac.js", "icons/icon-192.png", "fonts/ui-big-shoulders-display-700.woff2", "fonts/ui-big-shoulders-display-800.woff2", "fonts/ui-big-shoulders-display-900.woff2", "fonts/ui-instrument-sans-400.woff2", "fonts/ui-instrument-sans-500.woff2", "fonts/ui-instrument-sans-600.woff2", "fonts/ui-instrument-sans-700.woff2", "fonts/ui-jetbrains-mono-400.woff2", "fonts/ui-jetbrains-mono-500.woff2", "fonts/ui-jetbrains-mono-600.woff2"];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('corte-seco-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (r.mode === 'navigate') { // fresh page when online, cached one when not
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(V).then(k => k.put('index.html', c)); return res; }).catch(() => caches.match('index.html')));
    return;
  }
  if (r.headers.has('range')) return;
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).then(res => { if (res.ok && res.status === 200) { const c = res.clone(); caches.open(V).then(k => k.put(r, c)); } return res; })));
});
