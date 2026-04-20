

## Fix: New Debtor (D-prefix) Doesn't Appear Under "Debtors" Toggle in Store/AI — v2.10.52

### Root Cause

Two independent bugs in `src/pages/Store.tsx` and `src/pages/AIPage.tsx`:

**Bug 1 — Debtors filter wrongly requires a non-empty `crbal`**

Both pages filter the Debtors list with:
```ts
// Store.tsx line 686-694, AIPage.tsx line 527-534
const matchesPrefix = f.farmer_id.toUpperCase().startsWith(prefix);
if (!isMemberMode) {
  const hasCrbal = f.crbal && typeof f.crbal === 'string' && f.crbal.trim() !== '' && f.crbal !== '0';
  return matchesPrefix && hasCrbal;   // ❌ hides new debtors with no credit yet
}
```

A newly created debtor like `D03558` has no credit balance until a sale is made, so `crbal` is empty/null and the row is excluded from the Debtors search modal — even though it has the correct `D` prefix.

**Bug 2 — Resolver doesn't validate prefix, so the typed ID "leaks" into Members mode**

`resolveFarmerId` in both pages only does an exact-match (case-insensitive) over the **entire** farmer list without enforcing the active mode's prefix. So when the user is on the **Members** toggle and types `D03558`, the exact match succeeds and selects the debtor — making it look like "the debtor shows up in Members". This is the inverse of what the toggle is meant to enforce.

```ts
// Store.tsx line 345
const exactMatch = farmers.find(f => f.farmer_id.toLowerCase() === input.toLowerCase());
if (exactMatch) return exactMatch;   // ❌ no prefix check
```

**Bug 3 (minor) — Store/AI don't react to `membersUpdated` event**

`AddMemberModal` dispatches `window.dispatchEvent(new CustomEvent('membersUpdated'))` after a successful save, but `Store.tsx` and `AIPage.tsx` don't listen for it. New members only appear after the next periodic farmer sync, contributing to the "doesn't appear" perception.

### Fix

#### 1. `src/pages/Store.tsx`

- **Debtors filter (line ~686)**: drop the `hasCrbal` requirement. A debtor is anyone whose ID starts with `D`. Credit balance is shown later in the member info card / View More dialog when present, but it must NOT gate visibility in the picker.
  ```ts
  const prefixFilteredFarmers = farmers.filter(f =>
    f.farmer_id.toUpperCase().startsWith(prefix)
  );
  ```
- **Resolver (line ~340)**: enforce the active prefix on every match path (exact, padded, numeric). If the typed ID belongs to the opposite mode, return `null` and toast `Switch to Debtors/Members to use ID <X>`.
- **Listener**: add a `useEffect` subscribing to `window` event `membersUpdated` that re-runs `loadFarmers()` (and triggers a fresh `mysqlApi.farmers.getByDevice` if online) so a member added from the Dashboard appears in Store immediately.

#### 2. `src/pages/AIPage.tsx`

Apply the exact same three changes (filter, resolver, listener). The AI page mirrors Store.

#### 3. `src/components/SellProduceScreen.tsx`

Audit — already filters strictly by prefix and does not require `crbal`, so no change needed beyond confirming behavior. The shared `useFarmerResolution` hook also already does exact-match without prefix enforcement; we'll add an optional `enforcePrefix` flag (default `false` for backward compat) and pass `true` from Sell screen later if regression observed. Out of scope for this ticket if Sell already works correctly.

#### 4. `src/constants/appVersion.ts`

Bump to **v2.10.52 (Code 74)** with comment: "Fix Debtors filter (drop crbal requirement) + enforce prefix in farmer resolver + listen for membersUpdated in Store/AI."

### What Does NOT Change

- Backend (`server.js`) — untouched. `crbal` is still computed/returned the same way.
- IndexedDB schema, sync engine, reference generator — untouched.
- `SellProduceScreen` member/debtor toggle — already correct.
- Credit-balance display in the selected-member card and "View More" dialog — unchanged. Debtors with credit still see their balance; debtors without credit just show `0` / no credit lines (same behavior as before for that section).
- Dairy AM/PM and coffee SCODE logic from v2.10.51 — untouched.

### Backward Compatibility

- Existing debtors with credit: still appear in the list (no regression).
- New debtors without credit: now appear correctly (the bug fix).
- Production Capacitor clients < v2.10.52: no contract change; only frontend filter logic changes.

### Verification After Deploy

1. Dashboard → Add Member → create `D99999` with route, no transactions yet.
2. Open **Store** → toggle to **Debtors** → search modal shows `D99999`.
3. Stay on **Members** toggle → type `D99999` → resolver returns null and toasts "Switch to Debtors to use ID D99999". Selection does NOT happen.
4. Toggle to **Debtors** → type `D99999` → selected.
5. Repeat 2–4 in **AI Services** page.
6. Confirm existing member with credit (e.g. `D00001` with `CR02#5000`) still appears under Debtors and shows credit balance in the info card.
7. Confirm Members toggle still lists only `M*` farmers.

### Out of Scope

- Refactoring `useFarmerResolution` to enforce prefixes globally (separate cleanup task).
- Backfill of `crbal` data.
- Coffee/dairy session work (already shipped in v2.10.51).

