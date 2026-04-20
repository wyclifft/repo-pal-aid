

## Add Members Feature + Replace `currqty` Cumulative Gating with `psettings.cumulative_frequency_status` — v2.10.40

### Overview

Two coordinated changes:
1. **New feature**: a permission-gated "Add Member" form that inserts directly into `cm_members`, with the device's `ccode` auto-applied and `status=1` defaulted.
2. **Cumulative logic refactor**: stop filtering qualifying members by `cm_members.currqty`. Use `psettings.cumulative_frequency_status` as the single switch — when ON, **all** members under the same `ccode` qualify automatically (including newly added ones).

---

### Part A — Add Member Feature (Permission-Gated)

#### 1. Backend (`backend-api/server.js`) — additive only

**a) Login response: expose `add_members`**
In `/api/auth/login` (~line 3090–3103), add `add_members` to the returned user payload:
```js
add_members: toBool(user.add_members)
```
Old clients ignore the extra field — backward-safe.

**b) New endpoint: `POST /api/members`** (placed near the existing `/api/farmers POST`, but separate to avoid disturbing the legacy route)
- Resolve `ccode` from the device fingerprint (header `X-Device-Fingerprint` or body `device_fingerprint`) via `devsettings` — never trust client-supplied `ccode`.
- Verify the submitting user has `add_members = 1` (lookup via `body.user_id` against the `user` table). Reject with `403` if not.
- Required fields: `gender`, `descript`, `mmcode`, `idno`, `route`. Validate non-empty + length caps.
- Insert with hardcoded server-side defaults:
  ```sql
  INSERT INTO cm_members 
    (mcode, descript, gender, mmcode, idno, route, ccode, status, multOpt, currqty)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0)
  ```
  - `mcode` = `mmcode` (or generated if your schema needs separate handling — confirm in QA).
  - `status` = `1` (always).
  - `multOpt` = from request toggle (`0` or `1`, default `1`).
  - `currqty` = `0` (legacy column kept untouched; no longer used for gating).
- Return `{ success: true, data: { farmer_id, name, route, ccode, multOpt } }` so the client can immediately upsert into IndexedDB.
- Duplicate handling: catch MySQL `ER_DUP_ENTRY` on `mcode`/`mmcode` → `409` with friendly message.

**No existing endpoint is modified** — Capacitor production clients are unaffected.

#### 2. Frontend types

- `src/lib/supabase.ts` — extend `AppUser`:
  ```ts
  add_members?: boolean;
  ```
- `src/services/mysqlApi.ts` — add `membersApi.create({ gender, descript, mmcode, idno, route, multOpt })` calling `POST /api/members` with `device_fingerprint` and `user_id`. Keep existing `farmersApi` untouched.

#### 3. UI — `src/components/AddMemberModal.tsx` (new)

- Dialog with `DialogDescription` (accessibility rule).
- Fields: Member ID (`mmcode`), Full Name (`descript`), Gender (Select: M/F/Other), ID Number (`idno`), Route (Select — populated from cached `routes` IndexedDB store, filtered by device `ccode`).
- `multOpt` toggle (Switch) — labelled "Allow multiple deliveries per session".
- Read-only badge showing the auto-applied `ccode` from `localStorage.device_ccode`.
- Zod validation client-side: trim, non-empty, max length, ID number numeric.
- On submit: call `membersApi.create(...)`. On success, toast, close modal, dispatch `membersUpdated` event so `FarmerSyncDashboard`/cumulative caches refresh.

#### 4. Dashboard menu integration — `src/components/Dashboard.tsx`

- Read `currentUser.add_members` from `useAuth()`.
- In the kebab menu (~line 332), conditionally render an **"Add Member"** entry above "Recent Receipts" — **only when `add_members === true`**.
- Clicking opens `AddMemberModal`.
- Disabled / hidden completely when offline (member creation requires online write to `cm_members`); show toast "Add Member requires an internet connection" if user attempts offline.

---

### Part B — Replace `currqty` Cumulative Gating with `psettings.cumulative_frequency_status`

