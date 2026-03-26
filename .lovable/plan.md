

# Fix Android 7 CORS: CapacitorHttp for Native Builds

## Root Cause

All HTTP calls use browser `fetch()`, which on Android 7 WebView 52 triggers CORS preflight requests that the cPanel backend returns 503 for. Android 11+ works because modern Capacitor patches `fetch()` to route through native HTTP automatically, but Android 7's old WebView doesn't get this patch.

## Solution

Create a single `nativeHttp` utility that detects native platform and routes requests through `CapacitorHttp.request()` (which bypasses WebView CORS entirely), falling back to regular `fetch()` on web/preview. Then wire it into the one central `apiRequest` function and the few direct `fetch()` call sites.

**Important**: On Capacitor 7, `CapacitorHttp` is available from `@capacitor/core` — no new dependencies needed. However, because `nativeInit.ts` uses defensive `window.Capacitor` access (to avoid crashing Android 7 with static imports), the utility must also use defensive dynamic access for `CapacitorHttp`.

## Changes

### Step 1: Create `src/utils/nativeHttp.ts` (new file)

A ~60-line utility exporting `nativeHttpRequest(url, options)` that:
- Checks `window.Capacitor?.isNativePlatform()` defensively (no static import)
- If native: uses `CapacitorHttp.request()` from `@capacitor/core` (dynamic import to avoid Android 7 crash), returns a `Response`-compatible object
- If web: calls regular `fetch()` as-is
- Handles both GET and POST, passes headers/body through

```typescript
export async function nativeHttpRequest(url: string, init?: RequestInit): Promise<Response> {
  const isNative = (window as any).Capacitor?.isNativePlatform?.() ?? false;
  
  if (isNative) {
    const { CapacitorHttp } = await import('@capacitor/core');
    const method = (init?.method || 'GET').toUpperCase();
    const response = await CapacitorHttp.request({
      url,
      method,
      headers: init?.headers as Record<string,string>,
      data: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    // Wrap in Response-like object so all existing parsing code works unchanged
    return new Response(JSON.stringify(response.data), {
      status: response.status,
      headers: new Headers(response.headers),
    });
  }
  
  return fetch(url, init);
}
```

### Step 2: Update `src/services/mysqlApi.ts` (2 lines changed)

Replace the `fetch()` call in `apiRequest` (line 98) with `nativeHttpRequest()`. The XHR fallback for POST stays as-is (it only triggers on web when `fetch` fails).

```diff
+ import { nativeHttpRequest } from '@/utils/nativeHttp';

- response = await fetch(fullUrl, {
+ response = await nativeHttpRequest(fullUrl, {
```

This single change covers **all** API calls: login, device check, farmer sync, milk collection, sales, Z reports — everything flows through `apiRequest`.

### Step 3: Update `src/hooks/useAppSettings.ts` (2 call sites)

Two direct `fetch()` calls:
1. **Line 195** — device registration POST → replace with `nativeHttpRequest()`
2. **Line 296** — device fingerprint GET → replace with `nativeHttpRequest()`

### Step 4: Update `src/components/DeviceAuthStatus.tsx` (2 call sites)

1. **Line 49** — psettings GET → replace with `nativeHttpRequest()`
2. **Line 90** — fingerprint GET → replace with `nativeHttpRequest()`

### Step 5: Update `src/utils/nativeInit.ts` (1 call site)

**Line 92** — device registration POST → replace with `nativeHttpRequest()`

### Step 6: Update `src/components/BackendStatusBanner.tsx` (2 call sites)

1. Version check GET → replace with `nativeHttpRequest()`
2. Retry registration POST → replace with `nativeHttpRequest()`

## What does NOT change

- No changes to response parsing, error handling, or business logic anywhere
- No changes to the login flow, auth state, session management
- No changes to offline/sync logic
- No changes to routing or UI
- No changes to `capacitor.config.ts` or Android manifest
- No changes to any Android Java/Kotlin code
- `fetch()` still works on web/preview (the utility delegates to it)
- Android 11+ continues to work identically (CapacitorHttp is the same mechanism modern Capacitor uses internally)
- The XHR fallback in `mysqlApi.ts` remains as secondary safety net for web environments

## Risk Assessment

- **Low risk**: The change is purely in the HTTP transport layer — replacing `fetch()` with a wrapper that calls `fetch()` on web and `CapacitorHttp` on native
- **No breaking changes**: All response shapes remain identical; existing `.json()`, `.ok`, `.status` checks work on the `Response` object returned by the wrapper
- **Testable**: Web preview continues to work exactly as before; Android 7 gains native HTTP which bypasses CORS entirely

