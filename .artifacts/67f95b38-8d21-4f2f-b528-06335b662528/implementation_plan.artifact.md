# Implementation Plan - Resolve Backend Performance & Connection Exhaustion

The backend API is currently experiencing critical failures due to database connection pool exhaustion (`Queue limit reached`). This is caused by extremely slow queries (some taking over 15 minutes) that hold connections for too long, preventing new requests from being served.

## User Review Required

> [!IMPORTANT]
> This plan involves modifying many database queries to remove `UPPER()`, `TRIM()`, and `CAST()` functions from `WHERE` clauses. This is necessary to allow MySQL to use indexes. I assume that data in `ccode`, `memberno`, and `transdate` is already relatively clean or can be normalized at the application level.

> [!WARNING]
> Increasing the connection pool limit will use more memory on the database server. Ensure the MySQL server is configured with a high enough `max_connections` (at least 151 is recommended).

## Proposed Changes

### 1. Database Optimization
#### [MODIFY] [MIGRATION_SCALABILITY_INDEXES.sql](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/MIGRATION_SCALABILITY_INDEXES.sql)
- Ensure the file is complete and includes all necessary indexes for the `transactions` and `cm_members` tables.

### 2. Backend API Refactoring
#### [MODIFY] [server.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)

**A. Pool Configuration Tuning**
- Increase `POOL_LIMIT` from 20 to 40.
- Increase `QUEUE_LIMIT` from 100 to 200.

**B. SARGable Query Refactoring**
Update the following endpoints to use index-friendly query patterns:
- `/api/farmer-monthly-frequency`: Remove `UPPER(TRIM())` and `CAST(... AS DATE)`.
- `/api/milk-collection/by-device/:fp`: Optimize range scans.
- `/api/farmer-detail-report`: Optimize transaction lookups.
- `/api/z-report`: Optimize summary calculations.

**C. Parameter Normalization**
- Implement a helper to normalize codes (uppercase + trim) before they are passed to the database, moving the work from the DB engine to Node.js.

## Verification Plan

### Automated Tests
- I will provide a verification script `backend-api/scratch/verify_performance.js` that runs `EXPLAIN` on the optimized queries to confirm they use the new indexes.

### Manual Verification
- Monitor the PM2 logs for:
    - `[POOL] Waiting for connection slot` (should decrease)
    - `[PERF] Slow request detected` (durations should drop from minutes to milliseconds)
    - `Error: Queue limit reached` (should be eliminated)
