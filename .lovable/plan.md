

# Fix 404 Route & 503 Backend Blocking

## Bug 1: 404 on Startup

The `NotFound` component logs "404 Error: User attempted to access non-existent route" — but looking at the router in `App.tsx`, there IS a catch-all `<Route path="*">` pointing to `NotFound`. The 404 is likely triggered by the Capacitor WebView loading an initial URL path that doesn't match (e.g. the Android WebView may navigate to a deep path from history or a stale URL).

The catch-all route already exists and works correctly — it redirects to NotFound. The "fix" is to make NotFound auto-redirect to `/` instead of showing a dead-end page, since on a Capacitor app there's no address bar to manually navigate.

### Changes: `src/pages/NotFound.tsx`
- Add `useNavigate()` and auto-redirect to `/` after a short delay (or immediately) when running in a Capacitor context
- Keep the 404 page visible for web users but auto-redirect on native

## Bug 2: 503 Blocking Access

The log `⚠️ Unexpected response status: 503 - blocking access` comes from `useAppSettings.ts` line 440. When the `/api/devices/fingerprint/:fingerprint` endpoint returns 503 (e.g. server overloaded or preflight fails), the code falls into the catch-all `else` branch at line 432 which treats ANY non-200/non-404 status as "unauthorized" and blocks access.

A 503 is a **transient server error**, not a security decision. It should be treated like a network error (use cached auth if available), not like "device unauthorized".

### Changes: `src/hooks/useAppSettings.ts`
- Add a check for 5xx status codes (500, 502, 503, 504) before the catch-all `else` block
- For 5xx errors, treat them like network errors: use cached authorization if `device_authorized === 'true'` in localStorage, otherwise block
- This prevents a temporary server hiccup from permanently locking out an already-approved device

### Changes: `src/components/BackendStatusBanner.tsx`
- The version check fetch already has a try/catch that swallows errors — no changes needed here, the 503 is coming from `useAppSettings.ts`

## What stays the same
- No router structure changes in App.tsx
- No backend changes
- No changes to login flow, fingerprint generation, or offline logic