The setting `cumulative_frequency_status` already exists in `psettings` and is already returned by `/api/devices/fingerprint/:fingerprint` (server.js line 2340, 2358). Frontend already stores it in `AppSettings.cumulative_frequency_status`. Today the cumulative pre-fetch code filters by `Number(f.currqty) === 1` in 3 spots — we replace that filter with a single setting check.

#### 1. Frontend changes

**`src/pages/Index.tsx`** (~lines 247–248 and 372–373):
- Replace `.filter(f => Number(f.currqty) === 1)` with a check against `settings.cumulative_frequency_status`:
  ```ts
  const cumulativeEnabled = (settings.cumulative_frequency_status === 1) || (settings.printcumm === 1);
  const qualifying = cumulativeEnabled
    ? (deviceCcode ? response.data.filter(f => f.ccode === deviceCcode) : response.data)
    : []; // when disabled, no farmers qualify for cumulative pre-fetch
  ```
- Same change for the pre-fetch block at line 372.

**`src/components/FarmerSyncDashboard.tsx`** (~lines 147–149):
- Replace `Number(f.currqty) === 1` with `cumulativeEnabled` (read once from `useAppSettings()`).
- When the company-wide setting is ON, every member of that `ccode` is treated as active for cumulative sync — no per-member opt-in.

**`src/lib/supabase.ts` / `src/services/mysqlApi.ts`**:
- Keep `currqty` field in interfaces (do not delete) — backend still returns it, removing it would break the typed shape and existing IndexedDB cached records. It's just no longer **read** for gating decisions.

#### 2. Backend changes

- **No changes to `/api/farmers/by-device`** — it keeps returning `currqty` for backward compatibility with already-installed Capacitor builds.
- The new gating logic is purely client-side, driven by `psettings.cumulative_frequency_status` already shipped in the device-info payload.

#### 3. Newly added members
Because the gating no longer needs `currqty=1`, any member created via the new "Add Member" flow is **immediately included** in cumulative sync for that `ccode` once `cumulative_frequency_status=1` — no manual activation needed. This satisfies the "Expected Behavior" requirement.

---

### Backward Compatibility (Production Safety)

- **No existing endpoint is modified.** New `POST /api/members` is purely additive.
- **No DB schema changes** — `cm_members` already has `gender`, `descript`, `mmcode`, `idno`, `route`, `ccode`, `status`, `multOpt`, `currqty`. The `user.add_members` column is assumed to already exist (standard in MADDA user schema). If absent, a one-line `ALTER TABLE user ADD COLUMN add_members TINYINT(1) DEFAULT 0` will be required — flagged in QA notes.
- **`currqty` still selected & cached** — existing Capacitor builds continue to read it; only this version's gating logic ignores it.
- **Old members with `currqty=0`**: now correctly included in cumulatives when company has `cumulative_frequency_status=1` — this is the desired fix.
- **Companies with `cumulative_frequency_status=0`**: cumulative pre-fetch is skipped entirely (matches "no cumulative" intent). Receipt rendering of cumulative still gated by `printcumm` as today.

---

### Version

`src/constants/appVersion.ts` → **v2.10.40 (Code 62)**.

---

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` | Add `add_members` to `/api/auth/login` response; new `POST /api/members` endpoint with permission + ccode resolution |
| `src/lib/supabase.ts` | Add `add_members?: boolean` to `AppUser` |
| `src/services/mysqlApi.ts` | Add `membersApi.create(...)` |
| `src/components/AddMemberModal.tsx` | **NEW** — gated Add Member dialog with Zod validation |
| `src/components/Dashboard.tsx` | Conditional "Add Member" menu item (only when `add_members=true` and online) |
| `src/pages/Index.tsx` | Replace `currqty===1` filter with `cumulative_frequency_status` check (2 spots) |
| `src/components/FarmerSyncDashboard.tsx` | Same replacement in offline cache loader |
| `src/constants/appVersion.ts` | Bump to v2.10.40 (Code 62) |

### Out of Scope

- Editing/deleting existing members from the app (only "add" requested).
- Migrating historical `currqty` values (not needed — column simply ignored).
- Adding `add_members` UI to the Settings page (kept on Dashboard menu only, per the "hide for non-authorized users" requirement).

