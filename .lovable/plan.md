

## Restore `.htaccess` Files to Match Live Production — v2.10.44

### Goal
Sync the repo's `.htaccess` files to match the actual working production configuration on the cPanel/CloudLinux server, so future redeploys do not break the backend.

### Root Cause Recap
The repo's `.htaccess` files were authored against legacy `alt-nodejs14` and the wrong MySQL user (`maddasys_tesh`). The live server actually runs on CloudLinux Passenger with Node.js 19 and DB user `maddasys_wycliff`. Each redeploy overwrites the working server config → MySQL auth fails → Passenger 503 → login blocked.

### Files Changed

| File | Change |
|------|--------|
| `sync-service/.htaccess` | Replace entirely with the user-confirmed working content (CloudLinux Passenger block + `maddasys_wycliff` + Node 19 nodevenv + LiteSpeed env block) |
| `backend-api/.htaccess` | Apply equivalent CloudLinux Passenger structure for the main backend app: AppRoot `/home/maddasys/public_html/api/milk-collection-api`, port 3000, DB user `maddasys_wycliff`, Node.js managed by nodevenv. Keep the existing CORS allow-headers list (which already includes `X-Device-Fingerprint, X-App-Origin` from v2.10.42) |
| `src/constants/appVersion.ts` | Bump to **v2.10.44 (Code 66)** to mark the deployment-config fix |

### Backend Code Safety
- **`backend-api/server.js`** is **not modified**. v2.10.43 already added the `GET /api/members/next-id` endpoint and the auto-retry loop in `POST /api/members`. Once the corrected `.htaccess` is redeployed and Passenger restarts cleanly, those features go live with no further code changes.

### Backward Compatibility
- Production Capacitor clients (v2.10.40–v2.10.43) continue working — only server-side ops config changes.
- No frontend logic, no DB schema, no API contract changes.
- CORS surface is unchanged from v2.10.42 (still allows `X-Device-Fingerprint, X-App-Origin` on the main backend).

### Critical Note for User (Manual cPanel Action Still Required)
Even after this commit, the live server's `.htaccess` files are already the correct working version (you just verified). **You do NOT need to re-upload these `.htaccess` files** unless a future Lovable change touches them. The repo fix is purely defensive — so the next time someone redeploys from this repo, it does not clobber the live config.

After this commit, the only remaining server-side action is:
1. **Restart the main backend Node.js app** in cPanel (`/api/milk-collection-api`) so the v2.10.43 `server.js` (already uploaded) starts fresh and serves the new endpoints.
2. Verify: `curl https://backend.maddasystems.co.ke/api/health` returns JSON.

### Detail: Sensitive Credentials
The working `.htaccess` you pasted contains the live MySQL password in plain text (`SetEnv MYSQL_PASSWORD 0741899183Mutee`). This matches the existing repo files (project history already has this convention). **No new exposure** is created by this change. Long-term recommendation: move secrets out of `.htaccess` into a server-only `.env` file outside the document root — but that is **out of scope** for this fix to keep the change minimal and production-safe.

### Out of Scope
- Removing hardcoded DB password from `.htaccess` (separate hardening task).
- Changing the CloudLinux/Passenger node version.
- Any application code changes — `server.js` is untouched.

