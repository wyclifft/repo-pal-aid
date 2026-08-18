# Implementation Plan - Server Scalability & Performance Optimization (Phase 2)

Building on the connection consolidation fix, this phase focuses on reducing bandwidth usage, CPU load, and database pressure to support a higher number of concurrent users.

## User Review Required

> [!IMPORTANT]
> - **Gzip Compression**: I will enable response compression for all API calls. This significantly reduces the size of farmer and item lists (often by 80-90%), allowing connections to finish faster.
> - **ETag Support**: I will implement "Conditional GET" support. If a device already has the latest data, the server will return a tiny `304 Not Modified` response instead of re-sending the entire list.

## Proposed Changes

### [Backend API]

#### [MODIFY] [server.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)
- **Integrate `zlib`**: Add support for Gzip compression in the `sendJSON` helper.
- **Implement ETags**:
    - Generate ETags (hashes) for large datasets (Farmers, Items, Z-Reports).
    - Check the `If-None-Match` header in incoming requests to skip data transmission when possible.
- **Optimize Background warmer**:
    - Increase `CUM_BATCH_REWARM_MS` to 120 seconds to reduce idle CPU/DB load.
    - Prioritize warming only for companies that have had recent activity (activity-based re-warm).
- **Slow Query Logging**:
    - Add instrumentation to `withConn` to log queries that exceed 5 seconds, helping identify specifically which routes or farmers cause bottlenecks.

### [Database Optimization]

#### [NEW] [MIGRATION_SCALABILITY_INDEXES.sql](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/MIGRATION_SCALABILITY_INDEXES.sql)
- Add composite index on `transactions (ccode, Transtype, transdate, route(15))` if not already present.
- Add index on `cm_members (ccode, route)` to speed up filtered farmer downloads.

## Verification Plan

### Automated Tests
- N/A

### Manual Verification
- **Bandwidth Check**: Verify in the browser's Network tab that large responses (like `/api/farmers`) are being Gzipped (Content-Encoding: gzip).
- **ETag Check**: Verify that a second "Sync Data" call returns a `304 Not Modified` status code for unchanged data.
- **Concurrency Test**: Monitor `pm2 monit` or cPanel logs during multiple simultaneous syncs to ensure connection usage remains stable.
