/*
 * MULTIBOT 面板 Service Worker
 * 版本号由服务端在返回本文件时注入（见 index.js），因此每次发版缓存名自动变化，
 * 不会出现"旧缓存永久锁死"。
 *
 * 策略：
 *   - 页面导航：network-first，失败回落到缓存的应用壳，再回落到离线页
 *   - 同源静态资源：cache-first，命中后后台不会重复请求
 *   - 跨域请求（后端 API / SSE）、/avatar、/healthz：一律不拦截
 */

const VERSION = '__PANEL_VERSION__';
const CACHE_NAME = `multibot-panel-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/app.css',
  '/app.js',
  '/storage.js',
  '/formatters.js',
  '/skin.js',
  '/api.js',
  '/state.js',
  '/sse.js',
  '/instance-presets.js',
  '/ripple.js',
  '/components/status-bar.js',
  '/components/toast.js',
  '/components/install-hint.js',
  '/components/backends.js',
  '/components/bot-list.js',
  '/components/instances.js',
  '/components/command-panel.js',
  '/components/logs-panel.js',
  '/components/bot-detail.js',
  '/components/inventory-panel.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 逐个预缓存：个别资源缺失不影响整体安装
      return Promise.all(
        SHELL_ASSETS.map((url) => cache.add(url).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function shouldHandle(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === '/healthz') return false;
  if (url.pathname.startsWith('/avatar/')) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname === '/sw.js') return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (!shouldHandle(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put('/index.html', copy))
              .catch(() => null);
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          // 先按同 URL 命中（例如直接访问 /offline.html），再回落应用壳，最后离线页
          return (await cache.match(request))
            || (await cache.match('/index.html'))
            || (await cache.match('/offline.html'))
            || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, copy))
            .catch(() => null);
        }
        return response;
      });
    })
  );
});
