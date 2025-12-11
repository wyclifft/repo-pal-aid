// ============= NATIVE-LIKE PWA SERVICE WORKER v15 =============
const CACHE_VERSION = 'v15';
const CACHE_NAMES = {
  STATIC: `milk-collection-static-${CACHE_VERSION}`,
  DYNAMIC: `milk-collection-dynamic-${CACHE_VERSION}`,
  API: `milk-collection-api-${CACHE_VERSION}`,
  IMAGES: `milk-collection-images-${CACHE_VERSION}`,
  FONTS: `milk-collection-fonts-${CACHE_VERSION}`,
  RUNTIME: `milk-collection-runtime-${CACHE_VERSION}`,
};

// Aggressive precaching - all critical assets
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Cache expiration times
const CACHE_EXPIRATION = {
  API: 10 * 60 * 1000,           // 10 minutes for API
  IMAGES: 30 * 24 * 60 * 60 * 1000, // 30 days for images
  FONTS: 365 * 24 * 60 * 60 * 1000, // 1 year for fonts
  DYNAMIC: 7 * 24 * 60 * 60 * 1000, // 7 days for dynamic
  STATIC: 30 * 24 * 60 * 60 * 1000, // 30 days for static assets
};

// Notify clients of updates
const notifyClientsOfUpdate = async () => {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'SW_UPDATE_AVAILABLE', version: CACHE_VERSION });
  });
};

// Install - aggressive precaching
self.addEventListener('install', (event) => {
  console.log('📦 Installing Service Worker:', CACHE_VERSION);
  
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAMES.STATIC);
      
      // Precache critical assets one by one to avoid failures
      for (const url of PRECACHE_URLS) {
        try {
          const response = await fetch(url, { cache: 'reload' });
          if (response.ok) {
            await cache.put(url, response);
            console.log('✅ Precached:', url);
          }
        } catch (e) {
          console.warn('⚠️ Failed to precache:', url);
        }
      }
      
      console.log('✅ Precaching complete');
    })()
  );
});

// Activate - clean old caches immediately
self.addEventListener('activate', (event) => {
  console.log('🔄 Activating Service Worker:', CACHE_VERSION);
  
  event.waitUntil(
    (async () => {
      const currentCaches = Object.values(CACHE_NAMES);
      const cacheNames = await caches.keys();
      
      await Promise.all(
        cacheNames.map(cacheName => {
          if (!currentCaches.includes(cacheName)) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
      
      await self.clients.claim();
      await notifyClientsOfUpdate();
      console.log('✅ Service Worker activated');
    })()
  );
});

// Helper: Add cache timestamp
function addCacheTimestamp(response) {
  const headers = new Headers(response.headers);
  headers.set('sw-cache-time', Date.now().toString());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Helper: Check cache expiration
function isCacheExpired(response, maxAge) {
  if (!response) return true;
  const cachedTime = response.headers.get('sw-cache-time');
  if (!cachedTime) return true;
  return (Date.now() - parseInt(cachedTime, 10)) > maxAge;
}

// Strategy: Cache-first (instant loading)
async function cacheFirst(request, cacheName, maxAge = CACHE_EXPIRATION.STATIC) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (cached && !isCacheExpired(cached, maxAge)) {
    // Background update
    fetch(request).then(response => {
      if (response.ok) cache.put(request, addCacheTimestamp(response));
    }).catch(() => {});
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, addCacheTimestamp(response.clone()));
    }
    return response;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

// Strategy: Network-first with fast fallback
async function networkFirst(request, cacheName, maxAge = CACHE_EXPIRATION.API) {
  const cache = await caches.open(cacheName);
  
  // Race: network vs timeout
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('timeout')), 3000)
  );
  
  try {
    const response = await Promise.race([fetch(request), timeoutPromise]);
    if (response.ok) {
      cache.put(request, addCacheTimestamp(response.clone()));
    }
    return response;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) {
      console.log('📡 Using cached response for:', request.url);
      return cached;
    }
    throw e;
  }
}

