/**
 * v2.11.23: Hardware Back button handling for Android.
 * - On root route ("/") or when no history is available, exit the app.
 * - Otherwise navigate back through browser history (React Router listens).
 * No-op on web.
 */
import { Capacitor } from '@capacitor/core';

let installed = false;

export const installNativeBackButton = async (): Promise<void> => {
  if (installed) return;
  if (!Capacitor.isNativePlatform()) return;
  installed = true;

  try {
    const [{ App }] = await Promise.all([import('@capacitor/app')]);

    App.addListener('backButton', async () => {
      const path = window.location.pathname || '/';
      const canGoBack = window.history.length > 1 && path !== '/';
      console.log(`[BACK] Hardware back button pressed route=${path} canGoBack=${canGoBack}`);

      if (canGoBack) {
        try {
          window.history.back();
        } catch (e) {
          console.warn('[BACK] history.back failed, exiting app:', e);
          try { await App.exitApp(); } catch {}
        }
      } else {
        try {
          await App.exitApp();
        } catch (e) {
          console.warn('[BACK] App.exitApp failed:', e);
        }
      }
    });

    console.log('[BACK] Hardware back button listener registered');
  } catch (e) {
    console.warn('[BACK] Failed to install back button listener:', e);
  }
};
