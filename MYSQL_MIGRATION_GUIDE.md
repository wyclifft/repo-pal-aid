# MySQL Migration Guide

## Overview
This guide helps you migrate `farmers`, `milk_collection`, and `approved_devices` tables from Supabase to your MySQL database while keeping `app_users` in Supabase for authentication.

---

## Step 1: Create MySQL Database Schema

Run these SQL commands on your MySQL database at `localhost` (Database: `maddasys_milk_collection_pwa`):

### 1.1 Farmers Table
```sql
CREATE TABLE IF NOT EXISTS farmers (
  farmer_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  route VARCHAR(100) NOT NULL,
  route_name VARCHAR(255),
  member_route VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_farmers_route ON farmers(route);
CREATE INDEX idx_farmers_name ON farmers(name);
```

### 1.2 Milk Collection Table
```sql
CREATE TABLE IF NOT EXISTS milk_collection (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference_no VARCHAR(100) UNIQUE NOT NULL,
  farmer_id VARCHAR(50) NOT NULL,
  farmer_name VARCHAR(255) NOT NULL,
  route VARCHAR(100) NOT NULL,
  route_name VARCHAR(255),
  member_route VARCHAR(100),
  session ENUM('AM', 'PM') NOT NULL,
  weight DECIMAL(10,2) NOT NULL DEFAULT 0,
  collected_by VARCHAR(100),
  clerk_name VARCHAR(100) NOT NULL,
  price_per_liter DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) DEFAULT 0,
  collection_date DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (farmer_id) REFERENCES farmers(farmer_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_milk_farmer ON milk_collection(farmer_id);
CREATE INDEX idx_milk_session ON milk_collection(session);
CREATE INDEX idx_milk_date ON milk_collection(collection_date);
CREATE INDEX idx_milk_reference ON milk_collection(reference_no);
```

### 1.3 Approved Devices Table
```sql
CREATE TABLE IF NOT EXISTS approved_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(100) NOT NULL,
  approved BOOLEAN DEFAULT FALSE,
  device_info TEXT,
  last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_device_user (device_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_device_id ON approved_devices(device_id);
CREATE INDEX idx_user_id ON approved_devices(user_id);
CREATE INDEX idx_approved ON approved_devices(approved);
```

---

## Step 2: Export Data from Supabase

### 2.1 Export Farmers
1. Go to your Supabase dashboard: https://nzwmiuntcrjntnopargu.supabase.co
2. Navigate to Table Editor → `farmers`
3. Export as CSV or use SQL:
   ```sql
   SELECT * FROM farmers;
   ```
4. Save the data

### 2.2 Export Milk Collection
```sql
SELECT * FROM milk_collection;
```

### 2.3 Export Approved Devices
```sql
SELECT * FROM approved_devices;
```

---

## Step 3: Import Data into MySQL

### Option A: Using CSV Import
1. Save exported data as CSV files
2. Use MySQL Workbench or phpMyAdmin import feature
3. Map columns correctly

### Option B: Using SQL Insert Statements
Convert exported data to INSERT statements. Example:

```sql
-- Farmers
INSERT INTO farmers (farmer_id, name, route, route_name, member_route) VALUES
('F001', 'John Doe', 'R01', 'Route One', 'MR01'),
('F002', 'Jane Smith', 'R02', 'Route Two', 'MR02');

-- Milk Collection
INSERT INTO milk_collection (reference_no, farmer_id, farmer_name, route, session, weight, clerk_name, collection_date) VALUES
('MC-2025-01-10-F001-AM', 'F001', 'John Doe', 'R01', 'AM', 25.50, 'clerk1', '2025-01-10 08:30:00');

-- Approved Devices
INSERT INTO approved_devices (device_id, user_id, approved) VALUES
('abc123def456...', 'clerk1', TRUE);
```

---

## Step 4: Configure MySQL Backend API

Your MySQL REST API should be hosted at: `https://milkcollection.maddasystems.co.ke/api/`

### Required API Endpoints:

#### Farmers
- `GET /api/farmers` - Get all farmers
- `GET /api/farmers/:id` - Get farmer by ID
- `POST /api/farmers` - Create new farmer
- `PUT /api/farmers/:id` - Update farmer
- `DELETE /api/farmers/:id` - Delete farmer

#### Milk Collection
- `GET /api/milk-collection` - Get all collections
- `GET /api/milk-collection/:id` - Get collection by ID
- `GET /api/milk-collection/farmer/:farmerId` - Get by farmer
- `POST /api/milk-collection` - Create collection
- `PUT /api/milk-collection/:id` - Update collection (for weight accumulation)
- `DELETE /api/milk-collection/:id` - Delete collection

