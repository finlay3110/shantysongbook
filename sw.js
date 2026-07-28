/* ============================================================
   UCN SONGBOOK — SERVICE WORKER

   Why this exists: the app advertises working offline at events, but
   the only offline provision used to be a copy of songs.json in
   localStorage. That copy is unreachable if the browser cannot load
   index.html in the first place, so a genuinely offline visit got
   nothing. This precaches the app shell so the app boots with no
   connection at all, and the localStorage fallback becomes a real
   second line of defence rather than the only one.

   BUMP `VERSION` WHENEVER YOU EDIT index.html, app.js, lyrics.js OR
   styles.css. Old caches are deleted on activate, and clients are
   claimed immediately, so a bumped version ships on the next visit.

   Strategies:
     songs.json     network-first  — song edits show up as soon as
                                     there is a connection, with the
                                     cached copy as fallback
     app shell      cache-first    — precached on install
     pdf-export.js  cache-on-use   — 900KB, so it is never precached;
                                     once someone exports a PDF it is
                                     kept and works offline after that
   ============================================================ */

/* v2 shipped a layout that was reverted. Going forward rather than back to
   v1 guarantees anyone who cached v2 gets replaced rather than relying on
   two different strings happening to compare unequal. */
var VERSION = 'ucn-songbook-v5';
var SHELL = [
  './',
  'index.html',
  'styles.css',
  'lyrics.js',
  'app.js',
  'songs.json',
  'manifest.webmanifest',
  'fonts/exo2-latin.woff2',
  'fonts/exo2-latin-ext.woff2',
  'fonts/opendyslexic-latin-400-normal.woff2',
  'fonts/opendyslexic-latin-700-normal.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      /* Added individually so one missing optional asset cannot fail
         the whole install and leave the app with no offline support. */
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch cross-origin

  /* Song data: prefer the network so edits land quickly, fall back to
     whatever was cached last. */
  if (url.pathname.endsWith('/songs.json')) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || Response.error();
        });
      })
    );
    return;
  }

  /* Navigations: serve the cached shell when offline so deep links
     like #/song/45 still open. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () {
        return caches.match('index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        /* Cache same-origin successes as they are used — this is how the
           big PDF module ends up available offline after first use. */
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
