# Complete cPanel Deployment Guide - Milk Collection API
## From Domain Setup to Running Application

---

## Overview
- **Domain**: https://backend.maddasystems.co.ke
- **Directory**: `/home/username/public_html/api/milk-collection-api`
- **Database**: maddasys_milk_collection_pwa
- **User**: maddasys_tesh
- **Files to Upload**: `server.js`, `package.json`, `.htaccess`

---

## Step 1: Create Subdomain in cPanel

1. Log in to your cPanel account
2. Find **Domains** or **Subdomains** section
3. Click **Create A New Domain** or **Create Subdomain**
4. Enter subdomain details:
   - **Subdomain**: `backend`
   - **Domain**: `maddasystems.co.ke` (or select from dropdown)
   - **Document Root**: `/public_html/api/milk-collection-api` (auto-fills, keep it)
5. Click **Create** or **Add Domain**
6. Wait for DNS propagation (5-30 minutes)

**Result**: `backend.maddasystems.co.ke` now points to `/public_html/api/milk-collection-api`

---

## Step 2: Create Directory Structure

### Via cPanel File Manager:
1. Go to **File Manager** in cPanel
2. Navigate to `/public_html/`
3. Create folder: `api`
4. Inside `api`, create folder: `milk-collection-api`

**Final path**: `/public_html/api/milk-collection-api/`

---

## Step 3: Upload Files

Upload **ONLY these 3 files** to `/public_html/api/milk-collection-api/`:

1. **server.js** (main application file)
2. **package.json** (dependencies)
3. **.htaccess** (configuration)

### Via File Manager:
1. Navigate to `/public_html/api/milk-collection-api/`
2. Click **Upload**
3. Select all 3 files
4. Wait for upload to complete

### Via FTP:
1. Connect to your server using FileZilla
2. Navigate to `/public_html/api/milk-collection-api/`
3. Drag and drop the 3 files

---

## Step 4: Configure .htaccess (CRITICAL!)

**This is the most important step!**

1. In File Manager, navigate to `/public_html/api/milk-collection-api/`
2. Right-click `.htaccess` and select **Edit**
3. Find this line:
   ```apache
   PassengerAppRoot /home/username/public_html/api/milk-collection-api
   ```
4. Replace `username` with your **actual cPanel username**
   - Example: If your username is `maddasys`, change to:
   ```apache
   PassengerAppRoot /home/maddasys/public_html/api/milk-collection-api
   ```
5. Save the file

**If you skip this step, you'll see server.js code instead of API responses!**

---

## Step 5: Setup Node.js Application

1. In cPanel, find **Setup Node.js App** (or **Application Manager**)
2. Click **Create Application**
3. Configure settings:

   | Setting | Value |
   |---------|-------|
   | **Node.js version** | 14.x or higher (select from dropdown) |
   | **Application mode** | Production |
   | **Application root** | `/home/username/public_html/api/milk-collection-api` |
   | **Application URL** | `backend.maddasystems.co.ke` |
   | **Application startup file** | `server.js` |

   **IMPORTANT**: Replace `username` in Application root with your actual cPanel username!

4. Click **Create**

---

## Step 6: Install Dependencies

### Option A: Via cPanel Terminal (Recommended)
1. In the Node.js App interface, click **Open Terminal**
2. Run these commands:
   ```bash
   cd /home/username/public_html/api/milk-collection-api
   npm install --production
   ```

### Option B: Via SSH
1. SSH into your server:
   ```bash
   ssh username@backend.maddasystems.co.ke
   ```
2. Navigate and install:
   ```bash
   cd public_html/api/milk-collection-api
   npm install --production
   ```

**Wait for installation to complete** (30-60 seconds)

---

## Step 7: Start the Application

1. Go back to **Setup Node.js App** in cPanel
2. Find your application in the list
3. **Important**: Check that the status is not "Stopped"
4. Click **Restart** button
5. Wait 10-15 seconds for the app to start
6. Status should show **"Running"**

---

## Step 8: Test the API

### Test in Browser:
Open: `https://backend.maddasystems.co.ke/api/health`

**Expected Response**:
```json
{
  "success": true,
  "message": "API running",
  "timestamp": "2025-10-27T..."
}
```

### Test via cURL:
```bash
# Health check
curl https://backend.maddasystems.co.ke/api/health

# Get farmers
curl https://backend.maddasystems.co.ke/api/farmers

# Search farmer
curl "https://backend.maddasystems.co.ke/api/farmers?search=John"
```

---

## Step 9: Enable SSL (HTTPS)

1. In cPanel, go to **SSL/TLS Status**
2. Find `backend.maddasystems.co.ke`
3. Click **Run AutoSSL**
4. Wait for certificate to be issued (2-5 minutes)
5. Your API will now work with HTTPS (already configured):
   - `https://backend.maddasystems.co.ke/api/health`

---

## Troubleshooting

### ❌ Problem: Seeing server.js Code Instead of API Response

**This is the #1 most common issue!**

**Solution**:
1. Open **Setup Node.js App** in cPanel
2. Verify the app status is **"Running"** (not "Stopped")
3. Edit `.htaccess` file:
   - Find: `PassengerAppRoot /home/username/...`
   - Replace `username` with your actual cPanel username
   - Example: `/home/maddasys/public_html/api/milk-collection-api`
