import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { APP_VERSION } from "./constants/appVersion";
import { Capacitor } from "@capacitor/core";

// v2.11.14: force LIGHT theme on every launch. WebView 51 on Android 7 was
// inheriting prefers-color-scheme:dark from the host OS which flipped the
// dashboard to the navy `.dark` palette. Strip the class synchronously so
// nothing renders in dark mode.
try {
  const html = document.documentElement;
  html.classList.remove("dark");
  html.style.colorScheme = "light";
  html.setAttribute("data-theme", "light");
} catch {}


// WebView Compatibility Polyfills / Checks
if (typeof AbortController === 'undefined') {
  console.warn('[COMPAT] AbortController is not defined. Network request timeouts will be disabled.');
  // Minimal no-op polyfill for safety if needed by 3rd party libs
  (window as any).AbortController = class AbortController {
    signal = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };
    abort() { (this.signal as any).aborted = true; }
  };
}

if (typeof AbortSignal === 'undefined') {
  (window as any).AbortSignal = class AbortSignal {};
}

declare global {
  interface Window {
    __DELICOOP_BOOT?: {
      htmlLoadedAt?: number;
      moduleStarted?: boolean;
      moduleStartedAt?: number;
      renderRequested?: boolean;
      renderRequestedAt?: number;
      renderError?: string;
    };
    __swRegistration?: ServiceWorkerRegistration;
  }
}

if (window.__DELICOOP_BOOT) {
  window.__DELICOOP_BOOT.moduleStarted = true;
  window.__DELICOOP_BOOT.moduleStartedAt = Date.now();
}

console.info('[BOOT] main.tsx module started', { version: APP_VERSION });

// v2.11.21 — Bridge & Plugin Diagnostics (verbose for WebView 51 triage)
if (Capacitor.isNativePlatform()) {
  setTimeout(() => {
    try {
      const cap = (window as any).Capacitor;
      console.log('🔍 [BRIDGE] Platform:', Capacitor.getPlatform());
      console.log('🔍 [BRIDGE] window.Capacitor present:', !!cap);
      if (cap?.Plugins) {
        const names = Object.keys(cap.Plugins);
        // JSON.stringify so WebView 51 console preserves the array intact
        console.log('🔍 [BRIDGE] Plugin count:', names.length, 'names:', JSON.stringify(names));
        const required = ['BluetoothClassic', 'OfflineStorage', 'BluetoothLe'];
        required.forEach((r) => {
          if (!names.includes(r)) {
            console.error('❌ [BRIDGE] Required plugin MISSING from bridge:', r);
          } else {
            console.log('✅ [BRIDGE] Plugin present:', r);
          }
        });
      } else {
        console.error('❌ [BRIDGE] window.Capacitor.Plugins is not present');
      }
      const hasJsFallback = !!(window as any).BluetoothClassicAndroid;
      console.log('🔍 [BRIDGE] BluetoothClassicAndroid JS fallback present:', hasJsFallback);
    } catch (e) {
      console.error('❌ [BRIDGE] Diagnostic failed:', e);
    }
  }, 5000);
}


// Install low-risk startup utilities after the boot marker so failures are visible.
import("./utils/errorHandler").catch((error) => {
  console.error('[BOOT] Failed to load error handler:', error);
});

import("./utils/persistentLogger")
  .then(({ _setLoggerAppVersion }) => {
    _setLoggerAppVersion(APP_VERSION);
    // installPersistentLogger intentionally remains disabled during native boot diagnosis.
  })
  .catch((error) => {
    console.error('[BOOT] Failed to load persistent logger module:', error);
  });

// v2.11.23: hardware Back button on native (exit on dashboard, navigate back otherwise)
import("./utils/nativeBackButton")
  .then(({ installNativeBackButton }) => { installNativeBackButton(); })
  .catch((error) => { console.warn('[BOOT] Failed to install back button:', error); });

// v2.12.10: restore saved scale/printer connections automatically on native.
// This installer was never invoked, so nothing reconnected after the app was
// backgrounded and reopened — users had to pair again from Settings.
// Web stays manual (Web Bluetooth needs a user gesture).
if (Capacitor.isNativePlatform()) {
  import("./services/btConnectionManager")
    .then(({ installAutoReconnect }) => { installAutoReconnect(); })
    .catch((error) => { console.warn('[BOOT] Failed to install BT auto-reconnect:', error); });
}


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

