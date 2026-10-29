// Сохраняет файлы приложения на устройстве, чтобы оно быстро открывалось.
// Свои файлы: сначала сеть (сразу видны обновления), без сети — из кэша.
// Библиотеки с CDN: адреса содержат версию и не меняются — берём из кэша.
// Библиотеки из vendor/ берутся из кэша: при их замене поменяйте номер версии здесь.
const CACHE = 'budget-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Запросы «без кэша» (страница проверки связи) всегда идут в сеть напрямую.
  if (req.method !== 'GET' || req.cache === 'no-store') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.includes('/vendor/')) e.respondWith(cacheFirst(req));
  else if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === 'cdn.jsdelivr.net') e.respondWith(cacheFirst(req));
  // Запросы к Supabase не трогаем.
});

// Если сеть еле живая и молчит дольше этого, отдаём сохранённую копию (сеть при этом догружает свежую).
const SLOW_NETWORK_MS = 4000;

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  // no-cache: всегда сверяться с сервером, чтобы после обновления не смешались старые и новые файлы.
  const network = fetch(req, { cache: 'no-cache' }).then(async (res) => {
    if (res.ok) {
      // У файлов есть версия в адресе (?v=…): старые версии того же файла убираем.
      await cache.delete(req, { ignoreSearch: true });
      await cache.put(req, res.clone());
    }
    return res;
  });
  // Страница приложения подходит любая сохранённая, а файлы — только той же версии.
  const saved = () => cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  try {
    return await Promise.race([
      network,
      new Promise((resolve, reject) => setTimeout(async () => {
        const hit = await saved();
        if (hit) resolve(hit); else network.then(resolve, reject);
      }, SLOW_NETWORK_MS)),
    ]);
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
