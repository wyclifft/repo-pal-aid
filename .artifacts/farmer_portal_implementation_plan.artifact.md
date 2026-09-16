# Implementation Plan: Individual Farmer Mobile App & Portal (`orgtype = 'I'`)

## 1. Executive Summary

To empower individual farmers (`orgtype = 'I'`) with direct visibility into their produce collections, credit balances, and periodic financial reports while maintaining strict operational boundaries (no weighing, no store access, no AI portal), we propose building a dedicated **Farmer Self-Service Mode / App Experience**.

This plan outlines a secure, scalable, and real-world-ready architecture integrating seamlessly with the existing backend (`backend-api/server.js`) and Capacitor/React frontend.

---

## 2. Core Requirements & Access Control Matrix

| Feature / Module | Clerk / Operator (`D`/`C`/`S`) | Individual Farmer (`orgtype = 'I'`) |
| :--- | :---: | :---: |
| **Produce Weighing & Scale Connection** | ✅ Full Access | ❌ Forbidden (Hidden) |
| **Store Inventory & Issuing** | ✅ Full Access | ❌ Forbidden (Hidden) |
| **AI Portal & Z-Reports** | ✅ Full Access | ❌ Forbidden (Hidden) |
| **Personal Collection History** | ✅ View Route / All | ✅ **View Own Only** |
| **Credit Balances & Advances** | ✅ View / Manage | ✅ **View Own Only** |
| **Periodic Reports & Statements** | ✅ Company / Route Level | ✅ **Personal Statement Only** |

---

## 3. User Registration & Authentication Flow

### 3.1 Self-Service Instant Login (No Admin Queue & No SMS)
To prevent overwhelming cooperative admins with thousands of device approval requests, individual farmers bypass the manual `approved_devices` admin queue. Because the farmer portal is **read-only**, instant access is safe.

1. **App Installation**: Farmer downloads the app from Google Play Store or APK distribution.
2. **Flexible ID Entry**:
   - User enters their **Company Code (`ccode`)** (used as a password/domain).
   - User enters their **Member Code (`mcode` / `farmer_id`)**. The backend normalizes input (e.g., `M00001`, `1`, `00001`, `01` all resolve to the correct registered member).
3. **Instant Verification**:
   - The backend validates the `mcode` against the `cm_members` / `farmers` table for that `ccode`.
4. **Local Device Binding**:
   - Upon successful verification, the app securely stores the `ccode` and `mcode` in local storage/device settings. The farmer stays logged in across app restarts without needing SMS OTPs or Admin approval.

---

## 4. Proposed Architecture & Component Design

### 4.1 Frontend Changes (`src/`)
- **`AuthContext.tsx` / Role Resolution**:
  - Detects if the logged-in user is an individual farmer (`user.role === 'farmer'` or `settings.orgtype === 'I'`).
- **Conditional Navigation / App Shell (`App.tsx`)**:
  - If `orgtype === 'I'`, render **Farmer Dashboard** instead of the Clerk/Collector Dashboard.
  - Hide tabs/menu items for Weighing (`BuyProduceScreen`), Store (`StoreScreen`), AI Portal, and Z-Reports.
- **Farmer Portal Screens (`src/components/farmer/`)**:
  - `FarmerDashboard.tsx`: Overview cards (Current Credit Balance, Total Season/Monthly Collections, Last Delivery).
  - `FarmerCollectionsScreen.tsx`: Paginated and searchable list of personal collections (Date, Session/Season, Weight, Station/Route).
  - `FarmerReportsScreen.tsx`: Periodic reports / financial statements (collections vs. credit deductions vs. net balance).
  - `FarmerProfileScreen.tsx`: Account details, linked cooperative info, and notification settings.

### 4.2 Backend API Endpoints (`backend-api/server.js`)
Create dedicated, secure endpoints authenticated with farmer JWT tokens:
- `POST /api/farmer/auth/login`: Authenticate farmer via `ccode` + `farmer_id` + PIN/OTP.
- `GET /api/farmer/portal/summary`: Returns current credit balance, total collections, and active season/session summary for the authenticated farmer.
- `GET /api/farmer/portal/collections`: Returns list of collections for the farmer with date range filters.
- `GET /api/farmer/portal/reports`: Returns periodic financial statements and credit ledger.

---

## 5. Security & Scalability (Real-World Resilience)

1. **Strict Data Isolation (Row-Level Security / Server-Side Filtering)**:
   - Every API request from a farmer forces `WHERE farmer_id = ? AND ccode = ?`, preventing cross-account data leakage.
2. **Offline Resilience (IndexedDB Caching)**:
   - Rural areas often have poor connectivity. Cache the farmer's latest credit balance, last 50 collections, and profile locally in IndexedDB so the app remains usable offline.
3. **Lightweight & Battery Efficient**:
   - Avoid heavy background background sync workers for farmers; sync only on app launch or manual pull-to-refresh.
4. **Audit Logging & Rate Limiting**:
   - Rate limit login attempts to prevent brute-force enumeration of `farmer_id`s.

---

## 6. Implementation Roadmap

### Phase 1: Backend API & Authentication
- [ ] Implement farmer instant authentication route (`POST /api/farmer/auth/login`).
  - Must include logic to normalize `mcode` input (stripping leading zeros, handling 'M' prefixes, etc.).
  - Must verify `ccode` matches.
- [ ] Create farmer-scoped data endpoints (`/summary`, `/collections`, `/reports`).
- [ ] Ensure backward compatibility: `orgtype = 'C'`, `D`, and `S` users MUST continue using the `approved_devices` admin queue.

### Phase 2: Frontend App Shell & Role Routing
- [ ] Update `App.tsx` and navigation to handle `role === 'farmer'` (`orgtype === 'I'`).
- [ ] Build simplified Farmer Dashboard (`FarmerDashboard.tsx`).
- [ ] Implement Collection History view (`FarmerCollectionsScreen.tsx`).

### Phase 3: Financial Statements & Offline Caching
- [ ] Implement Credit Balance and Periodic Statement view (`FarmerReportsScreen.tsx`).
- [ ] Integrate IndexedDB local caching for offline viewing.
- [ ] End-to-end testing with simulated farmer accounts.
