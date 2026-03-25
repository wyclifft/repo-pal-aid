

# Fix Login & Android Communication Issues

## Problem Summary

Three distinct issues prevent the app from working:

1. **Login POST fails** — The preview environment's fetch proxy intercepts POST requests. GET requests work fine (device checks return 200), but the POST to `/api/auth/login` fails with "Failed to fetch".

2. **Android 7 crash** — A static `import { Capacitor }` in `nativeInit.ts` crashes on older WebViews before the bridge is ready, breaking the entire app on Android 7 POS devices.

3. **Build errors** — 10 files reference `NodeJS.Timeout` but the TypeScript config lacks Node types.

## Changes

### Step 1: Fix POST login requests
**File: `src/services/mysqlApi.ts`**
- Add a `nativeFetch()` helper that tries `fetch` first, and falls back to `XMLHttpRequest` for POST requests when fetch fails. This bypasses the proxy.

### Step 2: Fix Android Capacitor crash
**File: `src/utils/nativeInit.ts`**
- Replace static `import { Capacitor } from '@capacitor/core'` with defensive `(window as any).Capacitor` checks throughout.

### Step 3: Fix build errors
**File: `src/vite-env.d.ts`**
- Add `NodeJS.Timeout` namespace declaration and module declarations for `@capacitor/device` and `@vitejs/plugin-legacy`.

### Step 4: Fix Service Worker POST handling
**Files: `sw.js` and `public/sw.js`**
- For non-GET requests, `return;` immediately instead of `event.respondWith(fetch(request))` — let POST requests go straight to the network.

### Step 5: Update backend CORS headers
**File: `backend-api/.htaccess`**
- Add `X-App-Origin` and `X-Device-Fingerprint` to `Access-Control-Allow-Headers`.

## What stays the same
- No changes to backend `server.js`, fingerprint generation, login UI, offline login, or Capacitor config.

