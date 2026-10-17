// Saýla: saýtyň faýllaryny telefonda saklaýar, şonuň üçin internetsiz hem açylýar.
// Maglumatlar (müşderiler, harytlar) bu ýerde DÄL — olar IndexedDB-de (sayla-web.js).
// Tertip: öňki saklanany derrew görkez, internet bar bolsa fonda täzele (indiki açylyşda täze wersiýa).
const CACHE = "sayla-v1";
const CORE = [
  "./",
  "index.html",
  "sayla-web.js",
  "zxing.min.js",
  "sayla.js",
  "manifest.webmanifest",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(CORE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(request, { ignoreSearch: true }).then(function (cached) {
        const network = fetch(request).then(function (response) {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        }).catch(function () { return cached; });
        return cached || network;
      });
    })
  );
});
