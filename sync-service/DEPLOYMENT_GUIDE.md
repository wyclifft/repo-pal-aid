# Sync Service Deployment Guide for cPanel

This guide covers deploying the Milk Collection Sync Service on cPanel hosting.

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

### Step 1: Create Subdomain (Optional)

1. Log in to cPanel
2. Go to **Domains** → **Subdomains**
3. Create subdomain: `sync.yourdomain.com`
4. Set document root: `/public_html/sync-service`

### Step 2: Create Directory Structure

1. Go to **File Manager**
2. Navigate to `/public_html/`
3. Create folder: `sync-service`

### Step 3: Upload Files

Upload these files to `/public_html/sync-service/`:
- `server.js`
- `package.json`
- `.htaccess`

### Step 4: Configure .htaccess (CRITICAL!)

Edit `.htaccess` and replace:
1. `YOUR_CPANEL_USERNAME` → Your actual cPanel username
2. `YOUR_DB_PASSWORD_HERE` → Your database password

Example:
```apache
PassengerAppRoot /home/maddasys/public_html/sync-service
PassengerNodejs /home/maddasys/nodevenv/sync-service/18/bin/node

SetEnv DB_HOST localhost
SetEnv DB_USER maddasys_milk_user
SetEnv DB_PASSWORD MySecretPassword123
SetEnv DB_NAME maddasys_milk_collection_pwa
```

### Step 5: Setup Node.js Application

1. Go to **Software** → **Setup Node.js App**
2. Click **Create Application**
3. Configure:
   - **Node.js version**: 18.x or higher
   - **Application mode**: Production
   - **Application root**: `/public_html/sync-service`
   - **Application URL**: `sync.yourdomain.com` or `/sync-service`
   - **Application startup file**: `server.js`
4. Click **Create**

### Step 6: Install Dependencies

1. In the Node.js setup page, click **Run NPM Install**
   
   Or via Terminal/SSH:
   ```bash
   cd ~/public_html/sync-service
   source ~/nodevenv/sync-service/18/bin/activate
   npm install --production
   ```

### Step 7: Start Application

1. In Node.js setup page, click **Start App**
2. Verify status shows "Running"

### Step 8: Test the Service

```bash
# Health check
curl https://sync.yourdomain.com/api/health

# Version info
curl https://sync.yourdomain.com/api/version

# Get stats
curl https://sync.yourdomain.com/api/stats
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

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `DB_HOST` | localhost | MySQL host |
| `DB_USER` | root | MySQL username |
| `DB_PASSWORD` | - | MySQL password |
| `DB_NAME` | maddasys_milk_collection_pwa | Database name |
| `REMOTE_API_URL` | - | External API URL for sync |
| `REMOTE_API_KEY` | - | External API key |
| `SYNC_BATCH_SIZE` | 100 | Records per sync batch |
| `SYNC_INTERVAL_MS` | 300000 | Scheduled sync interval (5 min) |

---

## Using the Sync Service

### Manual Sync

Trigger a full sync:
```bash
curl -X POST https://sync.yourdomain.com/api/sync/run
```

Sync specific table:
```bash
curl -X POST https://sync.yourdomain.com/api/sync/farmers
curl -X POST https://sync.yourdomain.com/api/sync/milk_collection
curl -X POST https://sync.yourdomain.com/api/sync/devices
```

### Scheduled Sync

Start automatic sync:
```bash
curl -X POST https://sync.yourdomain.com/api/sync/schedule/start
```

Stop automatic sync:
```bash
curl -X POST https://sync.yourdomain.com/api/sync/schedule/stop
```

### Export Data

Export farmers:
```bash
curl https://sync.yourdomain.com/api/export/farmers > farmers.json
```

Export milk collection with date filter:
```bash
curl "https://sync.yourdomain.com/api/export/milk_collection?from=2025-01-01&to=2025-01-31&limit=500" > collections.json
```

### Import Data

Import farmers:
```bash
curl -X POST https://sync.yourdomain.com/api/import/farmers \
  -H "Content-Type: application/json" \
  -d '{"farmers": [{"farmer_id": "F001", "farmer_name": "John Doe", "route_name": "Route A"}]}'
```

---

## Troubleshooting

### Application Not Starting

1. Check Node.js app status in cPanel
2. View error logs: `~/logs/sync-service/error.log`
3. Verify `.htaccess` paths are correct
4. Ensure database credentials are valid

### Database Connection Errors

1. Verify DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
2. Check MySQL user has proper permissions
3. Test connection: `mysql -u USER -p -h HOST DATABASE`

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

**URLs:**
- Service: `https://sync.yourdomain.com/`
- Health: `https://sync.yourdomain.com/api/health`
- Status: `https://sync.yourdomain.com/api/sync/status`

**Commands:**
```bash
# Trigger sync
curl -X POST https://sync.yourdomain.com/api/sync/run

# Check status
curl https://sync.yourdomain.com/api/sync/status

# View history
curl https://sync.yourdomain.com/api/sync/history
```

---

## Security Notes

- Never commit `.htaccess` with real credentials
- Use strong database passwords
- Enable HTTPS via cPanel SSL
- Consider adding API authentication for production
