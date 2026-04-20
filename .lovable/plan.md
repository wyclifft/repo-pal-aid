

## Fix: Use Correct Column Name `mcode` + Restore Working `.htaccess` — v2.10.45

### Root Causes

**1. Wrong DB column name (`mmcode` → `mcode`)**
The v2.10.43 backend code used `mmcode` in SQL for both new endpoints, but the actual `cm_members` table column is `mcode`. This causes:
- `GET /api/members/next-id` → 500 `Unknown column 'mmcode' in 'SELECT'`
- `POST /api/members` → 500 `Unknown column 'mmcode' in 'INSERT INTO'`

The frontend field/state name `mmcode` is fine — it's only a client-side variable. We map it to `mcode` at the SQL boundary.

**2. `.htaccess` regression broke login**
The v2.10.44 commit to `backend-api/.htaccess` does not match the user's confirmed-working `.htaccess` (which uses CloudLinux Passenger + nodevenv Node 19 + DB user `maddasys_wycliff`). When deployed, Apache returns 503 for everything (login, sessions, farmers, items, z-report, periodic-report — all visible in current console logs).

---

### Part A — Fix Column Name in `backend-api/server.js`

In the new `GET /api/members/next-id` endpoint and the `POST /api/members` endpoint:
- Replace every SQL reference to `mmcode` with `mcode` (SELECT list, ORDER BY, WHERE, INSERT column list).
- Keep the JSON response key as `suggested` and continue accepting the request body field `mmcode` from the client (no client change needed).
- Map `body.mmcode` → SQL column `mcode` inside the INSERT and the duplicate-retry parsing logic.
- Keep the `ER_DUP_ENTRY` auto-retry loop (max 5) using the corrected column.

No other endpoints touched. No schema changes. No frontend changes required.

---

### Part B — Restore `backend-api/.htaccess` to Match Production

Replace `backend-api/.htaccess` content with the exact CloudLinux/Passenger structure the user confirmed works on `2backend.maddasystems.co.ke`, adapted for the main backend app:

- CloudLinux Passenger header block: `PassengerAppRoot "/home/maddasys/public_html/api/milk-collection-api"`, `PassengerNodejs "/home/maddasys/nodevenv/public_html/api/milk-collection-api/19/bin/node"`, `PassengerStartupFile server.js`.
- `SetEnv MYSQL_USER maddasys_wycliff` (not `maddasys_tesh`).
- `SetEnv PORT 3000` (main backend port; sync-service uses 3001).
- Keep CORS allow-headers list including `X-Device-Fingerprint, X-App-Origin` (needed by current frontend; harmless if unused).
- Keep `<IfModule Litespeed>` env block with `maddasys_wycliff`.
- Keep `<FilesMatch>` deny block, `Options -Indexes`, `ServerSignature Off`.

`sync-service/.htaccess` is already correct from v2.10.44 — no change needed there.

---

### Part C — Version Bump

`src/constants/appVersion.ts` → **v2.10.45 (Code 67)**.

---

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` | Replace `mmcode` with `mcode` in `/api/members/next-id` (SELECT/ORDER BY) and `/api/members` (INSERT column + duplicate-retry parser). No other changes. |
| `backend-api/.htaccess` | Replace with CloudLinux Passenger + nodevenv Node 19 + `maddasys_wycliff` + port 3000 + correct CORS allow-headers (incl. `X-Device-Fingerprint, X-App-Origin`) + LiteSpeed env block. |
| `src/constants/appVersion.ts` | Bump to **v2.10.45 (Code 67)**. |

### Backward Compatibility
- No DB schema change.
- No frontend API contract change — client still sends `mmcode` in the JSON body; server maps it to the `mcode` column internally.
- All existing endpoints unaffected.
- Production Capacitor clients (v2.10.40–v2.10.44) continue working unchanged.

### Required Server-Side Action After Deploy
1. Upload corrected `backend-api/server.js` and `backend-api/.htaccess` to `/home/maddasys/public_html/api/milk-collection-api/`.
2. In cPanel → Setup Node.js App → restart the app.
3. Verify: `curl https://backend.maddasystems.co.ke/api/health` returns JSON.
4. Smoke-test: `curl "https://backend.maddasystems.co.ke/api/members/next-id?device_fingerprint=<FP>"` returns `{success:true,data:{suggested:"M00xxx",...}}`.

### Out of Scope
- Renaming the frontend variable `mmcode` to `mcode` (cosmetic; keeping client unchanged minimizes risk).
- Schema changes to `cm_members`.
- Removing the hardcoded DB password from `.htaccess` (separate hardening task).

