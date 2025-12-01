/**
 * Pre-cache all application pages for offline use
 * This should be called after successful login to ensure all pages are accessible offline
 */
export const precacheApplicationPages = async (): Promise<void> => {
  console.log('🔄 Pre-caching application pages...');
  
  // List of all application routes to pre-cache
  const pagesToCache = [
    '/',
    '/settings',
    '/z-report',
    '/periodic-report',
    '/store',
    '/device-approval',
  ];

  try {
    // Pre-fetch all pages to trigger service worker caching
    const cachePromises = pagesToCache.map(async (page) => {
      try {
        const response = await fetch(page, {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
          },
        });
        
        if (response.ok) {
          console.log(`✅ Cached page: ${page}`);
        } else {
          console.warn(`⚠️ Failed to cache page ${page}: ${response.status}`);
        }
      } catch (error) {
        console.warn(`⚠️ Error caching page ${page}:`, error);
      }
    });

    await Promise.all(cachePromises);
    console.log('✅ All application pages pre-cached for offline use');
    
    // Mark that initial caching is complete
    localStorage.setItem('pages_cached', 'true');
    localStorage.setItem('pages_cache_timestamp', Date.now().toString());
    
    return Promise.resolve();
  } catch (error) {
    console.error('❌ Error during page pre-caching:', error);
    return Promise.reject(error);
  }
};

/**
 * Check if pages have been cached recently
 */
export const arePagesRecentlyCached = (): boolean => {
  const cached = localStorage.getItem('pages_cached');
  const timestamp = localStorage.getItem('pages_cache_timestamp');
  
  if (!cached || !timestamp) {
    return false;
  }
  
  // Consider cache valid for 7 days
  const cacheAge = Date.now() - parseInt(timestamp, 10);
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  
  return cacheAge < sevenDays;
};
