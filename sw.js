const CACHE_VERSION = 'v15';
const CACHE_NAMES = {
  STATIC: `milk-collection-static-${CACHE_VERSION}`,
  DYNAMIC: `milk-collection-dynamic-${CACHE_VERSION}`,
  API: `milk-collection-api-${CACHE_VERSION}`,
  IMAGES: `milk-collection-images-${CACHE_VERSION}`,
  FONTS: `milk-collection-fonts-${CACHE_VERSION}`,
};

// Critical assets to precache during installation
// For SPA, all routes resolve to index.html
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];

// Broadcast update availability to all clients
const notifyClientsOfUpdate = async () => {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'SW_UPDATE_AVAILABLE', version: CACHE_VERSION });
  });
};

// Cache expiration times (in milliseconds)
const CACHE_EXPIRATION = {
  API: 5 * 60 * 1000,        // 5 minutes for API responses
  IMAGES: 7 * 24 * 60 * 60 * 1000, // 7 days for images
  FONTS: 30 * 24 * 60 * 60 * 1000,  // 30 days for fonts
  DYNAMIC: 24 * 60 * 60 * 1000,     // 24 hours for dynamic content
};

// Install event - precache critical resources
self.addEventListener('install', (event) => {
  console.log('📦 Service Worker installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAMES.STATIC)
      .then((cache) => {
        console.log('✅ Precaching critical assets...');
        return cache.addAll(PRECACHE_URLS).catch(err => {
          console.error('❌ Precache error:', err);
          return Promise.resolve();
        });
      })
      .catch(error => {
        console.error('❌ Install error:', error);
      })
  );
  // Don't skip waiting immediately - let update banner handle it
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🔄 Service Worker activating version:', CACHE_VERSION);
  const currentCaches = Object.values(CACHE_NAMES);
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!currentCaches.includes(cacheName)) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => notifyClientsOfUpdate())
    .catch(error => {
      console.error('❌ Activation error:', error);
    })
  );
  self.clients.claim();
});

// Helper: Check if cache entry is expired
async function isCacheExpired(cacheName, request, maxAge) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  if (!cachedResponse) return true;
  
  const cachedTime = cachedResponse.headers.get('sw-cache-time');
  if (!cachedTime) return true;
  
  const age = Date.now() - parseInt(cachedTime, 10);
  return age > maxAge;
}

// Helper: Add timestamp to cached response
function addCacheTimestamp(response) {
  const clonedResponse = response.clone();
  const headers = new Headers(clonedResponse.headers);
  headers.set('sw-cache-time', Date.now().toString());
  
  return new Response(clonedResponse.body, {
    status: clonedResponse.status,
    statusText: clonedResponse.statusText,
    headers: headers
  });
}

// Strategy: Network-first with cache fallback (for API calls)
async function networkFirstStrategy(request, cacheName, maxAge) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, addCacheTimestamp(response.clone()));
    }
    return response;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('📡 Using cached API response (offline)');
      return cachedResponse;
    }
    throw error;
  }
}

// Strategy: Cache-first with network fallback (for static assets)
async function cacheFirstStrategy(request, cacheName) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName);
      cache.put(request, addCacheTimestamp(response.clone()));
    }
    return response;
  } catch (error) {
    throw error;
  }
}

// Strategy: Stale-while-revalidate (for dynamic content)
async function staleWhileRevalidateStrategy(request, cacheName, maxAge) {
  const cachedResponse = await caches.match(request);
  
  const fetchPromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(cacheName);
        cache.put(request, addCacheTimestamp(response.clone()));
      }
      return response;
    })
    .catch(() => cachedResponse);
  
  // Return cached response immediately if available, but update cache in background
  if (cachedResponse) {
    const expired = await isCacheExpired(cacheName, request, maxAge);
    if (!expired) {
      fetchPromise.catch(() => {}); // Update in background
      return cachedResponse;
    }
  }
  
  return fetchPromise;
}