// Strategy: Stale-while-revalidate (instant + fresh)
async function staleWhileRevalidate(request, cacheName, maxAge = CACHE_EXPIRATION.DYNAMIC) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  const networkPromise = fetch(request).then(response => {
    if (response.ok) {
      cache.put(request, addCacheTimestamp(response.clone()));
    }
    return response;
  }).catch(() => cached);
  
  return cached || networkPromise;
}

// Main fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other non-http
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // API calls - network first with cache fallback
  if (url.hostname.includes('supabase.co') || url.hostname.includes('backend.maddasystems.co.ke')) {
    event.respondWith(
      networkFirst(request, CACHE_NAMES.API, CACHE_EXPIRATION.API)
        .catch(() => new Response(
          JSON.stringify({ success: false, offline: true, message: 'Offline mode - will retry when online' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // Fonts - cache first (long-lived)
  if (url.pathname.match(/\.(woff2?|ttf|otf|eot)$/) || url.hostname.includes('fonts.')) {
    event.respondWith(cacheFirst(request, CACHE_NAMES.FONTS, CACHE_EXPIRATION.FONTS));
    return;
  }

  // Images - cache first
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico|avif)$/)) {
    event.respondWith(cacheFirst(request, CACHE_NAMES.IMAGES, CACHE_EXPIRATION.IMAGES));
    return;
  }

  // Static assets (JS, CSS) - cache first
  if (url.pathname.match(/\.(js|css|mjs)$/) || url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request, CACHE_NAMES.STATIC, CACHE_EXPIRATION.STATIC));
    return;
  }

  // Navigation requests - SPA handling
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Try network with 3s timeout
          const networkPromise = fetch(request);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('timeout')), 3000)
          );
          
          const response = await Promise.race([networkPromise, timeoutPromise]);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAMES.DYNAMIC);
            cache.put('/index.html', addCacheTimestamp(response.clone()));
            return response;
          }
        } catch (e) {
          // Network failed or timed out
        }
        
        // Serve cached index.html for SPA routing
        const cached = await caches.match('/index.html');
        if (cached) return cached;
        
        const offline = await caches.match('/offline.html');
        if (offline) return offline;
        
        return new Response('Offline', { status: 503 });
      })()
    );
    return;
  }

  // Everything else - stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request, CACHE_NAMES.RUNTIME));
});

// Background sync for offline data
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync:', event.tag);
  if (event.tag === 'sync-milk-data' || event.tag === 'sync-receipts') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'BACKGROUND_SYNC', tag: event.tag });
        });
      })
    );
  }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'PERIODIC_SYNC' });
        });
      })
    );
  }
});

// Push notifications support
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Milk Collection', {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: [200, 100, 200],
        data: data.data
      })
    );
  }
});

// Message handler
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CACHE_URLS':
      if (payload?.urls) {
        event.waitUntil(
          caches.open(CACHE_NAMES.RUNTIME).then(cache => 
            Promise.all(payload.urls.map(url => 
              fetch(url).then(r => r.ok && cache.put(url, addCacheTimestamp(r)))
                .catch(() => {})
            ))
          )
        );
      }
      break;
      
    case 'CLEANUP_CACHES':
      event.waitUntil(cleanupExpiredCaches());
      break;
      
    case 'GET_VERSION':
      event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION });
      break;
  }
});

// Cleanup expired cache entries
async function cleanupExpiredCaches() {
  const now = Date.now();
  
  for (const [type, cacheName] of Object.entries(CACHE_NAMES)) {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      
      const maxAge = type === 'API' ? CACHE_EXPIRATION.API :
                     type === 'IMAGES' ? CACHE_EXPIRATION.IMAGES :
                     type === 'FONTS' ? CACHE_EXPIRATION.FONTS :
                     CACHE_EXPIRATION.DYNAMIC;
      
      for (const request of keys) {
        const response = await cache.match(request);
        if (response && isCacheExpired(response, maxAge * 2)) { // 2x for cleanup
          await cache.delete(request);
        }
      }
    } catch (e) {
      console.warn('Cache cleanup error:', e);
    }
  }
}

// Error handlers
self.addEventListener('error', (e) => console.error('SW Error:', e.error));
self.addEventListener('unhandledrejection', (e) => console.error('SW Rejection:', e.reason));

console.log('🚀 Native-like PWA Service Worker loaded:', CACHE_VERSION);
