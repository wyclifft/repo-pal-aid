import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import "./index.css";
import "./utils/errorHandler";

// Initialize native platform features FIRST (critical for device registration)
// Dynamic import to prevent module-level crashes from @capacitor/core on Android 7 WebView
(async () => {
  try {
    const { initializeNativePlatform } = await import("./utils/nativeInit");
    await initializeNativePlatform();
  } catch (err) {
    console.warn('Native init failed:', err);
  }
})();

// Prevent zoom on double tap for native feel
document.addEventListener('touchstart', (e) => {
  if (e.touches.length > 1) {
    e.preventDefault();
  }
}, { passive: false });

let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, { passive: false });

// Render app
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Advanced Service Worker registration - skip in Capacitor native apps
// Use multiple checks for reliable Capacitor detection (bridge may not be ready immediately)
const isCapacitorApp = (): boolean => {
  try {
    // Reliable native detection even before Capacitor bridge is fully ready
    if (window.location.hostname === 'app' || window.location.protocol === 'capacitor:') {
      return true;
    }

    const capGlobal = (window as any).Capacitor;
    if (!capGlobal) return false;
    
    // Check isNativePlatform if available
    if (typeof capGlobal.isNativePlatform === 'function') {
      return capGlobal.isNativePlatform();
    }
    
    // Fallback: check platform property
    const platform = capGlobal.platform || capGlobal.getPlatform?.();
    return platform === 'android' || platform === 'ios';
  } catch {
    return false;
  }
};

const isCapacitor = isCapacitorApp();

if ('serviceWorker' in navigator && !isCapacitor) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none'
      });
      
      console.log('✅ Service Worker registered');
      
      // Store registration globally
      (window as any).__swRegistration = registration;
      
      // Check for updates immediately
      registration.update().catch(() => {});
      
      // Check for updates every 30 minutes
      setInterval(() => {
        registration.update().catch(() => {});
      }, 30 * 60 * 1000);
      
      // Handle waiting service worker
      if (registration.waiting) {
        dispatchEvent(new CustomEvent('swUpdate', { detail: registration }));
      }
      
      // Listen for new service worker
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              dispatchEvent(new CustomEvent('swUpdate', { detail: registration }));
            }
          });
        }
      });
      
      // Handle controller change (new SW activated)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('🔄 Service Worker controller changed');
      });
      
      // Listen for messages from SW
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type } = event.data || {};
        
        if (type === 'BACKGROUND_SYNC' || type === 'PERIODIC_SYNC') {
          // Trigger data sync in app
          dispatchEvent(new CustomEvent('backgroundSync'));
        }
        
        if (type === 'SW_UPDATE_AVAILABLE') {
          dispatchEvent(new CustomEvent('swUpdate', { detail: registration }));
        }
      });
      
      // Request background sync permission
      if ('sync' in registration) {
        try {
          await (registration as any).sync.register('sync-milk-data');
        } catch (e) {
          console.log('Background sync not available');
        }
      }
      
      // Request periodic sync (if supported)
      if ('periodicSync' in registration) {
        try {
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' as any });
          if (status.state === 'granted') {
            await (registration as any).periodicSync.register('sync-data', {
              minInterval: 60 * 60 * 1000 // 1 hour
            });
          }
        } catch (e) {
          console.log('Periodic sync not available');
        }
      }
      
      // Periodic cache cleanup
      setInterval(() => {
        if (registration.active) {
          registration.active.postMessage({ type: 'CLEANUP_CACHES' });
        }
      }, 60 * 60 * 1000); // Every hour
      
    } catch (error) {
      console.error('❌ Service Worker registration failed:', error);
    }
  });
} else if (isCapacitor) {
  console.log('📱 Capacitor native app - skipping Service Worker registration');

  // Safety: remove any previously registered web service workers on native startup
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => console.log('🧹 Cleared legacy Service Workers on native app startup'))
        .catch(() => {});
    });
  }

  // Safety: clear browser caches that may trap old offline responses
  if ('caches' in window) {
    window.addEventListener('load', () => {
      caches.keys()
        .then((cacheNames) => Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))))
        .then(() => console.log('🧹 Cleared legacy web caches on native app startup'))
        .catch(() => {});
    });
  }
}

// Handle online/offline status
window.addEventListener('online', () => {
  console.log('📡 Online');
  dispatchEvent(new CustomEvent('connectionChange', { detail: { online: true } }));
});

window.addEventListener('offline', () => {
  console.log('📡 Offline');
  dispatchEvent(new CustomEvent('connectionChange', { detail: { online: false } }));
});

// Prevent context menu for native feel
document.addEventListener('contextmenu', (e) => {
  if ((e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') {
    e.preventDefault();
  }
});

// Handle app visibility for data refresh
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    dispatchEvent(new CustomEvent('appVisible'));
  }
});
