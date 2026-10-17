// Saýla: saýtyň faýllaryny telefonda saklaýar, şonuň üçin internetsiz hem açylýar.
// Maglumatlar (müşderiler, harytlar) bu ýerde DÄL — olar IndexedDB-de (sayla-web.js).
//
// Her wersiýanyň ähli faýllary bir gezekde (wersiýa ady bilen) saklanýar: täze wersiýa
// doly ýüklenmese köne wersiýa işlemegini dowam edýär — internetsiz pursatda hem.
// VERSION we FILES ýerleşdirilende (deploy-web.py) doldurylýar; kompýuterde synagda "dev".
const VERSION = "6b9622bbf083";
const FILES = ["./", "693a01c314cc99caddc1.wasm", "8bc1b48ee28fd6b51bb9.wasm", "composeResources/com.logistika.app.resources/font/roboto_bold.ttf", "composeResources/com.logistika.app.resources/font/roboto_medium.ttf", "composeResources/com.logistika.app.resources/font/roboto_regular.ttf", "icon-180.png", "icon-192.png", "icon-512.png", "index.html", "manifest.webmanifest", "sayla-web.js", "sayla.js", "sayla.js.LICENSE.txt", "zxing.min.js"];
const CACHE = "sayla-" + VERSION;

// Kompýuterdäki synag ("dev"): hiç zat saklanmaýar, hemişe täze faýllar
const DEV = VERSION === "dev";

self.addEventListener("install", function (event) {
  if (DEV) { self.skipWaiting(); return; }
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(FILES); }).then(function () { return self.skipWaiting(); })
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
  if (DEV || request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(request, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (response) {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        });
      });
    })
  );
});
