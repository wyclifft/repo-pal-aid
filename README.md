# DeliCoop101 - Milk Collection App 🥛

Offline-capable milk collection management system for dairy farmers and collectors.

**Android Application ID:** `app.delicoop101`

## Features

- ✅ **Offline Support**: Full offline functionality with encrypted local database
- 🔍 **Farmer Search**: Real-time autocomplete search for farmers
- ⚖️ **Bluetooth Scale Integration**: Connect to Bluetooth scales (HC-05, HM-10)
- 📋 **Receipt Management**: Track and sync pending collections
- 🔄 **Auto-Sync**: Automatically syncs data when online
- 📱 **Native Android App**: Built with Capacitor for native performance
- 📊 **Export Data**: Export receipts as TXT or CSV files
- 🔐 **Encrypted Database**: SQLCipher encryption for data at rest

## Database Tables

### farmers
- farmer_id (Primary Key)
- name
- route
- route_name

### app_users
- user_id (Primary Key)
- password
- role

### milk_collection
- farmer_id
- route
- section (AM/PM)
- weight
- collected_by
- price_per_liter
- total_amount
- collection_date

## Usage

1. **Login**: Use your user ID and password (works offline after first login)
2. **Search Farmer**: Start typing farmer ID or name to see suggestions
3. **Enter Weight**: Connect Bluetooth scale or enter manually
4. **Save Collection**: Data saves locally and syncs when online
5. **View Receipts**: Check pending receipts and sync status

## Offline Capabilities

- Login with previously saved credentials
- Search farmers from local cache
- Save milk collections locally
- Auto-sync when connection restored

---

## 🔐 Accessing the Encrypted Database (Developer Guide)

The Android app uses **SQLCipher** to encrypt the local Room database. This guide explains how to extract and open the database for debugging.

### Database Location

```
/data/data/app.delicoop101/databases/delicoop101_database
```

### Encryption Key Location

The 64-character hex encryption key is stored in SharedPreferences:

```
/data/data/app.delicoop101/shared_prefs/delicoop_db_prefs.xml
```

Look for the `db_encryption_key` field.

### Step-by-Step Extraction

#### 1. Connect Device to Android Studio

- Open Android Studio
- Connect your Android device via USB (with USB debugging enabled)
- Open **View → Tool Windows → Device File Explorer**

#### 2. Extract the Database File

1. Navigate to: `/data/data/app.delicoop101/databases/`
2. Right-click on `delicoop101_database`
3. Select **Save As...** and save to your computer

#### 3. Extract the Encryption Key

1. Navigate to: `/data/data/app.delicoop101/shared_prefs/`
2. Right-click on `delicoop_db_prefs.xml`
3. Select **Save As...** and save to your computer
4. Open the XML file and copy the value of `db_encryption_key`

Example XML content:
```xml
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="db_encryption_key">a1b2c3d4e5f6...64_hex_characters</string>
</map>
```

#### 4. Open with DB Browser for SQLCipher

1. Download [DB Browser for SQLCipher](https://sqlitebrowser.org/dl/)
2. Open the application
3. Click **Open Database**
4. Select the extracted `delicoop101_database` file
5. When prompted for encryption settings:
   - **Encryption**: SQLCipher 4
   - **Password**: Paste the 64-character hex key from step 3
   - Leave other settings as default
6. Click **OK** to open the database

### Database Tables

| Table | Description |
|-------|-------------|
| `sync_records` | Offline transactions pending sync |
| `app_logs` | Application logs (batched, async) |

### Troubleshooting

- **"Database is encrypted or not a database"**: Ensure you're using DB Browser for **SQLCipher** (not regular SQLite Browser)
- **Wrong password**: Double-check the hex key from the XML file
- **File not found**: Ensure the app has been run at least once to create the database

---

## Project info

**URL**: https://lovable.dev/projects/a468e475-ee6a-4fda-9a7e-5e39ba8c375e

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/a468e475-ee6a-4fda-9a7e-5e39ba8c375e) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
- Capacitor (Native Android)
- Room Database with SQLCipher (Encrypted Storage)
- IndexedDB (Web Offline Storage)
- Web Bluetooth API
- Service Workers (PWA)

## Building the Android App

```sh
# Sync Capacitor
npx cap sync android

# Open in Android Studio
npx cap open android

# Build APK
./gradlew assembleDebug
```

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/a468e475-ee6a-4fda-9a7e-5e39ba8c375e) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
