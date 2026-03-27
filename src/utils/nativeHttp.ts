export async function nativeHttpRequest(url: string, init?: RequestInit): Promise<Response> {
  const cap = (window as any).Capacitor;
  const isNative = cap?.isNativePlatform?.() ?? false;

  if (isNative && cap?.Plugins?.CapacitorHttp) {
    try {
      const method = (init?.method || 'GET').toUpperCase();
      const headers = (init?.headers as Record<string, string>) || {};

      // Only parse and include body data if it exists
      let bodyData: any = undefined;
      if (init?.body && typeof init.body === 'string' && init.body.length > 0) {
        try {
          bodyData = JSON.parse(init.body);
        } catch {
          bodyData = init.body;
        }
      }

      // Build request options - only include data key if we have data
      const requestOptions: any = { url, method, headers };
      if (bodyData !== undefined) {
        requestOptions.data = bodyData;
      }

      console.log('[NativeHTTP] Attempting request:', method, url);
      const response = await cap.Plugins.CapacitorHttp.request(requestOptions);
      console.log('[NativeHTTP] Success:', response.status);

      return new Response(JSON.stringify(response.data), {
        status: response.status,
        headers: new Headers(response.headers || {}),
      });
    } catch (e) {
      console.warn('[NativeHTTP] Plugin call failed, falling back to fetch:', e);
    }
  }

  return fetch(url, init);
}
