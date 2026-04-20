

## Auto-Suggest Next Member ID + Inline Success Banner — v2.10.43

### Overview
Two UX improvements to the Add Member flow:
1. **Auto-fill the Member ID** with the next available number for the device's `ccode`, preserving any letter prefix and zero-padding from the latest existing member (e.g. `M00123` → `M00124`).
2. **Replace the toast-only success notification with an inline green success banner at the top of the form** (e.g. "Member M00124 added successfully") so it's visible inside the modal context.

---

### Part A — Backend: Next Member ID Suggestion + Auto-Retry on Conflict

**`backend-api/server.js`** — two additive changes (no existing endpoint modified):

**A1. New endpoint: `GET /api/members/next-id?device_fingerprint=...`**
- Resolve `ccode` from device fingerprint via `devsettings` (rejects unauthorized devices).
- Query: `SELECT mmcode FROM cm_members WHERE ccode = ? AND mmcode IS NOT NULL AND mmcode <> '' ORDER BY id DESC LIMIT 50`
- Parse the most recent `mmcode` to detect:
  - `prefix` = leading non-digit characters (e.g. `M`, `BB`, or empty)
  - `numericTail` = trailing digit run
  - `padLength` = length of `numericTail`
- Compute `MAX(numericTail)` across the recent batch → `nextNumber = max + 1`.
- Return `{ success: true, data: { suggested: 'M00124', prefix: 'M', padLength: 5 } }`.
- Edge cases: if no existing members for that ccode → return `{ suggested: 'M00001', prefix: 'M', padLength: 5 }` (sensible default; user can override).

**A2. `POST /api/members` — auto-retry on `ER_DUP_ENTRY`**
- Wrap the `INSERT` in a loop (max 5 attempts).
- On `ER_DUP_ENTRY`/`errno 1062`: parse the submitted `mmcode`, increment the numeric tail using the same prefix/padding, retry.
- Return the final `farmer_id` (which may differ from the originally submitted `mmcode`) so the client displays the actual saved value in the success message.
- After 5 collisions, return the existing `409` response.

---

### Part B — Frontend: Auto-Fill, Inline Banner, Live Suggestion Refresh

**`src/services/mysqlApi.ts`**
- Add `membersApi.getNextId(deviceFingerprint: string)` calling `GET /api/members/next-id`.
- No header-based fingerprint (avoids preflight, per v2.10.42 pattern) — pass via query string.

**`src/components/AddMemberModal.tsx`**
- On modal open (after fingerprint resolves), call `membersApi.getNextId(...)` and pre-fill the `mmcode` field with `data.suggested`.
- Field remains **editable** (per the user's choice) — no `readOnly` lock; user may override.
- Show a small muted hint under the input: "Auto-suggested next ID — you can edit if needed."
- **Inline success banner** at the top of the dialog (above the ccode badge):
  - Render only when `lastSuccessMessage` state is set.
  - Style: `bg-green-50 border-green-200 text-green-900` with a `CheckCircle2` icon (uses existing shadcn `Alert` component for consistency and a11y).
  - Message: `Member {farmer_id} added successfully`.
  - Auto-clears after 5 seconds OR when the user starts editing any field (whichever comes first).
- On successful submission:
  - Set `lastSuccessMessage` from `result.data.farmer_id` (so the auto-retried ID, not the originally typed one, is displayed).
  - **Keep the modal open** so the operator sees the banner, then reset the form fields to defaults.
  - Auto-fetch a fresh `getNextId()` to pre-fill the next member, enabling rapid sequential entry.
  - Still keep the `toast.success(...)` call as a fallback for users who close the modal quickly.
  - Still dispatch `membersUpdated` event to refresh caches.
- Keep an explicit "Close" button (already present as Cancel) so the user can dismiss when done.

---

### Backward Compatibility
- **No DB schema changes.** `cm_members` already has all required columns.
- **No breaking changes to existing endpoints.** `POST /api/members` keeps the same request/response contract; only its retry behavior changes (transparent improvement). `GET /api/members/next-id` is brand new and additive.
- **Existing Capacitor production clients (v2.10.40–v2.10.42)**: continue to work unchanged. They send a manually-typed `mmcode` and will benefit from the new auto-retry on duplicates without any client update.
- **Web preview**: no preflight risk — `GET` with query string + `POST` already body-fingerprint based.

### Production Safety
- The next-id query is bounded (`LIMIT 50`) and indexed by `ccode`.
- Auto-retry is capped at 5 attempts to prevent runaway loops.
- All inserts remain server-side-only with `ccode` resolved from device — no privilege escalation surface added.

### Version
`src/constants/appVersion.ts` → **v2.10.43 (Code 65)**

---

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` | Add `GET /api/members/next-id` (prefix + pad detection); add auto-retry-on-duplicate loop in `POST /api/members` |
| `src/services/mysqlApi.ts` | Add `membersApi.getNextId(deviceFingerprint)` |
| `src/components/AddMemberModal.tsx` | Fetch & pre-fill suggested mmcode on open; inline green success banner at top of dialog; keep modal open after success and re-fetch next ID for rapid entry |
| `src/constants/appVersion.ts` | Bump to **v2.10.43 (Code 65)** |

### Out of Scope
- Changing the prefix scheme per company (uses whatever the most recent member used).
- Showing a "next 5 IDs" preview list — single suggestion only.
- Migrating historical members with non-conforming mmcode formats.

