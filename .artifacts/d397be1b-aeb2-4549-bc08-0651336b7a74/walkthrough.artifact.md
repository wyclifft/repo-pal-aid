# Walkthrough - Recovery Account (7136 Prefix) Handling

I have updated the Yetu Sacco module to support "Recovery Accounts". This allows organizations to handle mistyped account numbers (e.g., `7136#MISTAKE`) by allocating them to a member who owns the prefix (`7136`), while keeping specific accounts (`7136#T001`) separate.

## Changes

### 1. Webhook Allocation (Prefix Fallback)
Updated `resolveMember` in `yetuService.js` to handle fallbacks.
- If an incoming account like `7136#BAD` is not found exactly, the system extracts the prefix `7136`.
- It then checks if any member has the exact string `7136` registered.
- If found, the transaction is allocated to that member.

### 2. Portal Recovery View
Updated the read models (`listTransactions` and `getSummary`) to handle "Prefix Accounts" (accounts without a `#`).
- When a user selects a recovery account (e.g., `7136`), the backend queries for all transactions matching `7136#%` OR the exact prefix `7136`.
- Crucially, it **excludes** transactions for specific accounts the user also owns (e.g., it will not show `7136#T001` in the recovery list if the user owns that specific account).

### 3. UI Update
Modified `SaccoPortal.tsx` to handle multi-account selection more gracefully.
- **Specific Accounts**: Shown in a primary dropdown.
- **Recovery Accounts**: Shown in a separate "Recovery" dropdown beside the main one.
- These pickers only appear if the user has multiple accounts linked.

### 4. Raw InvoiceNumber Storage
Updated `yetuService.js` to ensure the incoming `InvoiceNumber` is never modified.
- `normalizeYetuPayload` now preserves the exact raw string (including spaces and case) for the `accountNumber` field.
- `storeDeposit` uses this raw string directly for the database `INSERT` into `account_number_raw`.
- Allocation logic (`resolveMember`) still uses a normalized lookup to ensure matching works, but the historical record remains untouched.

### 5. Logging and Recovery Refinements
Refined the service logic for accuracy and traceability.
- **ISO Timestamps**: Added a `ts()` helper. Every log entry in `yetuService.js` and `yetuRoutes.js` now begins with a bracketed ISO timestamp (e.g., `[2026-08-09T...]`).
- **Raw Allocation Logs**: Removed the misleading "canonical" log. The system now logs the exact raw string being resolved.
- **Inclusive Recovery Filter**: Updated `buildAccountFilter` to match both `7136` (exact) and `7136#%` (sub-accounts).
- **Pure Raw Allocation**: Removed the intermediate `canonicalAccount` step in `storeDeposit`. The system now passes the raw input directly to the database resolver.

## Verification Results

### Webhook Logic
- `7136#T001` -> Exact match found -> Allocated to Member A.
- `7136#BAD` -> Exact match fails -> Prefix `7136` match found -> Allocated to Member B (Recovery Member).
- `7136` -> Exact match found -> Allocated to Member B.

### Portal Filtering
- User owns `7136#T001` and `7136`.
- Selecting `7136#T001` shows only that specific account.
- Selecting `7136` shows `7136`, `7136#BAD`, `7136#WRONG`, etc., but **hides** `7136#T001`.

render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/yetuService.js)
render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/yetuRoutes.js)
render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/modules/sacco/SaccoPortal.tsx)
