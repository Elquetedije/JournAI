const CACHE_NAME = 'journai-v15';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-192.png'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    
    // Skip service worker for external APIs (Google Drive, Auth, etc)
    if (url.origin !== self.location.origin) {
        return;
    }

    // Network first, then cache for local assets
    e.respondWith(
        fetch(e.request).then((response) => {
            if (e.request.method === 'GET' && response.status === 200) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(e.request, responseClone);
                });
            }
            return response;
        }).catch(() => {
            return caches.match(e.request);
        })
    );
});
