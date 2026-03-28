// v2.9.4: Hardened for Android 7 WebView 52 — no dynamic imports, safe CapacitorHttp access
export async function nativeHttpRequest(url: string, init?: RequestInit): Promise<Response> {
  const cap = (window as any).Capacitor;
  const isNative = cap?.isNativePlatform?.() ?? false;

  if (isNative && cap?.Plugins?.CapacitorHttp) {
    try {
      const method = (init?.method || 'GET').toUpperCase();
      const headers = (init?.headers as Record<string, string>) || {};

      // Only parse and include body data if it exists and is non-empty
      let bodyData: any = undefined;
      if (init?.body && typeof init.body === 'string' && init.body.length > 0) {
        try {
          bodyData = JSON.parse(init.body);
        } catch {
          bodyData = init.body;
        }
      }

      // Build request options — ONLY include keys CapacitorHttp expects
      // Never pass fetch-only options (signal, mode, cache, credentials) to native plugin
      const requestOptions: any = { url, method, headers };
      if (bodyData !== undefined) {
        requestOptions.data = bodyData;
      }

      console.log('[NativeHTTP] Attempting:', method, url);
      const response = await cap.Plugins.CapacitorHttp.request(requestOptions);
      console.log('[NativeHTTP] Response status:', response.status);

      // Handle response.data — may be object or string depending on content-type
      let responseBody: string;
      if (typeof response.data === 'string') {
        responseBody = response.data;
      } else {
        responseBody = JSON.stringify(response.data);
      }

      return new Response(responseBody, {
        status: response.status,
        headers: new Headers(response.headers || {}),
      });
    } catch (e) {
      console.warn('[NativeHTTP] Plugin call failed, falling back to fetch:', e);
    }
  }

  // Web / fallback path — strip native-only options that may cause issues
  return fetch(url, init);
}
