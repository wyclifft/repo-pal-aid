/**
 * Native HTTP utility for Capacitor apps
 * Routes requests through CapacitorHttp on native platforms to bypass WebView CORS restrictions.
 * Falls back to regular fetch() on web/preview.
 * 
 * v2.9.3: Created to fix Android 7 (WebView 52) CORS 503 preflight failures
 */

/**
 * Check if running on a native Capacitor platform (defensive, no static import)
 */
function isNativePlatform(): boolean {
  try {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/**
 * Parse headers from RequestInit into a plain Record<string, string>
 */
function parseHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => { result[key] = value; });
    return result;
  }
  if (Array.isArray(headers)) {
    const result: Record<string, string> = {};
    headers.forEach(([key, value]) => { result[key] = value; });
    return result;
  }
  return headers as Record<string, string>;
}

/**
 * Make an HTTP request using CapacitorHttp on native platforms, fetch() on web.
 * Returns a standard Response object so all existing parsing code works unchanged.
 */
export async function nativeHttpRequest(url: string, init?: RequestInit): Promise<Response> {
  if (!isNativePlatform()) {
    // Web/preview — use regular fetch
    return fetch(url, init);
  }

  try {
    // Dynamic import to avoid crashing Android 7 with static Capacitor imports
    const { CapacitorHttp } = await import('@capacitor/core');
    const method = (init?.method || 'GET').toUpperCase();
    const headers = parseHeaders(init?.headers);

    // Parse body for POST/PUT/PATCH — CapacitorHttp expects `data` as an object
    let data: any = undefined;
    if (init?.body && typeof init.body === 'string') {
      try {
        data = JSON.parse(init.body);
      } catch {
        // If body isn't JSON, send as-is
        data = init.body;
      }
    }

    console.log(`[NativeHTTP] ${method} ${url}`);

    const response = await CapacitorHttp.request({
      url,
      method,
      headers,
      data,
    });

    // Wrap in standard Response so existing .ok, .status, .json() checks work
    const responseBody = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data);

    return new Response(responseBody, {
      status: response.status,
      headers: new Headers(response.headers || {}),
    });
  } catch (error) {
    console.error('[NativeHTTP] CapacitorHttp failed, falling back to fetch:', error);
    // Fallback to regular fetch if CapacitorHttp fails for any reason
    return fetch(url, init);
  }
}
