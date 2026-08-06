# Yetu Member Portal — multi-account access & unallocated deposits (v2.12.8)

Four changes: correct handling of deposits for unknown accounts, multi-account
members, multi-account user access with a dropdown, and a faster live refresh.

---

## 1. Unallocated deposits stay truly unallocated

Today, when an account number is not found in `sacco_members`, the service falls back to
`YETU_DEFAULT_CCODE` or the first Sacco company in `psettings` and stores the row under
that company. That is wrong — it attaches another company's deposits.

New behaviour:

- Unknown account: store the transaction with `member_id = NULL` **and** `ccode = NULL`,
  `allocation_status = 'unallocated'`. No fallback company lookup at all.
- The webhook still returns the mandated success envelope, and the raw payload is still
  logged, so nothing is lost and the row can be reconciled later.
- Known account: unchanged — `member_id` and the member's own `ccode` are stored,
  `allocation_status = 'allocated'`.

`sacco_transactions.ccode` is currently `NOT NULL`, so a small additive migration relaxes
it to nullable. Portal reads are already scoped by `ccode` + account, so `NULL`-ccode rows
are naturally invisible to members until reconciled.

## 2. Members may own several account numbers

`sacco_members.account_number` may hold several numbers separated by `##`, e.g.
`2477136##2478001##2478120`.

During webhook processing the incoming account is matched against **any** of the stored
segments (trimmed, case-insensitive), not the whole string. Single-value rows keep working
exactly as before. The column widens to accommodate multiple values.

## 3. User access to one or many accounts

`Users.link_account` keeps controlling access and may list several accounts separated by a
single `#`, e.g. `2477136#2478001`.

- Server resolves the user's allowed account list from `link_account`.
- Every portal request may pass an `account` parameter; the server accepts it **only** if it
  is in that user's allowed list, otherwise it falls back to the first allowed account.
  Company scoping by `ccode` (device + user) is unchanged.
- Responses include the allowed account list so the UI can render a picker.

UI:

- One linked account: opens straight into it, no dropdown shown.
- Several linked accounts: a compact account selector appears in the portal header.
  Changing it re-scopes summary cards, transactions, balances and any notifications, and
  resets pagination/filters to page 1.

## 4. Dashboard refresh 20s → 5s

The live poll interval in the portal data hooks drops from 20 000 ms to 5 000 ms
(still online-only, paused in background, with focus/reconnect refetch as today).

---

## Technical notes

Backend (`backend-api/`, redeploy to Contabo required):

- `yetuService.js`
  - `resolveMember()` — match on split `##` segments; return `{ memberId: null, ccode: null,
    allocated: false }` when unmatched, dropping the `YETU_DEFAULT_CCODE`/`psettings`
    fallback.
  - `storeDeposit()` — no longer throws when no company resolves; inserts `NULL` ccode.
  - `listTransactions()` / `getSummary()` — unchanged shape, still scoped to
    `(ccode, account_number_raw)`.
- `yetuRoutes.js`
  - `resolveSaccoAccess()` returns `accounts: string[]` (split of `link_account` on `#`)
    plus a validated `accountNumber` chosen from the `account` query param.
  - `/api/yetu/transactions` and `/api/yetu/summary` echo `accounts` and the active
    `account_number`.
- `MIGRATION_YETU_SACCO.sql` gains an additive section: `sacco_transactions.ccode` nullable,
  `sacco_members.account_number` widened; documented as safe to re-run.

Frontend (`src/modules/sacco/`):

- `saccoApi.ts` — optional `account` param on both calls; response types carry `accounts`.
- `useSaccoTransactions.ts` — `LIVE_POLL_MS = 5_000`; query keys include the active account.
- `SaccoPortal.tsx` — active-account state, header dropdown only when `accounts.length > 1`,
  reset page on switch. WebView 51-safe markup (native select, no new CSS features).

Version bump to **v2.12.8 (code 184)** in `appVersion.ts`, `android/app/build.gradle`,
and the service-worker cache version.
