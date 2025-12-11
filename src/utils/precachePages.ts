/**
 * Aggressive precaching for native-like offline experience
 */

// Critical routes to precache
const CRITICAL_ROUTES = [
  '/',
  '/settings',
  '/z-report',
  '/periodic-report',
  '/store',
  '/device-approval',
];

// Assets to precache
const CRITICAL_ASSETS = [
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html',
];

/**
 * Precache all application pages and assets
 */
export const precacheApplicationPages = async (): Promise<void> => {
  console.log('🔄 Starting aggressive precaching...');
  
  const allUrls = [...CRITICAL_ROUTES, ...CRITICAL_ASSETS];
  let successCount = 0;
  let failCount = 0;

  // Use service worker to cache URLs if available
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CACHE_URLS',
      payload: { urls: allUrls }
    });
  }

  // Also fetch each URL to trigger caching
  const cachePromises = allUrls.map(async (url) => {
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'reload', // Force fresh fetch for caching
        credentials: 'same-origin'
      });
      
      if (response.ok) {
        successCount++;
        console.log(`✅ Cached: ${url}`);
      } else {
        failCount++;
        console.warn(`⚠️ Failed to cache: ${url} (${response.status})`);
      }
    } catch (error) {
      failCount++;
      console.warn(`⚠️ Error caching: ${url}`, error);
    }
  });

  await Promise.allSettled(cachePromises);
  
  console.log(`✅ Precaching complete: ${successCount} cached, ${failCount} failed`);
  
  // Store cache metadata
  localStorage.setItem('pages_cached', 'true');
  localStorage.setItem('pages_cache_timestamp', Date.now().toString());
  localStorage.setItem('pages_cache_count', successCount.toString());
};

/**
 * Check if pages have been recently cached
 */
export const arePagesRecentlyCached = (): boolean => {
  const cached = localStorage.getItem('pages_cached');
  const timestamp = localStorage.getItem('pages_cache_timestamp');
  
  if (!cached || !timestamp) return false;
  
  // Cache valid for 24 hours
  const cacheAge = Date.now() - parseInt(timestamp, 10);
  const oneDayMs = 24 * 60 * 60 * 1000;
  
  return cacheAge < oneDayMs;
};

/**
 * Force refresh all caches
 */
export const refreshAllCaches = async (): Promise<void> => {
  localStorage.removeItem('pages_cached');
  localStorage.removeItem('pages_cache_timestamp');
  await precacheApplicationPages();
};

/**
 * Prefetch a specific route for instant navigation
 */
export const prefetchRoute = (route: string): void => {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'CACHE_URLS',
      payload: { urls: [route] }
    });
  }
  
  // Also use link prefetch
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = route;
  document.head.appendChild(link);
};

/**
 * Preload critical assets on app start
 */
export const preloadCriticalAssets = (): void => {
  const assets = [
    { href: '/icons/icon-192.png', as: 'image' },
    { href: '/favicon.png', as: 'image' },
  ];
  
  assets.forEach(({ href, as }) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.href = href;
    link.as = as;
    document.head.appendChild(link);
  });
};
