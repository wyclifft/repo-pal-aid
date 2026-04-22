

## Skip Reserved Test-Member IDs in Next-ID Suggestion — v2.10.59

### Problem

Your operations team uses high-numbered IDs (e.g., `M9999`, `M9998`, `M9000`…) as **test/sentinel members**. The current `/api/members/next-id` logic computes `MAX(numericTail)` across the recent 200 mcodes, which can return:

- The test sentinel itself → it suggests `M10000` after a real next of `M3557`, **or**
- When the recent batch is dominated by old test rows but the latest real members got pushed off the 200-row window → it can collapse back to the test row's neighborhood, suggesting something like `M1000` while the real ledger is at `M3556`.

Either way, the suggested next ID is wrong: operators want it to be the next ID after the **real production members**, ignoring the reserved test range.

### Fix — exclude a configurable "reserved test" numeric range

Treat IDs whose numeric tail falls in a **reserved test range** as invisible to the next-id calculation. Default range: `9000–9999` (covers your `M9999` example with breathing room). The range applies per-prefix (so `M9999` and `D9999` are both reserved).

Real members in `1…8999` and `10000+` are still considered. If real members ever cross `9000`, the system still keeps incrementing past `9999` correctly (the exclusion is only applied when computing MAX; once the real `MAX` is, say, `M8999`, suggesting `M9000`… we then *jump* over the reserved window — see "Jump rule" below).

#### 1. `backend-api/server.js` — exclude reserved range, drop the LIMIT, jump the gap

Rewrite the next-id query so it computes the true MAX of the numeric tail in SQL — **not** in JS over a `LIMIT 200` window. This also fixes the latent "real MAX outside the recent batch" bug.

```sql
SELECT
  COALESCE(
    MAX(
      CAST(
        SUBSTRING(mcode, LENGTH(?) + 1) AS UNSIGNED
      )
    ),
    0
  ) AS max_num,
  -- detect padding from the most-recent same-prefix row for stability
  (SELECT LENGTH(SUBSTRING(mcode, LENGTH(?) + 1))
     FROM cm_members
    WHERE ccode = ? AND mcode LIKE CONCAT(?, '%')
      AND mcode REGEXP CONCAT('^', ?, '[0-9]+$')
    ORDER BY id DESC LIMIT 1) AS pad_length
FROM cm_members
WHERE ccode = ?
  AND mcode LIKE CONCAT(?, '%')
  AND mcode REGEXP CONCAT('^', ?, '[0-9]+$')
  AND CAST(SUBSTRING(mcode, LENGTH(?) + 1) AS UNSIGNED)
      NOT BETWEEN ? AND ?;
```

Bind variables:
- `prefix` (`M` or `D`) used for `LENGTH(?)`, `LIKE`, and the `REGEXP` anchor
- `ccode`
- `RESERVED_TEST_MIN` (default `9000`) and `RESERVED_TEST_MAX` (default `9999`)

Then in JS:

```js
const RESERVED_TEST_MIN = 9000;
const RESERVED_TEST_MAX = 9999;

let nextNumber = (max_num || 0) + 1;

// Jump rule: if the natural next number lands inside the reserved test range,
// jump straight past it. Real members can keep growing forever.
if (nextNumber >= RESERVED_TEST_MIN && nextNumber <= RESERVED_TEST_MAX) {
  nextNumber = RESERVED_TEST_MAX + 1; // -> 10000
}

const padded = String(nextNumber).padStart(pad_length || 5, '0');
const suggested = `${prefix}${padded}`;
```

Behavior matrix (prefix `M`, default reserved `9000–9999`):

| Real MAX in DB (excl. reserved) | Suggested |
|---|---|
| `3556` | `M3557` |
| `8999` | `M9000` → bumped to **`M10000`** (jumps the gap) |
| `10042` | `M10043` |
| no rows | `M00001` |

`M9999`, `M9000`, etc. are **ignored** when computing MAX, but they still exist and can still be looked up / used in transactions — only the auto-suggestion treats them as invisible.

**Backward compatibility:** when `prefix` is omitted (legacy v2.10.32–v2.10.57 clients), keep today's branch as a fallback so legacy devices see no behavior change. The reserved-range exclusion is applied **only on the prefix-scoped branch** (v2.10.58+ clients) so we don't regress devices that don't know about prefixes.

#### 2. Make the reserved range configurable (no code redeploy needed long-term)

Read the range from `psettings` if a column exists, otherwise fall back to constants:

