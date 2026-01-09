# Photo Capture Setup for Store Sales

This document explains how to set up the photo capture feature for store sales to prevent unauthorized pickups.

## Overview

During a store sale, the clerk captures a photo of the buyer. The photo is:
1. Uploaded to a dedicated folder on the cPanel server
2. Only the filename and directory path are stored in the `transactions` table
3. Each photo is linked to its specific transaction for audit purposes

## Database Migration

Run this SQL to add the required columns to the `transactions` table:

```sql
-- Add photo storage columns to transactions table
ALTER TABLE transactions
ADD COLUMN photo_filename VARCHAR(255) NULL DEFAULT NULL COMMENT 'Filename of captured buyer photo (e.g., SALE-1234567890_1234567890.jpg)',
ADD COLUMN photo_directory VARCHAR(255) NULL DEFAULT NULL COMMENT 'Directory path on server (e.g., uploads/store-photos/2026/01)';

-- Add index for quick lookups by photo
ALTER TABLE transactions
ADD INDEX idx_photo_filename (photo_filename);
```

## cPanel Folder Setup

### Step 1: Create the Images Folder

1. Log in to cPanel
2. Open **File Manager**
3. Navigate to your API directory (e.g., `/home/maddasys/public_html/sync-service/`)
4. Create a new folder called `uploads`
5. Inside `uploads`, create a subfolder called `store-photos`

**Final structure:**
```
/home/maddasys/public_html/sync-service/
├── uploads/
│   └── store-photos/
│       └── 2026/           (auto-created by API)
│           └── 01/         (auto-created by API)
│               └── SALE-1234567890_1234567890.jpg
├── server.js
└── ...
```

### Step 2: Set Permissions

1. Right-click the `uploads` folder
2. Select **Change Permissions**
3. Set permissions to `755` (rwxr-xr-x)
4. Check "Recurse into subdirectories"
5. Click **Change Permissions**

### Step 3: Secure the Folder (Optional but Recommended)

Create an `.htaccess` file inside the `uploads` folder with:

```apache
# Prevent directory listing
Options -Indexes

# Only allow image file types
<FilesMatch "\.(jpg|jpeg|png|gif)$">
    Order Allow,Deny
    Allow from all
</FilesMatch>

# Deny all other files
<FilesMatch "^(?!.*\.(jpg|jpeg|png|gif)$)">
    Order Deny,Allow
    Deny from all
</FilesMatch>
```

## How It Works

### 1. Photo Capture Flow

1. Clerk selects member and adds items to cart
2. Clerk clicks "Complete Sale"
3. Camera dialog opens - clerk captures buyer's photo
4. Photo is uploaded to server along with sale data
5. Transaction is recorded with photo filename and directory

### 2. API Endpoint

**POST /api/sales**

The existing sales endpoint now accepts:
- `photo` (base64 string): The captured photo in base64 format
- All existing sale fields

The API:
1. Decodes the base64 image
2. Generates a unique filename: `{sale_ref}_{timestamp}.jpg`
3. Creates year/month subdirectories automatically
4. Saves the file to `uploads/store-photos/YYYY/MM/`
5. Stores only the filename and directory in the database

### 3. Audit & Verification

To retrieve a transaction's photo:

```sql
SELECT 
    transrefno,
    memberno,
    photo_filename,
    photo_directory,
    CONCAT(photo_directory, '/', photo_filename) as full_path
FROM transactions
WHERE Transtype = 'STORE' AND photo_filename IS NOT NULL
ORDER BY transdate DESC;
```

The full URL to access a photo would be:
```
https://your-domain.com/sync-service/uploads/store-photos/2026/01/SALE-1234567890_1234567890.jpg
```

## Security Considerations

1. **File Validation**: The API validates that uploaded data is a valid JPEG image
2. **Filename Sanitization**: Filenames are generated server-side, not from user input
3. **Directory Structure**: Year/month folders prevent too many files in one directory
4. **No Database Blobs**: Only paths are stored, not actual image data
5. **Access Control**: `.htaccess` restricts access to image files only

## Offline Handling

When offline:
1. Photo is stored locally in IndexedDB along with the sale data
2. When connection is restored, both sale and photo are synced
3. The photo is uploaded first, then the sale is recorded

## Troubleshooting

### "Permission denied" error
- Check folder permissions are `755`
- Ensure the PHP/Node process has write access

### Photos not displaying
- Verify the `uploads` folder is within the web root
- Check `.htaccess` isn't blocking image access

### Large file sizes
- Photos are compressed to 85% JPEG quality
- Consider adding server-side image resizing if needed
