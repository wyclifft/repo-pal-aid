

## Fix: Duplicate Member ID + Periodic Report Cross-Device Visibility — v2.10.53

Two independent fixes, both production-safe.

---

### Issue 1 — Add Member silently auto-renames duplicate IDs

**Current behavior** (`backend-api/server.js` lines 3252–3358):
- Backend relies on `ER_DUP_ENTRY` from a UNIQUE index on `cm_members.mcode`.
- On duplicate, it **auto-increments the numeric tail** ( `M00010` → `M00011` ) and silently saves under a different ID — without telling the operator.
- Worse: if there is no UNIQUE constraint on `(mcode, ccode)` in production, **two rows with the same mcode within the same ccode can coexist** with no error raised at all.

**Fix (backend-only, additive-safe):**

1. **Pre-check explicitly before insert** inside `/api/members POST`:
   ```js
   const [existing] = await pool.query(
     'SELECT mcode FROM cm_members WHERE TRIM(mcode) = TRIM(?) AND ccode = ? LIMIT 1',
     [mmcode, ccode]
   );
   if (existing.length > 0) {
     return sendJSON(res, {
       success: false,
       error: `Member ID "${mmcode}" already exists for this company. Please use a different ID.`
     }, 409);
   }
   ```
2. **Disable the silent auto-increment retry loop.** If the typed ID collides, return `409` immediately. The "next available ID" suggestion (`/api/members/next-id`) already prefills a unique value; if the operator overrides it with a duplicate, the action must fail loudly, not silently rename.
3. **Keep** the existing `ER_DUP_ENTRY` catch as a final safety net (race condition between two devices) — but it now also returns `409` immediately instead of incrementing.

**Frontend** (`src/components/AddMemberModal.tsx`): no change needed — it already toasts `result.error` on `success === false`. The new clearer 409 message will surface automatically.

**Note on DB constraint:** A separate migration to add `UNIQUE KEY uniq_member_per_company (mcode, ccode)` to `cm_members` is recommended but is out of scope for this code change (would require a DB migration the user must run). The pre-check above closes the gap at the application layer without requiring schema change.

---

### Issue 2 — Periodic Report only shows current device's transactions

**Current behavior** (`backend-api/server.js` lines 1185–1209 and 1276–1292):
- Both `/api/periodic-report` and `/api/periodic-report/farmer-detail` filter by `t.deviceserial = ?` (the requesting device's fingerprint).
- Result: a tablet cannot see transactions captured by another tablet on the same `ccode`, even though they share the same company and routes.

**Fix (backend, behavior change — see compatibility note):**

1. **Drop the `t.deviceserial = ?` filter** in both endpoints. Keep the strict `t.ccode = ?` filter (multi-tenant boundary stays intact).
2. **Add an optional `route` query parameter** to scope by the route currently selected on the requesting device:
   - Frontend passes `route` from `localStorage.active_session_data.route.tcode` (already persisted by `Dashboard.tsx`).
   - Backend appends `AND TRIM(t.route) = TRIM(?)` when `route` is present; omitted = all routes for the ccode.
3. **Apply the same change to the farmer-detail endpoint** (line ~1278) — drop `deviceserial`, add optional `route`.

**Backward compatibility:** the `uniquedevcode` parameter is **kept** and still required for **device authorization** (resolving `ccode` from `devsettings`). Only the *data filter* changes from `deviceserial=` to `ccode=` (+ optional route). Old Capacitor clients that don't send `route` get the full ccode results — strictly more data, never less, no breakage.

**Frontend** (`src/pages/PeriodicReport.tsx`):

1. Read the active route from `localStorage.active_session_data` on mount → store in `selectedRoute` state.
2. Add a small read-only display under the header: `Route: <selectedRoute.descript>` (or "All routes" if none active), so the operator knows what scope they're viewing.
3. Pass `route: selectedRoute?.tcode` to `mysqlApi.periodicReport.get(...)` and `getFarmerDetail(...)`.
4. Include `route` in the `cacheKey` so per-route caches don't collide.

**Frontend service** (`src/services/mysqlApi.ts`):
- Extend `periodicReportApi.get(...)` and `getFarmerDetail(...)` signatures with an optional `route?: string` query param.

---

### Files Changed

| File | Change |
|---|---|
| `backend-api/server.js` | (1) `/api/members POST`: add explicit pre-check for `(mcode, ccode)` collision → 409; remove silent auto-increment retry, keep `ER_DUP_ENTRY` as race-safety returning 409. (2) `/api/periodic-report` + `/api/periodic-report/farmer-detail`: drop `t.deviceserial =` filter, add optional `route` query param. |
| `src/services/mysqlApi.ts` | Add optional `route?: string` param to `periodicReportApi.get` and `getFarmerDetail`. |
| `src/pages/PeriodicReport.tsx` | Read active route from `localStorage.active_session_data`; pass to API; show "Route: <descript>" badge; include in cache key. |
| `src/constants/appVersion.ts` | Bump to **v2.10.53 (Code 75)** with a changelog comment. |

---

### What Does NOT Change

- Z-Reports — remain strictly device-isolated per [Report Isolation Rules](mem://constraints/report-isolation-rules) memory.
- Multi-tenant `ccode` JWT/device authorization boundary — unchanged.
- IndexedDB schema, sync engines, reference generators, photo system — unchanged.
- v2.10.51 coffee SCODE logic — unchanged.
- v2.10.52 Debtors prefix logic — unchanged.
- `AddMemberModal.tsx` UI — unchanged (existing error toast surfaces the new 409 message).
- `/api/members/next-id` — unchanged (still suggests next sequential available ID).

---

### Verification After Deploy

**Issue 1:**
1. Dashboard → Add Member → create `M00500` → succeeds.
2. Add Member again → manually type `M00500` → toast: `Member ID "M00500" already exists for this company. Please use a different ID.` Form stays open, no row inserted.
3. Add Member with cleared field → suggested next ID is `M00501` → succeeds.

**Issue 2:**
1. Device A captures milk collection on Route `R01` for member `M00100`.
2. Device B (same ccode) opens Periodic Report → date range covering today → sees Device A's `M00100` row.
3. Device B selects a different route on Dashboard → reopens Periodic Report → sees badge "Route: <other route>" and `M00100` is filtered out.
4. Device B switches back to `R01` on Dashboard → reopens Periodic Report → `M00100` reappears.
5. Open `View & Print` on that farmer → individual transaction list now shows entries from both Device A and Device B for that route.
6. Confirm Z-Report on Device B still shows ONLY Device B's transactions (isolation preserved).

---

### Out of Scope

- Adding `UNIQUE KEY (mcode, ccode)` to `cm_members` (separate DB migration; the application-level pre-check is sufficient for this fix).
- Multi-route selector in Periodic Report (uses dashboard active route only — matches existing UX).
- Backfill of any historical duplicate `cm_members` rows.

