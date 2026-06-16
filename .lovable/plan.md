## Diagnosis

`backend-api/server.js` line 4193:

```js
server.setTimeout(REQUEST_TIMEOUT_MS, (socket) => {
  console.warn(`[TIMEOUT] socket idle > ${REQUEST_TIMEOUT_MS}ms — destroying`);
  socket.destroy();
});
```

`http.Server.setTimeout` is a **socket-level idle** timeout, not a per-request one. Every HTTP keep-alive connection from the Capacitor app (which holds connections open between API calls by design) trips this 30 s timer when the user pauses, and stderr gets a `[TIMEOUT] socket idle …` line each time. The socket destruction is correct behaviour (Node would otherwise keep idle sockets open longer). The **log is the problem**, not the action.

Side note: this handler does **not** protect the MySQL pool the way the v2.10.108 comment claims — pool protection comes from the per-request body timeout elsewhere. So we can clean both up.

## Plan

### 1. Backend — silence the false-alarm log and clarify the comment

In `backend-api/server.js` (the very end, around lines 4190–4199):

- Drop the `console.warn(...)` line. Still call `socket.destroy()` so idle keep-alive sockets are still reclaimed.
- Replace the misleading "prevents requests from holding a pool slot" comment with the accurate description: this is the **HTTP keep-alive idle reaper**, fires when a socket sits idle (no request in flight) for `REQUEST_TIMEOUT_MS` ms, and is safe/silent because the client will simply reopen on its next request.
- Behaviour unchanged for in-flight requests — the existing request body / handler timeouts are untouched.

Nothing else in `server.js` changes. No endpoint shapes change. No pool changes. No frontend changes. No SW/version bump needed (server-only stderr cleanup with no behavioural impact on the deployed app).

### 2. Version

This is a backend-only log-noise fix. We will bump only the backend changelog comment in `server.js`. App `APP_VERSION` and `versionCode` stay at **2.10.119** (last shipped today) — no client behaviour change, so a client bump would only churn the SW cache for nothing.

### 3. Verification

After restart:
- stderr should stop accumulating `[TIMEOUT] socket idle …` lines.
- App requests continue working unchanged.
- The actual W3 cumulative under-count fix (v2.10.119) is unaffected.

## Out of scope

- Per-request timeouts, MySQL pool tuning, request body timeouts — all left as-is.
- Frontend, IndexedDB, sync engine, reference generator, receipt, photo, Bluetooth, auth — untouched.
