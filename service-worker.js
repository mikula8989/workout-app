const CACHE = "workout-app-v3-progression";
const SHELL = ["./","./index.html","./style.css","./app.js","./manifest.json","./icon-192.png","./icon-512.png","./program-overrides.json","./gym-overrides.json"];
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));
});
self.addEventListener("activate", e => e.waitUntil(
  Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
    self.clients.claim()
  ])
));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if(url.pathname.endsWith("/program.json") || url.pathname.endsWith("/program-overrides.json") || url.pathname.endsWith("/gym-overrides.json")){
    e.respondWith(fetch(e.request).then(r=>{
      const copy=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return r;
    }).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached=>cached || fetch(e.request)));
});
