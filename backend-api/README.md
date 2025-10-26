# Milk Collection REST API - Backend

Complete Node.js/Express REST API for the Milk Collection PWA, compatible with cPanel deployment.

## 📁 Project Structure

```
backend-api/
├── server.js                 # Main application entry point
├── package.json              # Dependencies and scripts
├── .htaccess                 # cPanel URL rewrite rules
├── .env.example              # Environment variables template
├── config/
│   └── database.js           # MySQL connection pool
├── routes/
│   ├── farmers.js            # Farmers CRUD endpoints
│   ├── milkCollection.js     # Milk collection endpoints
│   └── devices.js            # Device approval endpoints
└── DEPLOYMENT_GUIDE.md       # Step-by-step deployment instructions
```

## 🚀 Quick Start (Local Development)

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Start Server**
   ```bash
   npm start          # Production
   npm run dev        # Development with auto-reload
   ```

4. **Test API**
   ```bash
   curl http://localhost:3000/api/health
   ```

## 📡 API Endpoints

### Health Check
- `GET /api/health` - Server status

### Farmers
- `GET /api/farmers` - Get all farmers
- `GET /api/farmers?search=query` - Search farmers
- `GET /api/farmers/:id` - Get farmer by ID
- `POST /api/farmers` - Create new farmer
- `PUT /api/farmers/:id` - Update farmer
- `DELETE /api/farmers/:id` - Delete farmer

### Milk Collection
- `GET /api/milk-collection` - Get all collections (with filters)
- `GET /api/milk-collection/ref/:referenceNo` - Get by reference number
- `POST /api/milk-collection` - Create new collection
- `PUT /api/milk-collection/ref/:referenceNo` - Update collection (weight accumulation)
- `DELETE /api/milk-collection/ref/:referenceNo` - Delete collection

**Query Parameters:**
- `?farmer_id=F001`
- `?session=AM|PM`
- `?date_from=2025-01-01`
- `?date_to=2025-01-31`

### Devices
- `GET /api/devices/:deviceId` - Get device status
- `POST /api/devices` - Register/update device
- `PUT /api/devices/:deviceId` - Update device approval
- `DELETE /api/devices/:deviceId` - Remove device

## 🔧 Environment Variables

```env
MYSQL_HOST=localhost
MYSQL_DATABASE=maddasys_milk_collection_pwa
MYSQL_USER=maddasys_pwa_user
MYSQL_PASSWORD=0741899183Mutee
MYSQL_PORT=3306
PORT=3000
NODE_ENV=production
```

## 📦 Dependencies

- **express** - Web framework
- **mysql2** - MySQL client with Promise support
- **cors** - Cross-Origin Resource Sharing
- **helmet** - Security headers
- **morgan** - HTTP request logger
- **dotenv** - Environment variable loader

## 🌐 cPanel Deployment

See detailed instructions in [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

**Quick Steps:**
1. Upload files to `/public_html/api/milk-collection-api/`
2. Setup Node.js App in cPanel
3. Set environment variables
4. Install dependencies: `npm install`
5. Start application
6. Configure SSL certificate

**Target URL:** `https://milkcollection.maddasystems.co.ke/api/`

## 🔒 Security Features

- ✅ Helmet for security headers
- ✅ CORS configuration
- ✅ SQL injection prevention (parameterized queries)
- ✅ Input validation on all endpoints
- ✅ Error handling with safe messages
- ✅ Environment variable protection

## 🧪 Testing Endpoints

### Using cURL
```bash
# Health check
curl https://milkcollection.maddasystems.co.ke/api/health

# Get farmers
curl https://milkcollection.maddasystems.co.ke/api/farmers

# Search farmers
curl https://milkcollection.maddasystems.co.ke/api/farmers?search=John

# Create milk collection
curl -X POST https://milkcollection.maddasystems.co.ke/api/milk-collection \
  -H "Content-Type: application/json" \
  -d '{
    "reference_no": "MC-2025-10-26-F001-AM",
    "farmer_id": "F001",
    "farmer_name": "John Doe",
    "route": "R01",
    "session": "AM",
    "weight": 25.5,
    "clerk_name": "clerk1",
    "price_per_liter": 45,
    "total_amount": 1147.5,
    "collection_date": "2025-10-26T06:30:00Z"
  }'
```

### Using Browser
- Navigate to: `https://milkcollection.maddasystems.co.ke/api/health`
- Should see JSON response with success status

## 📊 Response Format

### Success Response
```json
{
  "success": true,
  "data": [...],
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional information"
}
```

## 🔄 Database Schema

The API expects these MySQL tables:

- **farmers** - Farmer records
- **milk_collection** - Milk collection transactions
- **approved_devices** - Device approval management

See [MYSQL_MIGRATION_GUIDE.md](../MYSQL_MIGRATION_GUIDE.md) for complete schema.

## 🛠️ Maintenance

### View Logs
```bash
# cPanel: Setup Node.js App → View Logs
# SSH:
tail -f /home/username/logs/milk-collection-api.log
```

### Restart Application
```bash
# cPanel: Setup Node.js App → Restart button
# SSH:
pm2 restart milk-collection-api
```

### Database Backup
```bash
mysqldump -u maddasys_pwa_user -p maddasys_milk_collection_pwa > backup.sql
```

## 📞 Support

- **Documentation**: [APP_DOCUMENTATION.md](../APP_DOCUMENTATION.md)
- **Migration Guide**: [MYSQL_MIGRATION_GUIDE.md](../MYSQL_MIGRATION_GUIDE.md)
- **Deployment Guide**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

## 📝 License

ISC - Madda Systems

---

**Status:** Production Ready  
**Version:** 1.0.0  
**Last Updated:** 2025-10-26