Query parameters for filtering:
- `?farmer_id=F001`
- `?session=AM`
- `?date_from=2025-01-01&date_to=2025-01-31`

#### Approved Devices
- `GET /api/devices/:deviceId` - Get device approval status
- `POST /api/devices` - Register new device
- `PUT /api/devices/:deviceId` - Update device status
- `DELETE /api/devices/:deviceId` - Remove device

### Expected Response Format:
```json
{
  "success": true,
  "data": [...],
  "message": "Operation successful"
}
```

### Error Response Format:
```json
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information"
}
```

---

## Step 5: Update Frontend Code

The frontend code has been updated to use the MySQL REST API. Key changes:

1. **New API Service**: `src/services/mysqlApi.ts` - Handles all REST API calls
2. **Updated Components**:
   - `FarmerSearch.tsx` - Uses MySQL API for farmers
   - `Index.tsx` - Uses MySQL API for milk collection
   - `Login.tsx` - Uses MySQL API for device approval
   - `ReceiptList.tsx` - Uses MySQL API for syncing

3. **Authentication**: `app_users` remains in Supabase

---

## Step 6: Testing the Migration

### 6.1 Test Farmers API
```bash
curl https://milkcollection.maddasystems.co.ke/api/farmers
```

### 6.2 Test Milk Collection API
```bash
curl https://milkcollection.maddasystems.co.ke/api/milk-collection
```

### 6.3 Test in App
1. Clear browser cache and localStorage
2. Log in to the app
3. Search for a farmer
4. Record a milk collection
5. Verify data appears in MySQL database

---

## Step 7: Verify Data Integrity

Run these SQL queries on MySQL to verify:

```sql
-- Check farmers count
SELECT COUNT(*) as total_farmers FROM farmers;

-- Check milk collections count
SELECT COUNT(*) as total_collections FROM milk_collection;

-- Check approved devices
SELECT COUNT(*) as total_devices FROM approved_devices;

-- Verify foreign key integrity
SELECT mc.*, f.name 
FROM milk_collection mc 
LEFT JOIN farmers f ON mc.farmer_id = f.farmer_id 
WHERE f.farmer_id IS NULL;
-- Should return 0 rows (no orphaned records)

-- Check recent collections
SELECT * FROM milk_collection 
ORDER BY collection_date DESC 
LIMIT 10;
```

---

## Rollback Plan

If migration fails, you can rollback:

1. **Frontend**: Revert to using Supabase client
   - Restore `src/lib/supabase.ts` configuration
   - Update components to use `supabase.from()` instead of `mysqlApi`

2. **Data**: Keep Supabase as backup until MySQL is stable
   - Don't delete Supabase tables immediately
   - Run both systems in parallel for 1-2 weeks

---

## Database Credentials (Secure Storage)

**DO NOT commit these to version control!**

Create a `.env` file on your server with:
```env
MYSQL_HOST=localhost
MYSQL_DATABASE=maddasys_milk_collection_pwa
MYSQL_USER=maddasys_pwa_user
MYSQL_PASSWORD=[your password]
MYSQL_PORT=3306

# API Configuration
API_BASE_URL=https://milkcollection.maddasystems.co.ke/api
API_KEY=[your api key if required]
```

---

## Maintenance & Monitoring

### Daily Checks
- Monitor API response times
- Check error logs
- Verify data sync success rate

### Weekly Maintenance
- Backup MySQL database
- Review and optimize slow queries
- Update indexes if needed

### Backup Command
```bash
mysqldump -u maddasys_pwa_user -p maddasys_milk_collection_pwa > backup_$(date +%Y%m%d).sql
```

---

## Support & Troubleshooting

### Common Issues

**Issue**: API returns 404
- **Solution**: Check API endpoint URLs in `src/services/mysqlApi.ts`

**Issue**: CORS errors
- **Solution**: Configure CORS headers on MySQL backend:
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, POST, PUT, DELETE
  Access-Control-Allow-Headers: Content-Type, Authorization
  ```

**Issue**: Data not syncing
- **Solution**: Check browser console logs and network tab

**Issue**: Foreign key constraint errors
- **Solution**: Ensure farmers exist before inserting milk_collection records

---

## Next Steps

1. ✅ Create MySQL database schema
2. ✅ Export data from Supabase
3. ✅ Import data into MySQL
4. ✅ Configure REST API endpoints
5. ✅ Update frontend code
6. ✅ Test thoroughly
7. ✅ Monitor for 2 weeks
8. ✅ Decommission Supabase tables (optional)

**Migration Status**: Ready for implementation
**Estimated Time**: 2-4 hours
**Risk Level**: Medium (Keep Supabase backup)
