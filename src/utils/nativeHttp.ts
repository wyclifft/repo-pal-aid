export async function nativeHttpRequest(url: string, init?: RequestInit): Promise<Response> {
  const cap = (window as any).Capacitor;
  const isNative = cap?.isNativePlatform?.() ?? false;

  if (isNative && cap?.Plugins?.CapacitorHttp) {
    try {
      const method = (init?.method || 'GET').toUpperCase();
      const bodyData = init?.body ? JSON.parse(init.body as string) : undefined;

      const response = await cap.Plugins.CapacitorHttp.request({
        url,
        method,
        headers: (init?.headers as Record<string, string>) || {},
        data: bodyData,
      });

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
