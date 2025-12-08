import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ServiceWorkerUpdateBanner } from "./components/ServiceWorkerUpdateBanner.tsx";
import "./index.css";
import "./utils/errorHandler";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ServiceWorkerUpdateBanner />
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Register Service Worker with advanced caching
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('✅ Service Worker registered with scope:', registration.scope);
        
        // Store registration globally for update banner
        (window as any).__swRegistration = registration;

        // Check for updates periodically (every 60 minutes)
        setInterval(() => {
          registration.update().catch(console.error);
        }, 60 * 60 * 1000);

        // Periodic cache cleanup (every 30 minutes)
        setInterval(() => {
          if (registration.active) {
            registration.active.postMessage({ type: 'CLEANUP_CACHES' });
          }
        }, 30 * 60 * 1000);

        // Initial cleanup on load
        if (registration.active) {
          registration.active.postMessage({ type: 'CLEANUP_CACHES' });
        }
      })
      .catch((error) => {
        console.error('❌ Service Worker registration failed:', error);
      });
  });
}

