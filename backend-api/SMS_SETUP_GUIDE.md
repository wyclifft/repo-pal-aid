# SMS Notifications Setup Guide

## Overview
This guide explains how to set up SMS notifications for the Store feature using Savvy Bulk SMS LTD.

## Step 1: Create Database Table

Run the SQL migration file on your cPanel MySQL database:

**File:** `backend-api/MIGRATION_SMS_CONFIG.sql`

This creates the `sms_config` table to track which company codes have SMS enabled.

```sql
-- The table structure
CREATE TABLE sms_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ccode VARCHAR(50) NOT NULL UNIQUE,
  sms_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## Step 2: Configure Environment Variable

Add your Savvy Bulk SMS API key to your server's environment variables:

1. In cPanel, go to **Terminal** or **SSH**
2. Navigate to your project directory
3. Edit or create `.env` file:
   ```bash
   nano .env
   ```
4. Add the following line:
   ```
   SAVVY_BULK_SMS_API_KEY=your_api_key_here
   ```
5. Save and exit (Ctrl+X, Y, Enter)

**Alternative Method (cPanel File Manager):**
1. Open cPanel File Manager
2. Navigate to your project root
3. Create/edit `.env` file
4. Add: `SAVVY_BULK_SMS_API_KEY=your_api_key_here`

## Step 3: Enable SMS for Company Codes

To enable SMS for specific company codes, you need to insert/update records in the `sms_config` table:

**Option A: Using phpMyAdmin**
1. Open phpMyAdmin in cPanel
2. Select your database
3. Run this SQL:
   ```sql
   INSERT INTO sms_config (ccode, sms_enabled) 
   VALUES ('AC', TRUE) 
   ON DUPLICATE KEY UPDATE sms_enabled = TRUE;
   ```
   Replace `'AC'` with your actual company code.

**Option B: Using API Endpoint**
```bash
curl -X POST https://milkcollection.maddasystems.co.ke/api/sms/config \
  -H "Content-Type: application/json" \
  -d '{
    "ccode": "AC",
    "sms_enabled": true
  }'
```

## API Endpoints

### 1. Check SMS Configuration
**Endpoint:** `GET /api/sms/config?ccode=AC`

**Response:**
```json
{
  "success": true,
  "data": {
    "ccode": "AC",
    "sms_enabled": true
  }
}
```

### 2. Update SMS Configuration
**Endpoint:** `POST /api/sms/config`

**Request Body:**
```json
{
  "ccode": "AC",
  "sms_enabled": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "SMS configuration updated"
}
```

### 3. Send SMS
**Endpoint:** `POST /api/sms/send`

**Request Body:**
```json
{
  "phone": "254712345678",
  "message": "Thank you for your purchase!",
  "ccode": "AC"
}
```

**Response:**
```json
{
  "success": true,
  "message": "SMS sent successfully",
  "response": {
    "success": true,
    "clientsmsid": "1234567890"
  }
}
```

## SMS Format

When a product is sold to a farmer, the SMS will be in this format:

```
POLYTANO: Product purchase recorded. Item: [Product Name], Qty: [Quantity], Amount: KES [Amount]. Thank you!
```

**Sender ID:** POLYTANO

## Phone Number Format

The system expects phone numbers in international format:
- ✅ Correct: `254712345678` (12 digits starting with 254)
- ❌ Wrong: `0712345678` (local format)
- ❌ Wrong: `+254712345678` (with plus sign)

The frontend will automatically convert local numbers (07xx) to international format (2547xx).

## Testing SMS

To test SMS functionality:

1. **Enable SMS for test company:**
   ```sql
   INSERT INTO sms_config (ccode, sms_enabled) VALUES ('AC', TRUE);
   ```

2. **Test API call:**
   ```bash
   curl -X POST https://milkcollection.maddasystems.co.ke/api/sms/send \
     -H "Content-Type: application/json" \
     -d '{
       "phone": "254712345678",
       "message": "Test message from POLYTANO",
       "ccode": "AC"
     }'
   ```

3. **Check response:** You should receive a success response and the SMS should be delivered.

## Troubleshooting

### SMS Not Sending
1. Check if `SAVVY_BULK_SMS_API_KEY` is set in environment variables
2. Verify SMS is enabled for the company code in `sms_config` table
3. Check server logs for errors
4. Verify phone number is in correct format (254xxxxxxxxx)

### API Key Issues
1. Verify API key is correct
2. Check if API key has sufficient credits
3. Contact Savvy Bulk SMS support for account issues

### Database Issues
1. Verify `sms_config` table exists
2. Check if company code exists in `psettings` table
3. Verify database connection

## Security Notes

- ✅ API key is stored in environment variables (not in code)
- ✅ SMS is only sent if enabled for the specific company code
- ✅ Phone numbers are validated before sending
- ✅ All SMS requests are logged for auditing

## Cost Considerations

- Each SMS costs based on Savvy Bulk SMS pricing
- Only enabled company codes will send SMS (controlled via `sms_config` table)
- Monitor SMS credits regularly

## Support

For SMS provider issues:
- **Provider:** Savvy Bulk SMS LTD
- **Website:** https://sms.textsms.co.ke
- **Support:** Contact your account manager

For technical issues:
- Check server logs: `/path/to/your/app/logs/error.log`
- Check API response codes
- Verify database configuration
