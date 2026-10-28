// オフラインでも開けるようにするための仕組み（Webサーバーから開いたときだけ動く）
// ネットにつながるときは常に最新のファイルを読み、つながらないときは保存しておいたファイルを使う。
const CACHE = "boki3-v1";
const FILES = ["./", "index.html", "style.css", "app.js", "chapters.js", "questions.js", "manifest.json", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(req.url, { cache: "no-cache" }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    const cached = await cache.match(req, { ignoreSearch: true });
    if (!cached) return net;
    // 電波が弱いときに待ちすぎないよう、4秒たったら保存済みのファイルを使う
    const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), 4000));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});