const renderStartupFailure = (rootElement: HTMLElement | null, error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown React startup error';
  console.error('[BOOT] React render failed before first paint:', error);

  if (window.__DELICOOP_BOOT) {
    window.__DELICOOP_BOOT.renderError = message;
  }

  if (rootElement) {
    rootElement.innerHTML = `<div style="min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;background:#f9fafb;color:#111827;"><div style="max-width:420px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;padding:20px;box-shadow:0 16px 40px #1118271a;"><strong style="display:block;font-size:18px;margin-bottom:8px;">App startup failed</strong><span style="display:block;font-size:14px;line-height:1.45;color:#4b5563;">${message}</span></div></div>`;
  }
};

// Render app. Local app modules are dynamically imported only after the boot
// marker is set, so import-time failures no longer masquerade as a spinner.
const renderApp = async () => {
  const rootElement = document.getElementById("root");

  try {
    if (!rootElement) {
      throw new Error('Root element #root was not found');
    }

    const { default: App } = await import("./App.tsx");

    if (window.__DELICOOP_BOOT) {
      window.__DELICOOP_BOOT.renderRequested = true;
      window.__DELICOOP_BOOT.renderRequestedAt = Date.now();
    }

    createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

    console.info('[BOOT] React render requested');
  } catch (error) {
    renderStartupFailure(rootElement, error);
  }
};

renderApp();

// Advanced Service Worker registration - skip in Capacitor native apps
// Use multiple checks for reliable Capacitor detection (bridge may not be ready immediately)
const isCapacitorApp = (): boolean => {
  try {
    if (Capacitor.isNativePlatform()) {
      return true;
    }

    const capacitorPlatform = Capacitor.getPlatform();
    if (capacitorPlatform === 'android' || capacitorPlatform === 'ios') {
      return true;
    }

    // Check for Capacitor global object
    const capGlobal = (window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean; platform?: string; getPlatform?: () => string } }).Capacitor;
    if (!capGlobal) return false;
    
    // Check isNativePlatform if available
    if (typeof capGlobal.isNativePlatform === 'function') {
      return capGlobal.isNativePlatform();
    }
    
    // Fallback: check platform property
    const platform = capGlobal.platform || capGlobal.getPlatform?.();
    return platform === 'android' || platform === 'ios';
  } catch {
    return window.location.protocol === 'capacitor:' || window.location.hostname === 'app';
  }
};

const isCapacitor = isCapacitorApp();

const isInsideIframe = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

const isLovablePreviewHost = (hostname: string): boolean => {
  return hostname.startsWith('id-preview--') ||
    hostname.startsWith('preview--') ||
    hostname === 'lovableproject.com' ||
    hostname.endsWith('.lovableproject.com') ||
    hostname === 'lovableproject-dev.com' ||
    hostname.endsWith('.lovableproject-dev.com') ||
    hostname === 'beta.lovable.dev' ||
    hostname.endsWith('.beta.lovable.dev');
};

const unregisterAppShellServiceWorkers = async (reason: string) => {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      registrations
        .filter((registration) => {
          const scriptURL = registration.active?.scriptURL || registration.installing?.scriptURL || registration.waiting?.scriptURL || '';
          return scriptURL.endsWith('/sw.js') || registration.scope === `${window.location.origin}/`;
        })
        .map((registration) => registration.unregister())
    );
    console.info('[BOOT] Service Worker disabled for this context:', reason);
  } catch (error) {
    console.warn('[BOOT] Failed to unregister Service Worker:', error);
  }
};

const shouldRegisterServiceWorker = (): boolean => {
  if (!('serviceWorker' in navigator)) return false;
  if (isCapacitor) return false;
  if (!import.meta.env.PROD) return false;
  if (isInsideIframe()) return false;
  if (window.location.search.includes('sw=off')) return false;
  if (isLovablePreviewHost(window.location.hostname)) return false;
  return true;
};

if (shouldRegisterServiceWorker()) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none'
      });
      
      console.log('✅ Service Worker registered');
      
      // Store registration globally
      window.__swRegistration = registration;
      
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
          await (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync?.register('sync-milk-data');
        } catch (e) {
          console.log('Background sync not available');
        }
      }
      
      // Request periodic sync (if supported)
      if ('periodicSync' in registration) {
        try {
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' as any });
          if (status.state === 'granted') {
              await (registration as ServiceWorkerRegistration & { periodicSync?: { register: (tag: string, options: { minInterval: number }) => Promise<void> } }).periodicSync?.register('sync-data', {
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
} else {
  const reason = isCapacitor
    ? 'Capacitor native app'
    : !import.meta.env.PROD
      ? 'development build'
      : isInsideIframe()
        ? 'iframe preview'
        : isLovablePreviewHost(window.location.hostname)
          ? 'Lovable preview host'
          : window.location.search.includes('sw=off')
            ? 'sw=off kill switch'
            : 'unsupported context';
  unregisterAppShellServiceWorkers(reason);
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
