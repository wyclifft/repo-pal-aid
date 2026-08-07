/**
 * v2.12.10: Hardware Back button handling for Android (single owner).
 *
 * Rules:
 *  - Dashboard ("/") → minimise/exit the app.
 *  - Any inner page (transaction, store, reports, settings…) → go back to the
 *    previous page; if there is no history entry (deep-link / reload), fall
 *    back to the Dashboard instead of closing the app.
 *
 * NOTE: this is the ONLY backButton listener in the app. nativeInit.ts must not
 * register a second one — two listeners caused double navigation / early exit.
 */
import { Capacitor } from '@capacitor/core';

let installed = false;

const DASHBOARD_PATH = '/';

export const installNativeBackButton = async (): Promise<void> => {
  if (installed) return;
  if (!Capacitor.isNativePlatform()) return;
  installed = true;

  try {
    const { App } = await import('@capacitor/app');

    App.addListener('backButton', async () => {
      const path = window.location.pathname || DASHBOARD_PATH;
      const hasHistory = window.history.length > 1;
      console.log(`[BACK] pressed route=${path} historyLen=${window.history.length}`);

      // On the Dashboard the back button minimises/closes the app.
      if (path === DASHBOARD_PATH) {
        try {
          await App.minimizeApp?.();
        } catch {
          try { await App.exitApp(); } catch {}
        }
        return;
      }

      // Inner page → previous page, or Dashboard when there is no history.
      if (hasHistory) {
        try {
          window.history.back();
          return;
        } catch (e) {
          console.warn('[BACK] history.back failed, routing to dashboard:', e);
        }
      }

      // Fallback: hand control to the router via a history push the SPA listens to.
      try {
        window.history.pushState({}, '', DASHBOARD_PATH);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch (e) {
        console.warn('[BACK] dashboard fallback failed:', e);
        window.location.assign(DASHBOARD_PATH);
      }
    });

    console.log('[BACK] Hardware back button listener registered');
  } catch (e) {
    console.warn('[BACK] Failed to install back button listener:', e);
  }
};
