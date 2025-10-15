# Migration Guide: Supabase to cPanel MySQL

## Overview
This guide will help you migrate your Milk Collection App from Supabase to cPanel MySQL database.

## Prerequisites
- cPanel hosting account with MySQL database access
- Node.js installed on your cPanel (via Node.js Selector)
- FTP/SSH access to upload files

---

## Step 1: Set Up MySQL Database

### 1.1 Create Database in cPanel
1. Log in to your cPanel
2. Navigate to **MySQL® Databases**
3. Create a new database:
   - Database name: `milk_collection` (or your preferred name)
   - Click **Create Database**

### 1.2 Create Database User
1. In the same MySQL® Databases section, create a user:
   - Username: Choose a username (e.g., `milk_user`)
   - Password: Generate a strong password
   - Click **Create User**

### 1.3 Link User to Database
1. In **Add User To Database** section:
   - Select the user you just created
   - Select the database you created
   - Click **Add**
2. Grant **ALL PRIVILEGES** to the user
3. Click **Make Changes**

### 1.4 Note Your Credentials
Write down:
- Database host: Usually `localhost` (check cPanel for exact host)
- Database name: `cpanel_username_milk_collection`
- Database username: `cpanel_username_milk_user`
- Database password: Your chosen password

---

## Step 2: Create Database Tables

### 2.1 Access phpMyAdmin
1. In cPanel, go to **phpMyAdmin**
2. Select your database from the left sidebar

### 2.2 Run Schema SQL
1. Click on the **SQL** tab
2. Open the file `backend/schema.sql` from your project
3. Copy all the SQL code
4. Paste it into the SQL query box
5. Click **Go** to execute

This will create all necessary tables:
- `farmers`
- `app_users`
- `milk_collection`

---

## Step 3: Migrate Existing Data (Optional)

If you have existing data in Supabase:

### 3.1 Export from Supabase
1. Go to your Supabase dashboard
2. For each table, go to Table Editor
3. Click **Export** → **CSV**
4. Download CSV files for: farmers, app_users, milk_collection

### 3.2 Import to MySQL
1. In phpMyAdmin, select a table
2. Click **Import** tab
3. Choose the corresponding CSV file
4. Format: CSV
5. Click **Go**
6. Repeat for all tables

---

## Step 4: Set Up Backend API

### 4.1 Install Node.js in cPanel
1. In cPanel, find **Setup Node.js App**
2. Click **Create Application**
3. Settings:
   - Node.js version: **18.x** or higher
   - Application mode: **Production**
   - Application root: `/backend` (or where you'll upload the backend folder)
   - Application URL: Choose a subdomain (e.g., `api.yourdomain.com`)
   - Application startup file: `server.js`
4. Click **Create**

### 4.2 Upload Backend Files
Use FTP or File Manager to upload:
- The entire `backend/` folder to your cPanel
- Place it in the Application root you specified

### 4.3 Configure Environment Variables
In the Node.js App interface:
1. Click **Edit** on your application
2. Scroll to **Environment Variables**
3. Add these variables:
   ```
   DB_HOST=localhost
   DB_USER=your_cpanel_db_user
   DB_PASSWORD=your_db_password
   DB_NAME=your_database_name
   PORT=3001
   ```

### 4.4 Install Dependencies
1. In cPanel Node.js App interface, find your app
2. Click **Run NPM Install**
3. Wait for installation to complete

### 4.5 Start the Application
1. Click **Start** button
2. Application should show as **Running**
3. Note the URL (e.g., `https://api.yourdomain.com`)

---

## Step 5: Create User Passwords

### 5.1 Generate Password Hashes
1. Create a temporary file `hash-password.js`:
```javascript
const bcrypt = require('bcrypt');
const passwords = ['clerk123', 'admin123']; // Your desired passwords

passwords.forEach(pwd => {
  bcrypt.hash(pwd, 10, (err, hash) => {
    console.log(`Password: ${pwd}`);
    console.log(`Hash: ${hash}\n`);
  });
});
```

2. Run locally:
```bash
cd backend
node hash-password.js
```

3. Copy the generated hashes

### 5.2 Insert Users into Database
1. In phpMyAdmin, go to `app_users` table
2. Click **Insert** tab
3. Add users:
   - user_id: `clerk1`
   - password: *paste bcrypt hash*
   - role: `clerk`
4. Repeat for other users

---

## Step 6: Update Frontend Configuration

### 6.1 Create Environment Variable
1. In your React app root, the `.env` file should already exist
2. Add this line:
   ```
   VITE_API_URL=https://api.yourdomain.com
   ```
   Replace with your actual API URL from Step 4

### 6.2 Test Locally
1. Start your React app:
   ```bash
   npm run dev
   ```
2. Ensure your backend API is running
3. Test the app functionality

---

## Step 7: Deploy Updated Frontend

### 7.1 Build and Deploy
1. Build your React app:
   ```bash
   npm run build
   ```
2. Deploy the `dist/` folder to your hosting

### 7.2 Update Environment Variables in Production
Make sure your production environment has:
```
VITE_API_URL=https://api.yourdomain.com
```

---

## Step 8: Testing

### 8.1 Test Backend API
Visit: `https://api.yourdomain.com/health`

Should return:
```json
{"status":"OK","timestamp":"..."}
```

### 8.2 Test Frontend
1. Open your app
2. Try logging in with a user account
3. Test farmer search
4. Test milk collection recording
5. Verify data is being saved to MySQL

---

## Troubleshooting

### API Not Connecting
- Check Node.js app is running in cPanel
- Verify environment variables are set correctly
- Check database credentials
- Look at Node.js app logs in cPanel

### CORS Errors
- Ensure backend has `cors` enabled (already in server.js)
- Check API URL in frontend `.env` is correct

### Database Connection Failed
- Verify MySQL user has ALL PRIVILEGES
- Check database host (might not be localhost)
- Confirm database name matches cPanel format

### 404 Errors on API Endpoints
- Ensure Application Startup File is set to `server.js`
- Check Application Root path is correct
- Restart the Node.js application

---

## Rollback Plan

If you need to rollback to Supabase:
1. Restore the original `src/lib/supabase.ts` file from git history
2. Remove the `VITE_API_URL` environment variable
3. Redeploy the frontend

---

## Support

For issues:
1. Check Node.js application logs in cPanel
2. Check browser console for errors
3. Test API endpoints directly using curl or Postman
4. Verify database connection in phpMyAdmin

## Security Recommendations

1. **Use HTTPS** - Ensure your API domain has SSL certificate
2. **Strong passwords** - Use complex passwords for database users
3. **Environment variables** - Never commit `.env` file
4. **Rate limiting** - Consider adding rate limiting to API
5. **Input validation** - Backend includes basic validation
6. **Database backups** - Set up automatic backups in cPanel
