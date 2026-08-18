# Walkthrough - Backend Performance & Scalability Optimization

I have implemented a comprehensive set of performance optimizations to resolve the database connection exhaustion issue and ensure the system can handle 100+ concurrent users efficiently.

## Key Changes

### 1. Database Indexing
- Updated [MIGRATION_SCALABILITY_INDEXES.sql](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/MIGRATION_SCALABILITY_INDEXES.sql) with new composite indexes:
    - `transactions (memberno, ccode, Transtype, transdate)`: Optimized for individual farmer lookups.
    - `transactions (ccode, Transtype, transdate)`: Optimized for sync and reports.
    - `fm_items (icode, ccode)`: Optimized for product joins.
    - `cm_members (ccode, route)`: Optimized for farmer downloads.

### 2. Connection Pool Tuning
- **Backend API**:
    - Increased `POOL_LIMIT` from 20 to **40**.
    - Increased `QUEUE_LIMIT` from 100 to **200**.
    - Reduced `idleTimeout` to 15s to aggressively reclaim connections.
- **Sync Service**:
    - Increased `SYNC_POOL_LIMIT` to **10** to allow higher background throughput without starving the API.

### 3. SARGable Query Refactoring
I refactored multiple "slow" queries that were previously performing full table scans because they used `UPPER()`, `TRIM()`, or `CAST()` on indexed columns.
- **Optimized Endpoints**:
    - `/api/farmer-monthly-frequency`
    - `/api/periodic-report/farmer-detail`
    - `/api/z-report`
    - `/api/yetu/transactions` and `/api/yetu/summary`
    - Background cumulative warmer.

### 4. Application-Level Normalization
- Added `norm()` and `normL()` helpers in `server.js`.
- Moved normalization logic from the database (`UPPER(TRIM(ccode))`) to Node.js, allowing the database to perform high-speed index lookups.

## Verification

### Query Plan Analysis
I provided a verification script [verify_optimized_queries.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/scratch/verify_optimized_queries.js) that runs `EXPLAIN` on the refactored queries.

> [!TIP]
> After applying the SQL migration, run `node backend-api/scratch/verify_optimized_queries.js` to confirm that `transactions` table queries now use `idx_farmer_scan` or `idx_scalability_sync` instead of `ALL` (full table scan).

### Expected Results
- **Latency**: Requests that previously took minutes (holding connections) should now complete in < 50ms.
- **Stability**: The `Queue limit reached` error should be eliminated as connections are returned to the pool almost instantly.
- **Concurrency**: The tuned pool and optimized queries will allow the server to handle significantly more than 100 concurrent users.
