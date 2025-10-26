# cPanel Deployment Guide - Milk Collection API

## Prerequisites
- cPanel hosting account with Node.js support
- SSH access (optional but recommended)
- MySQL database already created with tables

---

## Step 1: Upload Files to cPanel

### Option A: Using File Manager
1. Log in to cPanel
2. Go to **File Manager**
3. Navigate to your domain's directory (e.g., `/public_html/api/`)
4. Create a new folder called `milk-collection-api`
5. Upload all backend files:
   - `server.js`
   - `package.json`
   - `.htaccess`
   - `config/database.js`
   - `routes/farmers.js`
   - `routes/milkCollection.js`
   - `routes/devices.js`

### Option B: Using FTP/SFTP
1. Connect via FileZilla or similar FTP client
2. Upload entire `backend-api` folder to `/public_html/api/`

---

## Step 2: Setup Node.js Application in cPanel

1. In cPanel, find **Setup Node.js App** (or similar)
2. Click **Create Application**
3. Configure:
   - **Node.js version**: 14.x or higher
   - **Application mode**: Production
   - **Application root**: `/home/username/public_html/api/milk-collection-api`
   - **Application URL**: `milkcollection.maddasystems.co.ke/api`
   - **Application startup file**: `server.js`
   - **Passenger log file**: Leave default

4. Click **Create**

---

## Step 3: Set Environment Variables

In the Node.js App interface:

1. Click **Edit** on your application
2. Scroll to **Environment Variables**
3. Add these variables:

```
MYSQL_HOST=localhost
MYSQL_DATABASE=maddasys_milk_collection_pwa
MYSQL_USER=maddasys_pwa_user
MYSQL_PASSWORD=0741899183Mutee
MYSQL_PORT=3306
PORT=3000
NODE_ENV=production
```

4. Click **Save**

---

## Step 4: Install Dependencies

### Via cPanel Terminal (Recommended)
1. Click **Open Terminal** in Node.js App section
2. Run:
```bash
cd /home/username/public_html/api/milk-collection-api
npm install
```

### Via SSH
1. SSH into your server:
```bash
ssh username@milkcollection.maddasystems.co.ke
```

2. Navigate and install:
```bash
cd public_html/api/milk-collection-api
npm install --production
```

---

## Step 5: Configure URL Rewrite

If using subdirectory (e.g., `/api/`):

1. Edit `.htaccess` in `/public_html/` (not inside the app folder)
2. Add:

```apache
# Route /api/ to Node.js app
RewriteEngine On
RewriteBase /

# Proxy API requests to Node.js
RewriteCond %{REQUEST_URI} ^/api/
RewriteRule ^api/(.*)$ http://127.0.0.1:3000/api/$1 [P,L]
```

---

## Step 6: Start the Application

1. Go back to **Setup Node.js App** in cPanel
2. Find your application
3. Click **Start** or **Restart**
4. Wait for status to show "Running"

---

## Step 7: Test the API

### Health Check
```bash
curl https://milkcollection.maddasystems.co.ke/api/health
```

Expected response:
```json
{
  "success": true,
  "message": "Milk Collection API is running",
  "timestamp": "2025-10-26T12:00:00.000Z"
}
```

### Test Farmers Endpoint
```bash
curl https://milkcollection.maddasystems.co.ke/api/farmers
```

### Test from Frontend
Open your PWA and try searching for a farmer. Check browser console for API calls.

---

## Step 8: Enable SSL (HTTPS)

1. In cPanel, go to **SSL/TLS Status**
2. Enable **AutoSSL** for your domain
3. Wait for certificate to be issued
4. Your API will be accessible via HTTPS

---

## Troubleshooting

### Application Won't Start
- Check Node.js version compatibility
- Review error logs in cPanel Node.js App interface
- Verify all environment variables are set

### Database Connection Errors
- Verify MySQL credentials in environment variables
- Check if database user has proper permissions
- Test MySQL connection using cPanel phpMyAdmin

### 404 Errors
- Verify `.htaccess` is correctly configured
- Check Application URL matches your domain
- Ensure Application root path is correct

### CORS Errors
- Check CORS configuration in `server.js`
- Verify frontend domain is allowed in CORS settings
- Review `.htaccess` CORS headers

### Logs Location
- **Application logs**: cPanel Node.js App interface
- **Error logs**: `/home/username/logs/`
- **Access logs**: `/home/username/access-logs/`

---

## Monitoring & Maintenance

### Check Application Status
```bash
# Via cPanel interface
Setup Node.js App → View running apps

# Via SSH
pm2 list  # If using PM2
netstat -tulpn | grep :3000
```

### Restart Application
```bash
# Via cPanel
Setup Node.js App → Restart button

# Via SSH (if using PM2)
pm2 restart milk-collection-api
```

### View Logs
```bash
# Via SSH
tail -f /home/username/logs/milk-collection-api.log

# Or via cPanel File Manager
Navigate to logs directory and view files
```

---

## Database Backup (Automated)

Set up cron job in cPanel:

1. Go to **Cron Jobs**
2. Add new cron:
   - **Minute**: 0
   - **Hour**: 2
   - **Day**: *
   - **Month**: *
   - **Weekday**: *
   - **Command**:
   ```bash
   mysqldump -u maddasys_pwa_user -p'0741899183Mutee' maddasys_milk_collection_pwa > ~/backups/milk_db_$(date +\%Y\%m\%d).sql
   ```

---

## Security Checklist

- ✅ Environment variables configured (not hardcoded)
- ✅ SSL certificate installed
- ✅ `.env` file not in public directory
- ✅ Database password is strong
- ✅ CORS restricted to specific domains (update in production)
- ✅ Rate limiting enabled (optional)
- ✅ Regular backups scheduled

---

## Performance Optimization

### Enable Gzip Compression
Add to `.htaccess`:
```apache
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE application/json
  AddOutputFilterByType DEFLATE text/html
</IfModule>
```

### Cache Static Files
```apache
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType application/json "access plus 0 seconds"
</IfModule>
```

---

## Upgrade Process

1. Stop the application
2. Backup current files and database
3. Upload new files
4. Run `npm install` for new dependencies
5. Restart application
6. Test thoroughly

---

## Support

**Documentation**: See `MYSQL_MIGRATION_GUIDE.md` and `APP_DOCUMENTATION.md`

**Common Issues**: Check troubleshooting section above

**Database Issues**: Use cPanel phpMyAdmin to inspect data

---

## Quick Reference

- **API Base URL**: `https://milkcollection.maddasystems.co.ke/api/`
- **Application Path**: `/home/username/public_html/api/milk-collection-api`
- **Node.js Version**: 14.x or higher
- **Database**: maddasys_milk_collection_pwa
- **Port**: 3000 (internal)

---

**Deployment Status**: Ready for production
**Last Updated**: 2025-10-26
