# Milk Collection PWA - Application Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Features](#features)
4. [Technology Stack](#technology-stack)
5. [Installation](#installation)
6. [User Guide](#user-guide)
7. [Developer Guide](#developer-guide)
8. [API Reference](#api-reference)
9. [Offline Functionality](#offline-functionality)
10. [Security](#security)
11. [Troubleshooting](#troubleshooting)

---

## Overview

The Milk Collection PWA is a Progressive Web Application designed for dairy cooperatives to track milk collection from farmers. It works both online and offline, automatically syncing data when internet connectivity is restored.

### Key Features
- ✅ Offline-first architecture
- ✅ Real-time data synchronization
- ✅ Device approval system
- ✅ Weight accumulation for multiple collections
- ✅ Receipt generation and export
- ✅ Bluetooth scale integration
- ✅ Role-based access control

---

## Architecture

### System Architecture Diagram

```
┌─────────────────┐
│   Web Browser   │
│    (PWA App)    │
└────────┬────────┘
         │
         ├─────────────────┐
         │                 │
    ┌────▼─────┐     ┌────▼──────┐
    │ IndexedDB│     │  Supabase │
    │ (Offline)│     │   (Auth)  │
    └──────────┘     └────┬──────┘
                          │
                     ┌────▼─────────┐
                     │ MySQL Backend│
                     │  REST API    │
                     └──────────────┘
```

### Database Structure

#### MySQL Tables (Main Data)
1. **farmers** - Farmer information
2. **milk_collection** - Milk collection records
3. **approved_devices** - Device authorization

#### Supabase Table (Authentication)
1. **app_users** - User credentials and roles

#### IndexedDB Stores (Offline Cache)
1. **farmers** - Cached farmer data
2. **receipts** - Unsynced milk collections
3. **app_users** - Cached user data
4. **device_approvals** - Cached device approvals

---

## Features

### 1. Authentication & Authorization
- User login with username/password
- Role-based access (Admin, Clerk)
- Device approval system (prevents unauthorized devices)
- Offline login with cached credentials

### 2. Farmer Management
- Search farmers by ID or name
- Auto-complete farmer selection
- Route assignment
- Real-time farmer data sync

### 3. Milk Collection
- Record milk weight (manual or Bluetooth scale)
- Session selection (AM/PM)
- Weight accumulation for same farmer/session/day
- Automatic reference number generation
- Receipt generation and printing

### 4. Offline Functionality
- Full app functionality without internet
- Local data storage in IndexedDB
- Automatic sync when online
- Pending receipt tracking
- Offline indicator

### 5. Data Export
- Export receipts as TXT
- Export receipts as CSV
- Print individual receipts
- Batch export of pending receipts

### 6. Bluetooth Integration
- Connect to Bluetooth scales
- Auto-read weight measurements
- Manual weight entry fallback

---

## Technology Stack

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Shadcn/ui** - UI components
- **React Router** - Navigation
- **TanStack Query** - Data fetching

### Backend
- **MySQL** - Primary database
- **Supabase** - Authentication
- **REST API** - Backend communication

### Offline Storage
- **IndexedDB** - Client-side database
- **Service Worker** - Offline caching
- **PWA** - Installable app

### Libraries
- **Sonner** - Toast notifications
- **date-fns** - Date formatting
- **Lucide React** - Icons

---

## Installation

### Prerequisites
- Node.js 18+ or Bun
- Modern web browser (Chrome, Firefox, Edge, Safari)
- Internet connection for initial setup

### Setup Steps

1. **Clone Repository**
```bash
git clone [repository-url]
cd milk-collection-pwa
```

2. **Install Dependencies**
```bash
npm install
# or
bun install
```

3. **Configure Environment**
Create `.env` file:
```env
VITE_SUPABASE_URL=https://bnqzxyehhdmqbeuivpbq.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=[your-key]
VITE_MYSQL_API_URL=https://milkcollection.maddasystems.co.ke/api
```

4. **Run Development Server**
```bash
npm run dev
# or
bun dev
```

5. **Build for Production**
```bash
npm run build
# or
bun build
```

6. **Deploy**
- Upload `dist/` folder to web server
- Ensure HTTPS is enabled (required for PWA)
- Configure server for SPA routing

---

## User Guide

### Getting Started

#### 1. Login
1. Open the app in your browser
2. Enter your username and password
3. Click "Login"
4. **First-time device**: Admin approval required
5. **Approved device**: Instant access

#### 2. Collect Milk

**Step 1: Select Farmer**
1. Click search bar or type farmer ID/name
2. Select farmer from dropdown
3. Farmer details auto-fill
4. Select session (AM/PM)

**Step 2: Measure Weight**
- **Bluetooth Scale**: Click "Connect Scale" → Auto-reads weight
- **Manual Entry**: Type weight directly
- Use +/- buttons for small adjustments

**Step 3: Save Collection**
1. Click "Save Collection"
2. Receipt displays automatically
3. Print or close receipt
4. Data syncs to server (if online)

#### 3. Manage Pending Receipts

**View Pending**
- Scroll to "Pending Receipts" section
- See list of unsynced collections
- Total weight pending shown

**Sync Now**
1. Ensure internet connection
2. Click "Sync Now" button
3. Wait for confirmation
4. Pending list clears

**Export Data**
- **TXT**: Human-readable format
- **CSV**: Excel-compatible format
- Useful for offline backup

#### 4. Offline Usage

**When Offline**
- Yellow "Offline" badge appears
- All features work normally
- Data saved locally
- Auto-sync when back online

**Coming Back Online**
- Green notification appears
- Auto-sync starts automatically
- Pending receipts upload to server
- Local cache updates

---

## Developer Guide

### Project Structure

```
src/
├── components/          # React components
│   ├── FarmerSearch.tsx
│   ├── Login.tsx
│   ├── WeightInput.tsx
│   ├── ReceiptList.tsx
│   ├── ReceiptModal.tsx
│   └── ui/             # Shadcn UI components
├── hooks/              # Custom React hooks
│   ├── useIndexedDB.ts
│   └── use-toast.ts
├── services/           # API services
│   ├── mysqlApi.ts    # MySQL REST API
│   └── bluetooth.ts   # Bluetooth integration
├── utils/             # Utility functions
│   ├── deviceFingerprint.ts
│   └── fileExport.ts
├── pages/             # Route pages
│   ├── Index.tsx
│   └── NotFound.tsx
├── integrations/      # External integrations
│   └── supabase/      # Supabase client
├── lib/               # Library code
│   ├── supabase.ts    # Legacy Supabase (deprecated)
│   └── utils.ts       # Utility functions
└── index.css          # Global styles
```

### Key Components

#### FarmerSearch.tsx
- Farmer search and selection
- Auto-complete functionality
- Offline farmer cache
- Real-time sync

#### Login.tsx
- User authentication
- Device fingerprinting
- Device approval check
- Offline login support

#### WeightInput.tsx
- Manual weight entry
- Bluetooth scale connection
- Weight validation
- +/- adjustment buttons

#### ReceiptList.tsx
- Display pending receipts
- Sync functionality
- Export TXT/CSV
- Weight accumulation logic

#### ReceiptModal.tsx
- Receipt display
- Print functionality
- Receipt data formatting

### Custom Hooks

#### useIndexedDB
Manages IndexedDB operations:
- `saveFarmers()` - Cache farmers locally
- `getFarmers()` - Retrieve cached farmers
- `saveReceipt()` - Store milk collection
- `getUnsyncedReceipts()` - Get pending sync
- `saveDeviceApproval()` - Cache device status
- `getDeviceApproval()` - Check device approval

### Services

#### mysqlApi.ts
REST API wrapper for MySQL backend:
- `farmersApi` - Farmer CRUD operations
- `milkCollectionApi` - Collection management
- `devicesApi` - Device approval management

#### bluetooth.ts
Bluetooth scale integration:
- Device discovery
- Connection management
- Weight reading
- Error handling

### Utilities

#### deviceFingerprint.ts
Generates unique device ID:
- Browser fingerprinting
- Canvas fingerprinting
- SHA-256 hashing
- 64-character hex string

#### fileExport.ts
Data export functions:
- `generateTextReport()` - TXT format
- `generateCSVReport()` - CSV format
- Automatic file download

---

## API Reference

### Base URL
```
https://milkcollection.maddasystems.co.ke/api
```

### Authentication
Currently, no API key required. Add headers if needed:
```javascript
headers: {
  'Authorization': 'Bearer YOUR_TOKEN',
  'Content-Type': 'application/json'
}
```

### Endpoints

#### Farmers

**GET /farmers**
Get all farmers
```javascript
Response: {
  success: true,
  data: [
    {
      farmer_id: "F001",
      name: "John Doe",
      route: "R01",
      route_name: "Route One",
      member_route: "MR01"
    }
  ]
}
```

**GET /farmers/:id**
Get specific farmer
```javascript
Response: {
  success: true,
  data: { farmer_id: "F001", name: "John Doe", ... }
}
```

**POST /farmers**
Create new farmer
```javascript
Body: {
  farmer_id: "F001",
  name: "John Doe",
  route: "R01",
  route_name: "Route One"
}

Response: {
  success: true,
  data: { farmer_id: "F001", ... },
  message: "Farmer created successfully"
}
```

#### Milk Collection

**GET /milk-collection**
Get collections with filters
```javascript
Query params:
  ?farmer_id=F001
  &session=AM
  &date_from=2025-01-01
  &date_to=2025-01-31

Response: {
  success: true,
  data: [
    {
      reference_no: "MC-2025-01-10-F001-AM",
      farmer_id: "F001",
      weight: 25.5,
      session: "AM",
      ...
    }
  ]
}
```

**POST /milk-collection**
Create new collection
```javascript
Body: {
  reference_no: "MC-2025-01-10-F001-AM",
  farmer_id: "F001",
  farmer_name: "John Doe",
  route: "R01",
  session: "AM",
  weight: 25.5,
  clerk_name: "clerk1",
  collection_date: "2025-01-10T08:30:00"
}

Response: {
  success: true,
  data: { reference_no: "...", ... },
  message: "Collection saved"
}
```

**PUT /milk-collection/ref/:referenceNo**
Update collection (weight accumulation)
```javascript
Body: {
  weight: 30.0,
  collection_date: "2025-01-10T09:00:00"
}

Response: {
  success: true,
  data: { reference_no: "...", weight: 30.0, ... }
}
```

#### Devices

**GET /devices/:deviceId**
Get device approval status
```javascript
Response: {
  success: true,
  data: {
    device_id: "abc123...",
    user_id: "clerk1",
    approved: true
  }
}
```

**POST /devices**
Register/update device
```javascript
Body: {
  device_id: "abc123...",
  user_id: "clerk1",
  approved: false,
  device_info: "Chrome 120, Windows 11"
}

Response: {
  success: true,
  data: { device_id: "...", approved: false }
}
```

---

## Offline Functionality

### How It Works

1. **Initial Sync**
   - On first online login, app downloads:
     - All farmers
     - User credentials
     - Device approval status
   - Data stored in IndexedDB

2. **Offline Operations**
   - All searches use IndexedDB
   - Collections saved locally
   - Marked as "pending sync"
   - No server communication

3. **Coming Back Online**
   - Auto-detect network status
   - Upload pending receipts
   - Group by farmer/session/date
   - Accumulate weights
   - Mark as synced

### Offline Strategy

```javascript
// Check online status
if (navigator.onLine) {
  // Use REST API
  await mysqlApi.milkCollection.create(data);
} else {
  // Use IndexedDB
  await saveReceipt(data);
}

// Auto-sync when online
window.addEventListener('online', () => {
  syncPendingReceipts();
});
```

### Data Accumulation Logic

Same farmer + same session + same date = Accumulate weight

```javascript
// Example:
// Collection 1: Farmer F001, AM, 10kg, 2025-01-10
// Collection 2: Farmer F001, AM, 5kg, 2025-01-10
// Result: Farmer F001, AM, 15kg, 2025-01-10
```

---

## Security

### Authentication
- Username/password authentication
- Credentials stored in Supabase (encrypted)
- Session persistence in localStorage
- Device fingerprinting for security

### Device Approval
- Each device generates unique ID
- Admin must approve new devices
- Prevents unauthorized access
- Cached approval status

### Data Protection
- HTTPS required for production
- No sensitive data in localStorage (except session)
- API calls over secure connection
- MySQL database with user permissions

### Best Practices
1. Change default passwords
2. Use strong passwords (8+ chars, mixed)
3. Regular database backups
4. Monitor unauthorized access attempts
5. Keep dependencies updated

---

## Troubleshooting

### Common Issues

#### 1. "Device Not Approved"
**Problem**: Device waiting for admin approval  
**Solution**:
- Contact admin to approve device
- Admin logs in to DeviceApproval page
- Admin approves your device
- Retry login

#### 2. "Cannot Connect to Server"
**Problem**: API not reachable  
**Solution**:
- Check internet connection
- Verify API URL is correct
- Check server status
- Try again after few minutes

#### 3. "Receipts Not Syncing"
**Problem**: Pending receipts stuck  
**Solution**:
- Ensure you're online (check indicator)
- Click "Sync Now" manually
- Check browser console for errors
- Export as CSV for manual upload

#### 4. "Farmer Not Found"
**Problem**: Farmer search returns nothing  
**Solution**:
- Check spelling
- Try farmer ID instead of name
- Ensure farmers synced from server
- Refresh page to re-sync

#### 5. "Weight Not Reading from Scale"
**Problem**: Bluetooth scale not connecting  
**Solution**:
- Check scale is powered on
- Check Bluetooth enabled on device
- Click "Connect Scale" again
- Use manual entry as fallback

#### 6. "Login Failed Offline"
**Problem**: Cannot login without internet  
**Solution**:
- Must login online first time
- Device must be approved
- Credentials cached automatically
- Next logins work offline

### Error Codes

| Code | Message | Solution |
|------|---------|----------|
| 401 | Unauthorized | Check credentials |
| 403 | Device Not Approved | Wait for admin approval |
| 404 | Not Found | Check farmer/record exists |
| 500 | Server Error | Contact admin |
| CORS | CORS Error | Check API CORS settings |

### Debug Mode

Enable console logging:
```javascript
// In browser console
localStorage.setItem('debug', 'true');
// Reload page
```

View IndexedDB:
1. Open DevTools (F12)
2. Go to "Application" tab
3. Expand "IndexedDB"
4. View stored data

### Performance Tips

1. **Clear Cache Regularly**
   - Settings → Clear browsing data
   - Keep site data for offline access

2. **Sync Often**
   - Don't accumulate 100+ pending receipts
   - Sync every few hours

3. **Update Farmers**
   - Refresh page to sync new farmers
   - Or logout and login again

4. **Optimize Database**
   - Admin should clean old data
   - Keep only last 6 months

---

## Maintenance

### Daily Tasks
- ✅ Check pending receipts
- ✅ Verify data syncing
- ✅ Monitor error logs

### Weekly Tasks
- ✅ Backup MySQL database
- ✅ Review device approvals
- ✅ Clear old data (optional)

### Monthly Tasks
- ✅ Update dependencies
- ✅ Security audit
- ✅ Performance review

---

## Support

### Contact Information
- **Technical Support**: [your-support-email]
- **Admin Contact**: [admin-email]
- **Emergency**: [phone-number]

### Resources
- User Manual: [link]
- Video Tutorials: [link]
- API Documentation: [link]
- GitHub Repository: [link]

---

## Changelog

### Version 2.0.0 (Current)
- ✅ Migrated to MySQL backend
- ✅ Improved offline functionality
- ✅ Device approval system
- ✅ Weight accumulation logic
- ✅ Enhanced receipt management

### Version 1.0.0
- ✅ Initial release
- ✅ Supabase integration
- ✅ Basic offline support
- ✅ Bluetooth scale support

---

## License

[Your License Type]

Copyright © 2025 Madda Systems
