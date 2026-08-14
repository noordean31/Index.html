// App-shell service worker. Only ever caches this app's own static files —
// it deliberately never intercepts requests to Google's APIs (accounts,
// oauth2, drive, googleapis) or OpenFoodFacts, so sync and food search
// always hit the live network and never see a stale cached response.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `calorie-tracker-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/drive-sync.js',
  './js/config.js',
  './js/foods.js',
  './js/charts.js',
  './js/ui.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isThirdParty(url) {
  return url.origin !== self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isThirdParty(url)) return; // let Google/OpenFoodFacts requests pass straight through

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));
      return cached || network;
    })
  );
});
