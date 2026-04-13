

## cPanel MYSQL_PASSWORD Setup + 20 New Bugs — v2.10.38

### How to Set MYSQL_PASSWORD on cPanel

Since the password was removed from `.htaccess` for security, you need to set it as a server-level environment variable:

**Option A: Via cPanel Node.js App Interface (Recommended)**
1. Log in to cPanel
2. Go to **Setup Node.js App**
3. Find your milk-collection-api application
4. Click **Edit** (pencil icon)
5. Scroll to **Environment variables** section
6. Click **Add Variable**
7. Set Name: `MYSQL_PASSWORD` and Value: `your_password_here`
8. Click **Save** then **Restart** the application

**Option B: Via .htaccess (without hardcoding)**
If your cPanel does not have the Environment variables UI, add this line to `.htaccess`:
```
SetEnv MYSQL_PASSWORD your_password_here
```
But keep `.htaccess` out of version control by adding `backend-api/.htaccess` to `.gitignore`.

**Option C: Via SSH**
```bash
export MYSQL_PASSWORD="your_password_here"
```
Add to `~/.bashrc` or the Node.js app startup script.

**Note:** The `server.js` still has a fallback `password: process.env.MYSQL_PASSWORD || '0741899183Mutee'` on line 14. For full security, remove that fallback once the env var is confirmed working.

---

### 20 New Bugs Found

| # | Severity | File | Issue |
|---|----------|------|-------|
| 11 | **Critical** | server.js:14 | Hardcoded password fallback still in `server.js` pool config |
| 12 | **Critical** | server.js:3020 | Plain-text password comparison in login — passwords stored and compared as plain text in MySQL |
| 13 | **High** | server.js:1112-1115 | DELETE `/api/milk-collection/:ref` has no ccode filter — any device can delete any company's records |
| 14 | **High** | server.js:1829 | Stock balance update `WHERE icode = ?` has no `ccode` filter — deducts stock across ALL companies sharing same item code |
| 15 | **High** | server.js:1907 | Batch sales use `now.toISOString().split('T')[0]` for transdate which shifts dates in timezones ahead of UTC (unlike milk collection which uses local date) |
| 16 | **Medium** | server.js:2636-2654 | SMS endpoint variable shadowing: inner `req` (https.request) shadows outer `req` (HTTP request) — could cause unexpected behavior |
| 17 | **Medium** | server.js:1097 | PUT `/api/milk-collection/:ref` uses `toISOString()` for date conversion — can shift date by one day in UTC+ timezones (inconsistent with POST which uses local date) |
| 18 | **Medium** | useDataSync.ts:808 | `syncAllData` not in dependency array of initial mount effect — stale closure risk if `syncAllData` changes before effect runs |
| 19 | **Medium** | useScaleConnection.ts:275 | `isWaitingForStable` in `connectBLE` dependency array causes re-creation of `connectBLE` callback every time stable state changes, causing potential re-render cascades |
| 20 | **High** | server.js:405-408 | DELETE `/api/farmers/:id` has no ccode filter — any request can delete farmers from any company |
| 21 | **High** | server.js:383-389 | POST `/api/farmers` has no ccode field — creates farmer without company association |
| 22 | **Medium** | Login.tsx:234 | Legacy plain-text password comparison `cachedCreds.password === password` bypasses hashing — attacker who knows the hash could still login with the raw password |
| 23 | **High** | server.js:2059 | Batch sale stock update `WHERE icode = ?` missing `AND ccode = ?` — same cross-company stock deduction bug as single sale |
| 24 | **Medium** | Index.tsx:864 | `orderId: Date.now()` for capture records can collide when rapid captures happen within same millisecond (no random suffix like `saveReceipt` uses) |
| 25 | **Medium** | useIndexedDB.ts:466 | `getUnsyncedSales` only filters for `type === 'sale'` but not `type === 'ai'` — AI sales are never counted as pending in the sales sync path |
| 26 | **Low** | server.js:3177 | Photo audit `adjustedTotal` calculation is wrong — subtracts missing files from current page's count, not from total, causing incorrect pagination |
| 27 | **Medium** | server.js:1647-1648 | Sales endpoint uses `toISOString()` for transdate — timezone shift issue (same as bugs 15/17), coffee/dairy transactions can appear on wrong date |
| 28 | **High** | useDataSync.ts:456-458 | `syncOfflineReceipts` callback dependencies don't include `mountedRef` or `inFlightSyncsRef`, and missing `saveReceipt` — if the component re-renders with new `deleteReceipt`, stale closure uses old DB handle |
| 29 | **Medium** | DEPLOYMENT_GUIDE.md | Database password `0741899183Mutee` hardcoded in the troubleshooting section of the deployment guide — second credential leak vector |
| 30 | **Low** | server.js:1793 | Sales INSERT has 29 `?` placeholders but the VALUES clause template shows 29 `?` — fragile, any column addition/removal breaks silently |

---

### Recommended Fix Priority

**Security (fix immediately):**
1. Bug 12 — Server stores/compares passwords as plain text in MySQL
2. Bug 11 — Remove hardcoded password fallback from `server.js`
3. Bug 29 — Remove password from DEPLOYMENT_GUIDE.md
4. Bug 13 — DELETE milk-collection missing ccode filter
5. Bug 20 — DELETE farmers missing ccode filter
6. Bug 21 — POST farmers missing ccode

**Data Integrity (fix next):**
7. Bugs 14+23 — Stock deduction missing ccode filter (cross-company)
8. Bugs 15+17+27 — Timezone date shift issues in sales/updates
9. Bug 25 — AI sales not counted in pending sales
10. Bug 24 — orderId collision on rapid captures

**Code Quality (fix when convenient):**
11. Bugs 16, 18, 19, 22, 26, 28, 30

### Files to Modify
- `backend-api/server.js` — Bugs 11-17, 20-21, 23, 26-27, 30
- `backend-api/DEPLOYMENT_GUIDE.md` — Bug 29
- `src/components/Login.tsx` — Bug 22
- `src/pages/Index.tsx` — Bug 24
- `src/hooks/useIndexedDB.ts` — Bug 25
- `src/hooks/useDataSync.ts` — Bugs 18, 28
- `src/hooks/useScaleConnection.ts` — Bug 19
- `src/constants/appVersion.ts` — Bump to v2.10.38 (Code 60)