4. Click **Restart** in Node.js App interface
5. Wait 15 seconds
6. Clear browser cache (Ctrl+Shift+Delete)
7. Try again: `https://backend.maddasystems.co.ke/api/health`

---

### ❌ Problem: Application Won't Start

**Check**:
- Node.js version is 14.x or higher
- All 3 files uploaded correctly
- `npm install` completed without errors

**Solution**:
1. View error logs in Node.js App interface
2. Check database credentials are correct
3. Check that `server.js` has no syntax errors
4. Try stopping and starting the app again

---

### ❌ Problem: Database Connection Errors

**Symptoms**: API returns 500 errors or "connection refused"

**Solution**:
1. Verify database credentials in `.htaccess`:
   ```apache
   SetEnv MYSQL_DATABASE maddasys_milk_collection_pwa
   SetEnv MYSQL_USER maddasys_tesh
   SetEnv MYSQL_PASSWORD 0741899183Mutee
   ```
2. Test database connection via phpMyAdmin
3. Ensure database user has permissions on the database

---

### ❌ Problem: 404 Not Found

**Symptoms**: `/api/health` returns 404

**Solution**:
1. Check Application URL in Node.js App settings matches: `backend.maddasystems.co.ke`
2. Verify Application root path is correct
3. Ensure `.htaccess` is in the correct directory
4. Restart the application

---

### ❌ Problem: CORS Errors

**Symptoms**: Frontend can't connect, browser shows CORS error

**Solution**:
1. Check `.htaccess` has CORS headers:
   ```apache
   Header set Access-Control-Allow-Origin "*"
   ```
2. Restart application after any `.htaccess` changes

---

### ❌ Problem: Out of Memory / RAM Issues

**Symptoms**: App crashes with "out of memory" error

**This backend is optimized to prevent this!**

**If it still happens**:
1. Check Node.js version (use 14.x, not 16.x or 18.x)
2. Verify `package.json` has:
   ```json
   "start": "node --max-old-space-size=96 server.js"
   ```
3. Ensure ONLY 3 files uploaded (no node_modules, no extra folders)
4. Contact cPanel support to check available RAM

---

## View Logs

### Application Logs:
1. Open **Setup Node.js App**
2. Click on your application
3. Scroll to **Logs** section
4. View recent errors

### Error Logs via File Manager:
- Navigate to `/home/username/logs/`
- Look for files like `milk-collection-api-error.log`

### Via SSH:
```bash
tail -f ~/logs/*.log
```

---

## Restart Application

**When to restart**:
- After changing `.htaccess`
- After updating code
- If app becomes unresponsive

**How**:
1. Go to **Setup Node.js App**
2. Click **Restart** button next to your app
3. Wait 10-15 seconds

---

## Update Application

1. Stop the application in cPanel
2. Upload new `server.js` file
3. If dependencies changed, run `npm install` again
4. Restart application
5. Test endpoints

---

## Security Checklist

- ✅ SSL certificate installed (HTTPS)
- ✅ Database credentials in `.htaccess` (not in code)
- ✅ Direct access to `.js` files blocked
- ✅ CORS configured properly
- ✅ Application running in production mode

---

## Quick Reference

| Item | Value |
|------|-------|
| **Domain** | https://backend.maddasystems.co.ke |
| **Directory** | /home/username/public_html/api/milk-collection-api |
| **Database** | maddasys_milk_collection_pwa |
| **DB User** | maddasys_tesh |
| **Node Version** | 14.x or higher |
| **Port** | 3000 (internal) |
| **Files** | server.js, package.json, .htaccess |

---

## API Endpoints

### Health
- `GET /api/health` - Check if API is running

### Farmers
- `GET /api/farmers` - Get all farmers
- `GET /api/farmers?search=query` - Search farmers
- `GET /api/farmers/:id` - Get single farmer
- `POST /api/farmers` - Create farmer
- `PUT /api/farmers/:id` - Update farmer
- `DELETE /api/farmers/:id` - Delete farmer

### Milk Collection
- `GET /api/milk-collection` - Get all collections
- `GET /api/milk-collection?farmer_id=X&session=Y` - Filter collections
- `GET /api/milk-collection/:ref` - Get single collection
- `POST /api/milk-collection` - Create collection
- `PUT /api/milk-collection/:ref` - Update collection
- `DELETE /api/milk-collection/:ref` - Delete collection

### Devices
- `GET /api/devices/:deviceId` - Get device info
- `POST /api/devices` - Register device
- `PUT /api/devices/:deviceId` - Update device
- `DELETE /api/devices/:deviceId` - Delete device

---

## Support

**Issue**: App not starting → Check Node.js App logs  
**Issue**: Seeing code → Fix `.htaccess` username  
**Issue**: DB errors → Verify credentials in `.htaccess`  
**Issue**: 404 → Check Application URL and restart  
**Issue**: Out of memory → This shouldn't happen with this minimal backend!

---

**Deployment Status**: ✅ Production Ready  
**Last Updated**: 2025-10-27  
**Optimized for**: Minimal RAM usage on cPanel
