/**
 * Resilient HTTP request utility.
 *
 * Background:
 * - In the Lovable preview iframe (and on some legacy WebViews / proxies),
 *   `window.fetch` is wrapped by external scripts (e.g. lovable.js) and can
 *   silently throw `TypeError: Failed to fetch` for POST requests even when
 *   the backend is healthy and responding to GETs.
 * - Capacitor native builds also occasionally hit CORS/preflight failures on
 *   Android 7 (WebView 51/52).
 *
 * Strategy:
 *   1. Try `window.fetch` first (fast, supports streaming, modern features).
 *   2. If `fetch` throws a network-level error (TypeError / AbortError isn't
 *      retried — that's a real timeout), fall back to a raw XMLHttpRequest
 *      that bypasses the wrapped fetch entirely.
 *
 * The fallback is only used for non-GET requests (POST / PUT / PATCH /
 * DELETE) — those are the verbs that exhibit the wrapper failure. GETs
 * already work reliably through `window.fetch`.
 *
 * v2.10.64 — added to fix login "Failed to fetch" in Lovable preview.
 */

interface XhrFetchOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  signal?: AbortSignal;
}

/**
 * XHR-based fetch fallback. Returns a Response-compatible object so callers
 * can keep using `await response.json()` / `response.headers.get(...)`.
 */
function xhrFetch(url: string, opts: XhrFetchOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method, url, true);
    xhr.responseType = 'text';

    // Apply headers
    if (opts.headers) {
      for (const [k, v] of Object.entries(opts.headers)) {
        try { xhr.setRequestHeader(k, v); } catch { /* ignore forbidden headers */ }
      }
    }

    // Honor abort signal
    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      opts.signal.addEventListener('abort', () => {
        try { xhr.abort(); } catch { /* ignore */ }
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }

    xhr.onload = () => {
      // Build a Headers object from the raw response headers
      const headers = new Headers();
      const rawHeaders = xhr.getAllResponseHeaders();
      if (rawHeaders) {
        rawHeaders.trim().split(/[\r\n]+/).forEach(line => {
          const idx = line.indexOf(':');
          if (idx > 0) {
            const name = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            try { headers.append(name, value); } catch { /* ignore invalid */ }
          }
        });
      }
      // If server didn't set content-type, sniff from body
      if (!headers.get('content-type') && xhr.responseText.trim().startsWith('{')) {
        headers.set('content-type', 'application/json');
      }

      const response = new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers,
      });
      resolve(response);
    };

    xhr.onerror = () => reject(new TypeError('Network request failed (xhr)'));
    xhr.ontimeout = () => reject(new DOMException('Timeout', 'AbortError'));

    xhr.send(opts.body ?? null);
  });
}

/**
 * Resilient fetch: tries window.fetch first, falls back to XHR for non-GET
 * requests if fetch throws a TypeError ("Failed to fetch").
 */
export async function resilientFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();

  try {
    return await fetch(url, init);
  } catch (err) {
    // Only fall back for network-level errors on non-GET requests.
    const isNetworkError = err instanceof TypeError;
    const shouldFallback = isNetworkError && method !== 'GET';

    if (!shouldFallback) {
      throw err;
    }

    console.warn(`[resilientFetch] window.fetch failed for ${method} ${url} — falling back to XHR`);

    const headers: Record<string, string> = {};
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) headers[k] = v;
      } else {
        Object.assign(headers, init.headers as Record<string, string>);
      }
    }

    const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : null;

    return xhrFetch(url, {
      method,
      headers,
      body,
      signal: init.signal ?? undefined,
    });
  }
}
