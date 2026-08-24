# Session Expiration Investigation & Fixes (OrgType = D)

Investigation of session expiration logic for Dairy organizations (`orgtype = 'D'`) confirmed inconsistencies between the frontend and backend, specifically regarding boundary handling and midnight wrap-around support.

## Findings

### 1. Inconsistent Boundaries & Overlap
- **Frontend**: Uses `currentHour >= timeFrom && currentHour < timeTo` (Exclusive of `timeTo`).
- **Backend**: Uses `time_to >= currentHour` (Inclusive of `timeTo`).
- **Impact**: At the hour mark (e.g., 12:00:00), both the ending session (4-12) and the starting session (12-18) match on the server. The server typically returns the one with the smallest `time_from` due to `ORDER BY`, leading to incorrect session assignment during transitions.

### 2. Missing Midnight Wrap-around (Server)
- **Frontend**: Supports sessions like 22:00 - 06:00 using wrap-around logic.
- **Backend**: Only uses simple range checks, causing midnight-spanning sessions to fail resolution.

### 3. Session Population Discrepancy
- At 18:35, a transaction was recorded with `CAN = PM` (Correct) but `session = AM` (Incorrect).
- This indicates that the logic determining `transactions.session` is either relying on stale frontend state or using flawed resolution logic.

## Proposed Changes

### Backend

#### [MODIFY] [server.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)
- **New Helper**: `findActiveSessionDairy(ccode, hour, conn)`
    - Implements exclusive boundaries: `hour >= from && hour < to`.
    - Supports midnight wrap-around: `hour >= from || hour < to` when `to < from`.
- **Update `/api/sessions/active/`**:
    - Use `findActiveSessionDairy` to resolve the current active session.
- **Update `POST /api/milk-collection`**:
    - For Dairy orgs (`orgtype = 'D'`), use `findActiveSessionDairy` (based on `transtime` hour) to determine the correct session for the `session` and `CAN` columns.
    - This ensures `transactions.session` matches the actual time of the transaction, overriding potentially stale frontend state.
- **Update `POST /api/sales` (Store/AI)**:
    - Apply similar logic to ensure `CAN` and `session` are populated correctly based on `transtime`.

## Verification Plan

### Automated Tests
- Test the `findActiveSessionDairy` logic with various inputs:
    - Hour = 12:00 with 4-12 and 12-18 sessions (should match 12-18).
    - Hour = 23:00 and 01:00 with 22-06 session (should match).
    - Hour = 18:35 (should match PM session).

### Manual Verification
- Verify that a transaction at 18:35 correctly populates both `session` and `CAN` as `PM`.
- Verify the "Session Expired" UI still works as expected on the frontend.