// Main fetch handler with advanced caching strategies
self.addEventListener('fetch', (event) => {
  try {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests for caching
    if (request.method !== 'GET') {
      event.respondWith(fetch(request));
      return;
    }

    // Network-first for Supabase API calls
    if (url.hostname.includes('supabase.co')) {
      event.respondWith(
        networkFirstStrategy(request, CACHE_NAMES.API, CACHE_EXPIRATION.API)
          .catch(() => {
            return new Response(
              JSON.stringify({ offline: true, message: 'Offline mode - data will sync when online' }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          })
      );
      return;
    }

    // Network-first for MySQL backend API
    if (url.hostname.includes('2backend.maddasystems.co.ke')) {
      event.respondWith(
        networkFirstStrategy(request, CACHE_NAMES.API, CACHE_EXPIRATION.API)
          .catch(() => {
            return new Response(
              JSON.stringify({ success: false, offline: true, message: 'Offline mode - request will retry when online' }),
              { 
                status: 503,
                headers: { 'Content-Type': 'application/json' } 
              }
            );
          })
      );
      return;
    }

    // Cache-first for fonts
    if (url.pathname.match(/\.(woff2?|ttf|otf|eot)$/)) {
      event.respondWith(
        cacheFirstStrategy(request, CACHE_NAMES.FONTS)
          .catch(() => fetch(request))
      );
      return;
    }

    // Cache-first for images
    if (url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico)$/)) {
      event.respondWith(
        cacheFirstStrategy(request, CACHE_NAMES.IMAGES)
          .catch(() => fetch(request))
      );
      return;
    }

    // Cache-first for static assets (JS, CSS)
    if (url.pathname.match(/\.(js|css)$/) || url.pathname.includes('/assets/')) {
      event.respondWith(
        cacheFirstStrategy(request, CACHE_NAMES.STATIC)
          .catch(() => fetch(request))
      );
      return;
    }

    // SPA Navigation handling - return index.html for navigation requests
    if (request.mode === 'navigate') {
      event.respondWith(
        (async () => {
          try {
            // Try network first for fresh content
            const networkResponse = await fetch(request);
            if (networkResponse.ok) {
              const cache = await caches.open(CACHE_NAMES.DYNAMIC);
              cache.put(request, addCacheTimestamp(networkResponse.clone()));
              return networkResponse;
            }
          } catch (error) {
            // Network failed, try cache
          }
          
          // Try to get from cache (any navigation returns index.html for SPA)
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) {
            return cachedIndex;
          }
          
          // Last resort: offline page
          const offlinePage = await caches.match('/offline.html');
          if (offlinePage) {
            return offlinePage;
          }
          
          return new Response('Offline - No cached content available', { 
            status: 503, 
            statusText: 'Service Unavailable' 
          });
        })()
      );
      return;
    }

    // Stale-while-revalidate for other dynamic content
    event.respondWith(
      staleWhileRevalidateStrategy(request, CACHE_NAMES.DYNAMIC, CACHE_EXPIRATION.DYNAMIC)
        .catch(async () => {
          return new Response('Offline', { 
            status: 503, 
            statusText: 'Service Unavailable' 
          });
        })
    );
  } catch (error) {
    console.error('❌ Fetch handler error:', error);
    event.respondWith(
      new Response('Service Worker Error', { 
        status: 500, 
        statusText: 'Internal Service Worker Error' 
      })
    );
  }
});

// Background sync handler
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-milk-data') {
    event.waitUntil(syncMilkData());
  }
});

async function syncMilkData() {
  console.log('🔄 Background sync triggered');
  try {
    // Background sync logic would go here
    console.log('✅ Background sync completed');
  } catch (error) {
    console.error('❌ Background sync failed:', error);
    throw error;
  }
}

// Periodic cache cleanup to prevent unlimited growth
async function cleanupExpiredCaches() {
  const now = Date.now();
  
  for (const [name, cacheName] of Object.entries(CACHE_NAMES)) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    for (const request of keys) {
      const response = await cache.match(request);
      if (!response) continue;
      
      const cachedTime = response.headers.get('sw-cache-time');
      if (!cachedTime) continue;
      
      const age = now - parseInt(cachedTime, 10);
      let maxAge;
      
      // Determine max age based on cache type
      if (cacheName.includes('api')) maxAge = CACHE_EXPIRATION.API;
      else if (cacheName.includes('images')) maxAge = CACHE_EXPIRATION.IMAGES;
      else if (cacheName.includes('fonts')) maxAge = CACHE_EXPIRATION.FONTS;
      else maxAge = CACHE_EXPIRATION.DYNAMIC;
      
      if (age > maxAge) {
        console.log('🗑️ Removing expired cache entry:', request.url);
        await cache.delete(request);
      }
    }
  }
}

// Run cleanup periodically
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEANUP_CACHES') {
    event.waitUntil(cleanupExpiredCaches());
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Error handling
self.addEventListener('error', (event) => {
  console.error('❌ Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Service Worker unhandled rejection:', event.reason);
});

console.log('🚀 Service Worker loaded with advanced caching strategies');
