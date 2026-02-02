# Delicoop101 Database Extraction Guide

This guide explains how to extract and view the encrypted SQLCipher database from a connected Android device using Android Studio on Windows.

## Prerequisites

- **Android Studio** installed on Windows
- **USB Debugging** enabled on the Android device
- **DB Browser for SQLite** with SQLCipher support installed
  - Download from: https://sqlitebrowser.org/dl/
  - Make sure to get the version that includes SQLCipher support

---

## Step 1: Connect Your Android Device

1. Connect your Android device to your Windows PC via USB
2. Enable **USB Debugging** on your device:
   - Go to **Settings → About Phone**
   - Tap **Build Number** 7 times to enable Developer Options
   - Go to **Settings → Developer Options**
   - Enable **USB Debugging**
3. When prompted on your device, allow USB debugging from your computer

---

## Step 2: Open Device File Explorer in Android Studio

1. Open **Android Studio**
2. Go to **View → Tool Windows → Device File Explorer**
3. Select your connected device from the dropdown at the top
4. Wait for the file system to load

---

## Step 3: Locate the Database Files

The Delicoop101 database is located at:

```
/data/data/app.delicoop101/databases/
```

Inside this folder, you'll find:
- `delicoop101_database` - The main encrypted database file
- `delicoop101_database-shm` - Shared memory file (WAL mode)
- `delicoop101_database-wal` - Write-ahead log file

**Note:** You need to export ALL THREE files to properly read the database.

---

## Step 4: Export the Database Files

1. In Device File Explorer, navigate to `/data/data/app.delicoop101/databases/`
2. Right-click on `delicoop101_database` → **Save As...**
3. Choose a folder on your computer (e.g., `C:\DelicopDatabase\`)
4. Repeat for `delicoop101_database-shm` and `delicoop101_database-wal` if they exist
5. Save all files to the same folder

---

## Step 5: Get the Encryption Password

The database is encrypted using SQLCipher. The encryption key is stored in the app's SharedPreferences.

### Location of the Encryption Key:

```
/data/data/app.delicoop101/shared_prefs/delicoop_db_prefs.xml
```

### To Extract the Key:

1. In Device File Explorer, navigate to `/data/data/app.delicoop101/shared_prefs/`
2. Right-click on `delicoop_db_prefs.xml` → **Save As...**
3. Open the file in any text editor (Notepad, VS Code, etc.)
4. Look for the `db_encryption_key` entry:

```xml
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="db_encryption_key">YOUR_64_CHARACTER_HEX_KEY_HERE</string>
</map>
```

5. Copy the 64-character hex string - this is your database password

### Example Key Format:
```
a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

---

## Step 6: Open the Database with DB Browser for SQLite

1. Open **DB Browser for SQLite**
2. Click **File → Open Database**
3. Navigate to your exported `delicoop101_database` file
4. When prompted for encryption:
   - Select **SQLCipher 4** as the encryption type
   - Paste your 64-character hex key as the password
   - Click **OK**

### If the Database Doesn't Open:

Try these SQLCipher settings:
- **Page Size:** 4096
- **KDF Iterations:** 256000
- **HMAC Algorithm:** SHA512
- **KDF Algorithm:** SHA512

---

## Step 7: Browse the Data

Once opened, you can:

1. **Browse Data:** Click the "Browse Data" tab to view table contents
2. **Execute SQL:** Click "Execute SQL" to run custom queries
3. **Export Data:** Right-click on a table → Export as CSV

### Main Table: `sync_records`

| Column | Description |
|--------|-------------|
| `id` | Auto-increment primary key |
| `reference_no` | Unique transaction reference |
| `record_type` | Type of record (transaction, etc.) |
| `payload` | JSON data of the record |
| `created_at` | Timestamp when created |
| `is_synced` | Whether synced to server |
| `sync_attempts` | Number of sync attempts |
| `last_error` | Last sync error message |

---

## Troubleshooting

### "Permission Denied" Error in Device File Explorer

The app's data folder is protected. You have two options:

**Option A: Use a Debug Build**
Debug builds allow access via Device File Explorer without root.

**Option B: Use ADB Commands (Requires Root or Debug Build)**
```bash
# List database files
adb shell run-as app.delicoop101 ls -la /data/data/app.delicoop101/databases/

# Copy database to accessible location
adb shell run-as app.delicoop101 cp /data/data/app.delicoop101/databases/delicoop101_database /sdcard/

# Pull from device
adb pull /sdcard/delicoop101_database C:\DelicopDatabase\

# Get the encryption key
adb shell run-as app.delicoop101 cat /data/data/app.delicoop101/shared_prefs/delicoop_db_prefs.xml
```

### Database Won't Open

1. Ensure you have the correct SQLCipher version (4.x)
2. Verify the password is exactly 64 characters
3. Make sure you copied all database files (main + shm + wal)
4. Try closing the app on the device before exporting

### "run-as" Command Fails

This happens on release builds. Options:
1. Install a debug build instead
2. Use a rooted device
3. Use Android backup/restore functionality

---

## Quick Reference

| Item | Location |
|------|----------|
| **Database** | `/data/data/app.delicoop101/databases/delicoop101_database` |
| **Encryption Key** | `/data/data/app.delicoop101/shared_prefs/delicoop_db_prefs.xml` |
| **Key Name** | `db_encryption_key` |
| **Encryption** | SQLCipher 4.x |
| **Key Format** | 64-character hexadecimal string |

---

## Security Warning

⚠️ **The encryption key provides full access to all app data.** Keep it secure and never share it publicly. The key is unique per device installation - uninstalling and reinstalling the app generates a new key.
