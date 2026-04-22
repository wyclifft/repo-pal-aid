

## Add Member Type Selector (M = Member, D = Debtor) — v2.10.58

### Problem

The "Add New Member" modal auto-suggests the next ID by reading the **most recently inserted** member's prefix. So if the operator just added a `D00012` (Debtor), the next suggestion will be `D00013` even when they now want to add a Member (`M…`). The operator has no way to tell the system which type they want.

Backend `/api/members/next-id` picks `prefix` from `rows[0]` (latest by `id DESC`) — see `backend-api/server.js` lines 3318–3354. There is no prefix filter.

### Fix — let the operator choose Member or Debtor

#### 1. `backend-api/server.js` — additive `prefix` query param (production-safe)

Extend `GET /api/members/next-id` to accept an **optional** `?prefix=M` or `?prefix=D` (case-insensitive, single letter). Behavior:

- If `prefix` is provided and valid (`M` or `D`):
  - Compute `MAX(numericTail)` across the recent batch **filtered to that prefix only**.
  - Use that prefix for the suggestion.
  - If no existing rows match the requested prefix, start at `1` with default `padLength = 5` (or inherit padding from the latest same-prefix row if any).
- If `prefix` is **omitted**: behave **exactly** as today (full backward compatibility for v2.10.32–v2.10.57 clients).
- Also widen the recent-batch query slightly so we don't miss the latest same-prefix row when many opposite-prefix rows were inserted recently:
  - Change `LIMIT 50` → `LIMIT 200` (safe, indexed read on `ccode`, single-row result, negligible cost).
  - Or better: when `prefix` is provided, run a tiny targeted query:
    ```sql
    SELECT mcode FROM cm_members
    WHERE ccode = ? AND mcode LIKE CONCAT(?, '%')
    ORDER BY id DESC LIMIT 200
    ```
- Validate input: ignore anything that isn't `[A-Za-z]{1}`; uppercase before use; only `M` and `D` are accepted to match app domain (others fall through to legacy behavior).
- Response shape unchanged: `{ success, data: { suggested, prefix, padLength } }`.

This is purely additive — older builds that don't send `prefix` keep working unchanged.

#### 2. `src/services/mysqlApi.ts` — pass optional prefix

Update `members.getNextId` signature to accept an optional `prefix?: 'M' | 'D'` and append `&prefix=…` to the query string when provided. No header changes (still preflight-free).

#### 3. `src/components/AddMemberModal.tsx` — Member-Type selector

Add a **Member Type** toggle at the top of the form (above the Member ID field):

```
Member Type: ( • Member [M] )  ( ○ Debtor [D] )
```

UI: a `ToggleGroup` (or two segmented buttons) with two options:
- **Member** → prefix `M` (default on open)
- **Debtor** → prefix `D`

Behavior:
- New state: `memberType: 'M' | 'D'` (default `'M'`).
- On modal open, default to `'M'` and call `fetchAndApplyNextId('M')`.
- When the operator switches the toggle, immediately call `fetchAndApplyNextId(newType)` to refresh the suggested `mmcode`.
- After a successful submit, **preserve the operator's last-chosen `memberType`** (sticky for rapid sequential entry of the same type) and call `fetchAndApplyNextId(memberType)` to fill the next ID of the same type.
- Helper text under the field reads: *"Auto-suggested next {Member|Debtor} ID — you can edit if needed."*

Validation:
- Keep `mmcode` editable, but if the typed prefix doesn't match the selected `memberType`, show an inline hint (no hard block) — e.g., *"Heads-up: ID starts with D but type is Member."* This avoids regressing operators who manually type the full code.

Accessibility:
- The toggle group has an `aria-label="Member type"`; `DialogDescription` already present.

#### 4. Version bump (per workspace rule)

- `src/constants/appVersion.ts` → `v2.10.58` (Code 80).
- `android/app/build.gradle` → `versionName "2.10.58"`, `versionCode 80`.
- Comment: *"v2.10.58 — Add Member modal: explicit M/D type selector; backend next-id accepts optional prefix."*

### Backward Compatibility

| Client | Backend behavior |
|---|---|
| v2.10.32–v2.10.57 (no `prefix` param) | Unchanged — falls back to "latest record's prefix" exactly as today |
| v2.10.58 (sends `prefix=M` or `prefix=D`) | Returns next ID for that specific prefix |

No DB schema changes. No migrations. No changes to `/api/members` POST. No changes to `cm_members` columns. No effect on transactions, sync, receipts, cumulative, or photos.

### Files Touched

| File | Change |
|---|---|
| `backend-api/server.js` | `/api/members/next-id` accepts optional `?prefix=M\|D`; targeted query when provided; legacy behavior preserved otherwise |
| `src/services/mysqlApi.ts` | `members.getNextId(fp, prefix?)` appends `&prefix=` when set |
| `src/components/AddMemberModal.tsx` | Add `memberType` state + toggle UI; refetch suggestion on toggle change and after submit; updated helper text |
| `src/constants/appVersion.ts` | Bump to v2.10.58 (Code 80) |
| `android/app/build.gradle` | Bump `versionName`/`versionCode` to 2.10.58 / 80 |

### Verification Checklist

1. Open Add Member with no recent activity → defaults to Member, suggests next `M…`.
2. Switch toggle to Debtor → field refreshes to next `D…` instantly.
3. Add a `D00012` → modal stays open, type stays "Debtor", next suggestion is `D00013`.
4. Switch back to Member after adding several Debtors → suggestion correctly returns to next `M…` (not `D…`). ✓ root-cause fix.
5. Old v2.10.32 / v2.10.57 phones still hit `/api/members/next-id` without `prefix` and get the legacy behavior — no regression.
6. Manually typing a full ID still works; mismatch shows a soft hint, not a block.
7. No new console errors; transactions, sync, receipts, photo audit all unchanged.

### Out of Scope

- Changing the POST `/api/members` validation (still hard-fails on duplicate `(mcode, ccode)`).
- Migrating existing mis-prefixed members.
- Adding more prefixes beyond `M` and `D`.

