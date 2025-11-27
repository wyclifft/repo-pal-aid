const CACHE_NAME = 'milk-collection-v10';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching app shell...');
        return cache.addAll(urlsToCache).catch(err => {
          console.error('Cache addAll error:', err);
          // Continue installation even if some files fail to cache
          return Promise.resolve();
        });
      })
      .catch(error => {
        console.error('Service Worker install error:', error);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).catch(error => {
      console.error('Service Worker activation error:', error);
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url);

    // Handle Supabase requests
    if (url.hostname.includes('supabase.co')) {
      event.respondWith(
        fetch(event.request).catch((error) => {
          console.warn('Supabase request failed (offline):', error.message);
          return new Response(
            JSON.stringify({ offline: true, message: 'Offline mode - data will sync when online' }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        })
      );
      return;
    }

    // Handle MySQL backend API requests
    if (url.hostname.includes('backend.maddasystems.co.ke')) {
      event.respondWith(
        fetch(event.request).catch((error) => {
          console.warn('Backend API request failed (offline):', error.message);
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

    // Handle all other requests with cache-first strategy
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) {
            return response;
          }
          
          return fetch(event.request).then((response) => {
            if (!response || response.status !== 200) {
              return response;
            }
            
            if (event.request.method === 'GET' &&
                (response.type === 'basic' || response.type === 'cors')) {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache).catch(err => {
                  console.warn('Failed to cache response:', err);
                });
              });
            }
            return response;
          });
        })
        .catch((error) => {
          console.warn('Fetch failed:', error.message);
          // Return offline page for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html').then((response) => {
              return response || caches.match('/index.html');
            });
          }
          
          // Return generic offline response for other requests
          return new Response('Offline', { 
            status: 503, 
            statusText: 'Service Unavailable' 
          });
        })
    );
  } catch (error) {
    console.error('Service Worker fetch handler error:', error);
    // Return a basic error response
    event.respondWith(
      new Response('Service Worker Error', { 
        status: 500, 
        statusText: 'Internal Service Worker Error' 
      })
    );
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-milk-data') {
    event.waitUntil(syncMilkData());
  }
});

async function syncMilkData() {
  console.log('Background sync triggered');
  try {
    // Background sync logic would go here
    console.log('Background sync completed');
  } catch (error) {
    console.error('Background sync failed:', error);
    throw error; // Re-throw to retry sync later
  }
}

// Error handling for service worker
self.addEventListener('error', (event) => {
  console.error('Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker unhandled rejection:', event.reason);
});
