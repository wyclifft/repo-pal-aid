import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ServiceWorkerUpdateBanner } from "./components/ServiceWorkerUpdateBanner.tsx";
import { initializeNativePlatform } from "./utils/nativeInit";
import "./index.css";
import "./utils/errorHandler";

// Initialize native platform features FIRST (critical for device registration)
initializeNativePlatform().catch(console.error);

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
      <ServiceWorkerUpdateBanner />
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Advanced Service Worker registration
if ('serviceWorker' in navigator) {
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
      registration.update();
      
      // Check for updates every 30 minutes
      setInterval(() => {
        registration.update().catch(console.error);
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
