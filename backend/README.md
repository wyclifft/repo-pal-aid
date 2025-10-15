# Milk Collection API Backend

Backend API server for the Milk Collection App using Express.js and MySQL.

## Setup Instructions

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Database
1. Log in to your cPanel
2. Go to MySQL Databases
3. Create a new database (e.g., `milk_collection`)
4. Create a database user and assign it to the database
5. Grant ALL PRIVILEGES to the user
6. Note down: host, database name, username, and password

### 3. Set Environment Variables
1. Copy `.env.example` to `.env`
```bash
cp .env.example .env
```

2. Edit `.env` with your cPanel MySQL credentials:
```
DB_HOST=localhost (or your cPanel MySQL host)
DB_USER=your_cpanel_db_user
DB_PASSWORD=your_cpanel_db_password
DB_NAME=your_database_name
PORT=3001
```

### 4. Create Database Tables
1. Log in to phpMyAdmin in cPanel
2. Select your database
3. Go to SQL tab
4. Copy and paste contents of `schema.sql`
5. Click "Go" to execute

### 5. Hash Passwords for Users
Run this Node.js script to generate password hashes:
```javascript
const bcrypt = require('bcrypt');
const password = 'clerk123'; // Your password
bcrypt.hash(password, 10, (err, hash) => {
  console.log('Hashed password:', hash);
});
```

Then insert users into the `app_users` table with the hashed passwords.

### 6. Run the Server

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

### 7. Deploy to cPanel
1. Upload the `backend` folder to your cPanel
2. Use Node.js Selector in cPanel to:
   - Set Node.js version (14.x or higher)
   - Set Application Root to `/backend`
   - Set Application Startup File to `server.js`
   - Add environment variables from `.env`
3. Start the application

### 8. Update Frontend
Update the API URL in your React app's `.env`:
```
VITE_API_URL=https://your-domain.com:3001
```

Or if using cPanel's Node.js app on subdomain:
```
VITE_API_URL=https://api.your-domain.com
```

## API Endpoints

- `GET /health` - Health check
- `GET /api/farmers` - Get all farmers
- `POST /api/auth/login` - User login
- `POST /api/milk-collection` - Save milk collection (with accumulation)
- `GET /api/milk-collection/unsynced` - Get unsynced collections

## Security Notes
- Always use HTTPS in production
- Keep your `.env` file secure and never commit it
- Use strong passwords for database users
- Implement rate limiting for production
- Add JWT authentication for better security
