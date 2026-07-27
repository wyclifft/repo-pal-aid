/**
 * Utility to provide a compatible AbortSignal for timeouts,
 * supporting legacy WebViews (pre-Chrome 103) where AbortSignal.timeout is missing.
 */

/**
 * Returns an AbortSignal that aborts after a specified timeout.
 * Falls back to AbortController if AbortSignal.timeout is not available.
 */
export function getTimeoutSignal(ms: number): AbortSignal | undefined {
  // 1. Try modern AbortSignal.timeout (Chrome 103+)
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    try {
      // @ts-ignore - AbortSignal.timeout might not be in all TS definitions
      return AbortSignal.timeout(ms);
    } catch (e) {
      console.warn('[abortUtils] AbortSignal.timeout failed, falling back:', e);
    }
  }

  // 2. Fallback to AbortController (Chrome 66+)
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    setTimeout(() => {
      try {
        controller.abort();
      } catch (e) {
        // Ignore if already aborted or other issues
      }
    }, ms);
    return controller.signal;
  }

  // 3. Last resort: Return undefined for environments with NO Abort support (very old)
  // fetch() will just ignore undefined signal.
  console.warn('[abortUtils] No AbortController support in this environment.');
  return undefined;
}
