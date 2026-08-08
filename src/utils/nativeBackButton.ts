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
      // v2.12.11: Support HashRouter paths. window.location.pathname is usually
      // /index.html in Capacitor; the real SPA route is in window.location.hash.
      const rawHash = window.location.hash || '';
      const path = rawHash.replace(/^#/, '') || DASHBOARD_PATH;

      // Normalize: ensure path starts with / for comparison (e.g. "" -> "/", "settings" -> "/settings")
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;

      const hasHistory = window.history.length > 1;
      console.log(`[BACK] pressed route=${normalizedPath} (raw=${rawHash}) historyLen=${window.history.length}`);

      // v2.12.12: Dispatch custom event so components can intercept the back button
      // before we take any action. This allows handling internal UI state like
      // Buy/Sell portal or modals without changing the URL.
      const ev = new CustomEvent('ionBackButton', {
        cancelable: true,
        detail: {
          path: normalizedPath,
          canGoBack: hasHistory
        }
      });
      window.dispatchEvent(ev);

      if (ev.defaultPrevented) {
        console.log('[BACK] Default prevented by component listener');
        return;
      }

      // On the Dashboard the back button fully exits the app.
      // v2.12.14: Use exitApp() instead of minimizeApp() so that reopening
      // the APK starts fresh from the Login page.
      if (normalizedPath === DASHBOARD_PATH || normalizedPath === '' || normalizedPath === '/index.html') {
        console.log(`[BACK] Dashboard/Root detected (${normalizedPath}), calling exitApp()`);
        try {
          await App.exitApp();
        } catch (e) {
          console.error('[BACK] exitApp failed:', e);
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
        window.location.hash = DASHBOARD_PATH;
      } catch (e) {
        console.warn('[BACK] dashboard fallback failed:', e);
        window.location.assign(`#${DASHBOARD_PATH}`);
      }
    });

    console.log('[BACK] Hardware back button listener registered');
  } catch (e) {
    console.warn('[BACK] Failed to install back button listener:', e);
  }
};
