# Testing Guidelines: Backend Scalability & Performance (v2.12.19)

To the QA/Testing Team,

We have just deployed a major performance overhaul to the backend API. The system is now optimized to support **100+ concurrent users** with significantly reduced latency. Please focus your testing on the following areas to ensure stability and data integrity.

## 1. Speed & Latency (The "Feel" Test)
The primary goal was to eliminate "hangs." Please verify that these actions return results in **under 1 second**:
- [ ] **Farmer Frequency Lookup**: When entering a farmer ID, the "Monthly Cumulative" weight should appear almost instantly.
- [ ] **Z-Report Generation**: Generating a Z-Report for a busy date should no longer show a loading spinner for more than a few seconds.
- [ ] **Farmer Detail Report**: Testing this for a farmer with hundreds of transactions across a wide date range.

## 2. Search & Filter Precision
We moved "normalization" (converting to uppercase and trimming spaces) from the database to the API logic. We must ensure searches still work accurately:
- [ ] **Case Sensitivity**: Test searching for a farmer or route using lowercase, uppercase, and mixed case (e.g., `f001`, `F001`, `f001 `). The system should find the record regardless.
- [ ] **Whitespace**: Test entering IDs with accidental leading or trailing spaces.
- [ ] **Special Characters**: If your farmer IDs contain characters like `#` or `-`, ensure they are still resolved correctly.

## 3. Concurrency & High Load
- [ ] **Simultaneous Sync**: Have 5+ devices trigger a "Sync Offline Records" at the exact same time. Monitor for any "Service Unavailable" or "Connection Timeout" errors.
- [ ] **Overlapping Actions**: While one device is running a heavy Z-Report, another should attempt to save a new milk collection. Both should succeed without delay.

## 4. Specific Module Checks
- [ ] **Sacco/Yetu Portal**: Log in as a Sacco member and verify the transaction list and summary cards load correctly.
- [ ] **Sync Service**: Verify that background tasks (if active) are not interfering with manual data entry.
- [ ] **Device Registration**: Test the "Clear Data" and "Re-install" flow to ensure the device fingerprint is correctly resolved and trnID is self-healed.

## 5. Success Criteria
- **Zero** `Error: Queue limit reached` in logs.
- **Zero** `[PERF] Slow request detected` (> 5s) for standard lookups.
- **No data loss**: Every record saved on the APK must appear correctly in the database and reports.

> [!IMPORTANT]
> If you encounter a "Farmer Not Found" error for an ID that definitely exists, please note the exact ID used and whether it was typed or scanned.

---
**Report any issues to the development thread immediately.**
