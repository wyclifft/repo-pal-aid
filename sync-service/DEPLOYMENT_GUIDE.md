# Sync Service Deployment Guide for cPanel

**Domain**: `2backend.maddasystems.co.ke`

This guide covers deploying the Milk Collection Sync Service on cPanel hosting in a **separate directory** from existing applications.

## Overview

The Sync Service is an ultra-lightweight Node.js REST API that:
- Syncs data between MySQL and external systems
- Supports scheduled and on-demand sync operations
- Tracks sync history and status
- Exports/imports data for backup and migration

## Files to Upload

```
sync-service/
├── server.js       # Main application file
├── package.json    # Dependencies
└── .htaccess       # cPanel configuration
```

---

## Step-by-Step Deployment

### Step 1: Create Subdomain

1. Log in to cPanel
2. Go to **Domains** → **Subdomains** (or **Domains** → **Create A New Domain**)
3. Create subdomain: `2backend.maddasystems.co.ke`
4. **IMPORTANT**: Set document root to a NEW directory: `/public_html/sync-service`
   - This keeps it separate from existing `/public_html/api/` applications

### Step 2: Create Directory Structure

1. Go to **File Manager**
2. Navigate to `/public_html/`
3. Create folder: `sync-service` (if not auto-created)
4. The final path should be: `/public_html/sync-service/`

### Step 3: Upload Files

Upload these files to `/public_html/sync-service/`:
- `server.js`
- `package.json`
- `.htaccess`

### Step 4: Configure .htaccess

The `.htaccess` file is pre-configured with:
- Same MySQL credentials as the main backend
- Same environment variable format
- Port 3001 (different from main backend's 3000)

### Step 5: Setup Node.js Application

1. Go to **Software** → **Setup Node.js App**
2. Click **Create Application**
3. Configure:
   - **Node.js version**: 14.x (same as main backend)
   - **Application mode**: Production
   - **Application root**: `/public_html/sync-service`
   - **Application URL**: `2backend.maddasystems.co.ke`
   - **Application startup file**: `server.js`
4. Click **Create**

### Step 6: Install Dependencies

1. In the Node.js setup page, click **Run NPM Install**
   
   Or via Terminal/SSH:
   ```bash
   cd ~/public_html/sync-service
   npm install --production
   ```

### Step 7: Start Application

1. In Node.js setup page, click **Start App**
2. Verify status shows "Running"

### Step 8: Test the Service

```bash
# Health check
curl https://2backend.maddasystems.co.ke/api/health

# Version info
curl https://2backend.maddasystems.co.ke/api/version

# Get stats
curl https://2backend.maddasystems.co.ke/api/stats
```

---

## API Endpoints Reference

### Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info |
| `/api/version` | GET | Version and memory info |
| `/api/health` | GET | Health check with DB status |
| `/api/stats` | GET | Table record counts |

### Sync Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sync/status` | GET | Current sync status |
| `/api/sync/run` | POST | Trigger full sync |
| `/api/sync/:table` | POST | Sync specific table (farmers, milk_collection, devices) |
| `/api/sync/history` | GET | View sync history |
| `/api/sync/schedule/start` | POST | Start scheduled sync |
| `/api/sync/schedule/stop` | POST | Stop scheduled sync |

### Data Import/Export

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/import/farmers` | POST | Import farmers (JSON array) |
| `/api/export/farmers` | GET | Export all farmers |
| `/api/export/milk_collection` | GET | Export milk collection (with ?from=&to=&limit= params) |

---

## Configuration

Uses same environment variables as main backend:

| Variable | Value |
|----------|-------|
| `MYSQL_HOST` | localhost |
| `MYSQL_DATABASE` | maddasys_milk_collection_pwa |
| `MYSQL_USER` | maddasys_tesh |
| `MYSQL_PASSWORD` | 0741899183Mutee |
| `MYSQL_PORT` | 3306 |
| `PORT` | 3001 |

---

## Using the Sync Service

### Manual Sync

Trigger a full sync:
```bash
curl -X POST https://2backend.maddasystems.co.ke/api/sync/run
```

Sync specific table:
```bash
curl -X POST https://2backend.maddasystems.co.ke/api/sync/farmers
curl -X POST https://2backend.maddasystems.co.ke/api/sync/milk_collection
curl -X POST https://2backend.maddasystems.co.ke/api/sync/devices
```

### Scheduled Sync

Start automatic sync:
```bash
curl -X POST https://2backend.maddasystems.co.ke/api/sync/schedule/start
```

Stop automatic sync:
```bash
curl -X POST https://2backend.maddasystems.co.ke/api/sync/schedule/stop
```

### Export Data

Export farmers:
```bash
curl https://2backend.maddasystems.co.ke/api/export/farmers > farmers.json
```

Export milk collection with date filter:
```bash
curl "https://2backend.maddasystems.co.ke/api/export/milk_collection?from=2025-01-01&to=2025-01-31&limit=500" > collections.json
```

### Import Data

Import farmers:
```bash
curl -X POST https://2backend.maddasystems.co.ke/api/import/farmers \
  -H "Content-Type: application/json" \
  -d '{"farmers": [{"farmer_id": "F001", "farmer_name": "John Doe", "route_name": "Route A"}]}'
```

---

## Troubleshooting

### Application Not Starting

1. Check Node.js app status in cPanel
2. View error logs in cPanel
3. Verify `.htaccess` paths are correct
4. Ensure database credentials are valid

### Database Connection Errors

1. Verify MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
2. Check MySQL user has proper permissions
3. Test connection: `mysql -u maddasys_tesh -p maddasys_milk_collection_pwa`

### 500 Internal Server Error

1. Check cPanel error logs
2. Verify all environment variables are set
3. Ensure `package.json` dependencies installed

### Sync Failures

1. Check `/api/sync/status` for error details
2. View `/api/sync/history` for recent operations
3. Verify tables exist in database
4. Check remote API configuration if using external sync

---

## Quick Reference

**Domain:** `2backend.maddasystems.co.ke`
**Directory:** `/public_html/sync-service/`

**URLs:**
- Service: `https://2backend.maddasystems.co.ke/`
- Health: `https://2backend.maddasystems.co.ke/api/health`
- Status: `https://2backend.maddasystems.co.ke/api/sync/status`

**Commands:**
```bash
# Trigger sync
curl -X POST https://2backend.maddasystems.co.ke/api/sync/run

# Check status
curl https://2backend.maddasystems.co.ke/api/sync/status

# View history
curl https://2backend.maddasystems.co.ke/api/sync/history
```

---

## Directory Structure Comparison

| Application | Domain | Directory | Port |
|-------------|--------|-----------|------|
| Main Backend API | `api.maddasystems.co.ke` | `/public_html/api/milk-collection-api/` | 3000 |
| Sync Service | `2backend.maddasystems.co.ke` | `/public_html/sync-service/` | 3001 |

---

## Security Notes

- Never commit `.htaccess` with real credentials
- Use strong database passwords
- Enable HTTPS via cPanel SSL
- Consider adding API authentication for production
