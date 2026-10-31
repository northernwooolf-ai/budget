// Сохраняет файлы приложения на устройстве, чтобы оно быстро открывалось.
// Страница и файлы без версии: сначала сеть (сразу видны обновления), без сети или на медленной сети — из кэша.
// Свои файлы с версией в адресе (?v=…) не меняются: берём из кэша и не ждём сеть. Новые версии приходят вместе с новой страницей.
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
  else if (url.origin === location.origin && url.searchParams.has('v')) e.respondWith(versioned(req));
  else if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === 'cdn.jsdelivr.net') e.respondWith(cacheFirst(req));
  // Запросы к Supabase не трогаем.
});

// Если сеть еле живая и молчит дольше этого, отдаём сохранённую копию (сеть при этом догружает свежую).
// После такого случая какое-то время сеть не ждём совсем: файлы грузятся цепочкой, и задержки на каждом складывались бы.
const SLOW_NETWORK_MS = 2000;
const SKIP_NETWORK_MS = 30000;
let skipWaitUntil = 0;

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  // no-cache: всегда сверяться с сервером, чтобы после обновления не смешались старые и новые файлы.
  const network = fetch(req, { cache: 'no-cache' }).then(async (res) => {
    if (res.ok) {
      skipWaitUntil = 0;
      // Старые версии того же файла убираем.
      await cache.delete(req, { ignoreSearch: true });
      await cache.put(req, res.clone());
    }
    return res;
  });
  // Страница подходит любая сохранённая. Файл другой версии берём, только если нужной нет:
  // лучше предыдущая версия, чем пустой экран.
  const saved = () => cache.match(req, { ignoreSearch: true });
  try {
    return await Promise.race([
      network,
      new Promise((resolve, reject) => setTimeout(async () => {
        const hit = await saved();
        if (hit) {
          skipWaitUntil = Date.now() + SKIP_NETWORK_MS;
          resolve(hit);
        } else network.then(resolve, reject);
      }, skipWaitUntil > Date.now() ? 0 : SLOW_NETWORK_MS)),
    ]);
  } catch (err) {
    const hit = await saved();
    if (hit) return hit;
    throw err;
  }
}

async function versioned(req) {
  const cache = await caches.open(CACHE);
  return (await cache.match(req)) ?? networkFirst(req);
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
