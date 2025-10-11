# Milk Collection App 🥛

Offline-capable milk collection management system for dairy farmers and collectors.

## Features

- ✅ **Offline Support**: Full offline functionality with IndexedDB storage
- 🔍 **Farmer Search**: Real-time autocomplete search for farmers
- ⚖️ **Bluetooth Scale Integration**: Connect to Bluetooth scales (HC-05, HM-10)
- 📋 **Receipt Management**: Track and sync pending collections
- 🔄 **Auto-Sync**: Automatically syncs data when online
- 📱 **PWA Ready**: Install as a mobile app
- 📊 **Export Data**: Export receipts as TXT or CSV files

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
- Supabase (Backend & Database)
- IndexedDB (Offline Storage)
- Web Bluetooth API
- Service Workers (PWA)

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/a468e475-ee6a-4fda-9a7e-5e39ba8c375e) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