```js
// Per-ccode override (additive; falls back to defaults if columns missing or null)
const [psRows] = await pool.query(
  `SELECT
     CAST(reserved_testid_min AS UNSIGNED) AS rmin,
     CAST(reserved_testid_max AS UNSIGNED) AS rmax
   FROM psettings WHERE ccode = ? LIMIT 1`,
  [ccode]
).catch(() => [[]]);
const reservedMin = Number(psRows?.[0]?.rmin) > 0 ? Number(psRows[0].rmin) : 9000;
const reservedMax = Number(psRows?.[0]?.rmax) > 0 ? Number(psRows[0].rmax) : 9999;
```

If the columns don't exist in your `psettings` table, the `.catch` swallows the error and we keep the safe defaults. **No DB migration is required for this fix to work**; the override is purely opt-in if your team later wants to change the range per cooperative.

#### 3. `src/components/AddMemberModal.tsx` — surface the rule to the operator

Tiny UX nudge so operators understand why a suggestion may "jump":

- Below the auto-suggested ID, when the suggested numeric tail equals `RESERVED_TEST_MAX + 1` (e.g., `M10000`) **or** the response includes a flag `jumped: true`, show a subtle hint:
  > *"Skipped reserved test range (M9000–M9999)."*
- The backend response gains two optional, additive fields: `reservedRange: [9000, 9999]` and `jumped: boolean`. Older clients ignore them.

#### 4. `src/services/mysqlApi.ts`

Widen the response type with the optional fields:

```ts
getNextId: async (deviceFingerprint, prefix?) => Promise<ApiResponse<{
  suggested: string;
  prefix: string;
  padLength: number;
  reservedRange?: [number, number];
  jumped?: boolean;
}>>
```

No call-site changes elsewhere — it's purely additive.

#### 5. Version bump

- `src/constants/appVersion.ts` → **v2.10.59** (Code **81**)
- `android/app/build.gradle` → `versionName "2.10.59"`, `versionCode 81`

Comment: *"v2.10.59 — Member next-id ignores reserved test range (default 9000–9999) and computes true MAX in SQL; jump rule prevents suggesting reserved IDs."*

### Why this is production-safe

- **No schema change required.** The `psettings` override is best-effort with `.catch` fallback. Existing tables work unchanged.
- **Legacy clients (no `prefix` query param)** keep the original code path → zero behavior change for v2.10.32–v2.10.57.
- **No effect on `/api/members` POST** (still hard-fails on duplicate), no effect on transactions, sync, receipts, cumulative, or photos.
- **Reserved members remain fully usable** — they're just hidden from the *suggestion* algorithm, not deleted or blocked.
- **SQL change is a true `MAX(...)`** instead of a JS scan over the latest 200 rows → also fixes the latent "real top ID outside the recent window" bug that's likely contributing to the `M1000` suggestion you're seeing today.

### Files Touched

| File | Change |
|---|---|
| `backend-api/server.js` | `/api/members/next-id` (prefix branch): true SQL MAX with reserved-range exclusion + jump rule; optional `psettings` override; returns `reservedRange` + `jumped` |
| `src/services/mysqlApi.ts` | `getNextId` response type gains optional `reservedRange`, `jumped` |
| `src/components/AddMemberModal.tsx` | Subtle hint under the ID field when suggestion jumped over reserved range |
| `src/constants/appVersion.ts` | Bump to v2.10.59 (Code 81) + changelog comment |
| `android/app/build.gradle` | `versionName "2.10.59"`, `versionCode 81` |

### Verification Checklist

1. With test member `M9999` present and real members up to `M3556` → suggestion is `M3557` (not `M10000`, not `M1000`). ✓
2. With real members up to `M8999` and `M9999` test present → suggestion is `M10000` (jump rule). ✓
3. With real members up to `M10042` → suggestion is `M10043`. ✓
4. With no members at all → `M00001`. ✓
5. Switch toggle to Debtor with test `D9999` and real `D0123` → suggestion `D0124`. ✓
6. Legacy v2.10.57 phone (no `prefix` param) → original behavior, no regression. ✓
7. Manually typing `M9999` still allowed (no hard block), and POST `/api/members` still de-dupes correctly. ✓
8. No new console errors; transactions/sync/receipts/photo audit unchanged. ✓

### Out of Scope

- Migrating or hiding existing test members from any list views.
- Adding a UI to edit the reserved range from inside the app (the `psettings` override path is wired up, but UI configuration can come later if you want).
- Any changes to prefixes other than `M` and `D`.

