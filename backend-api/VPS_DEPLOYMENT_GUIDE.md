# Complete VPS High-Concurrency Deployment Guide

This guide details how to deploy the **Milk Collection API** on a dedicated or virtual private server (VPS running Ubuntu/Debian/CentOS) for maximum speed and support for **10,000+ concurrent active users**.

---

## 🔒 Backward Compatibility Guarantee

All changes in this guide and in `backend-api/server.js`:
- ✅ Maintain **100% backward compatibility** with older APKs and web app versions.
- ✅ Require **no changes** to request/response structures, authorization tokens, or payload formats.
- ✅ Allow seamless zero-downtime deployments without forcing users out of active milk collection sessions.

---

## 🚀 Step-by-Step VPS Setup

### Step 1: Install Node.js, PM2, and Nginx

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js (v18 or v20 LTS recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx mariadb-server git

# Install PM2 globally
sudo npm install -g pm2
```

---

### Step 2: Configure PM2 Cluster Mode

Copy `ecosystem.config.js` into your backend deployment directory (`/var/www/milk-collection-api/` or `~/milk-collection-api/`).

```bash
cd /var/www/milk-collection-api
npm install --production

# Start application in cluster mode
pm2 start ecosystem.config.js

# Save process list so PM2 restores automatically on server reboot
pm2 save
sudo pm2 startup
```

> **Verification:** Run `pm2 status`. You should see one worker process per CPU core (e.g. `online` status across instances 0, 1, 2, 3).

---

### Step 3: Configure Nginx Reverse Proxy

1. Copy `nginx.conf.example` to `/etc/nginx/sites-available/api`:
   ```bash
   sudo cp nginx.conf.example /etc/nginx/sites-available/api
   ```
2. Enable site:
   ```bash
   sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/
   sudo rm /etc/nginx/sites-enabled/default
   ```
3. Issue SSL Certificate via Certbot:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d backend.maddasystems.co.ke
   ```
4. Test and reload Nginx:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

### Step 4: Tune MariaDB / MySQL Server (`my.cnf`)

Edit `/etc/mysql/mariadb.conf.d/50-server.cnf` (or `/etc/mysql/my.cnf`):

```ini
[mysqld]
# Max concurrent connections
max_connections = 300

# InnoDB RAM Buffer Pool (Set to ~60% of server RAM)
# 4GB RAM VPS  -> 2560M
# 8GB RAM VPS  -> 5120M
# 16GB RAM VPS -> 10240M
innodb_buffer_pool_size = 2560M

# Log and Transaction Performance
innodb_log_file_size = 512M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT

# Temporary In-Memory Tables
tmp_table_size = 64M
max_heap_table_size = 64M

# Thread caching
thread_cache_size = 32
open_files_limit = 65535
```

Restart MariaDB / MySQL:
```bash
sudo systemctl restart mariadb
```

---

### Step 5: Tune Linux OS Network Stack

Edit `/etc/sysctl.conf`:
```bash
sudo nano /etc/sysctl.conf
```

Add these lines at the bottom:
```ini
net.core.somaxconn = 4096
net.ipv4.ip_local_port_range = 10240 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
fs.file-max = 2097152
```

Apply immediately:
```bash
sudo sysctl -p
```

---

## 🔄 Zero-Downtime Application Updates

When updating backend code in the future:
```bash
cd /var/www/milk-collection-api
git pull
npm install --production

# Reload all cluster instances one by one with zero downtime
pm2 reload milk-collection-api
```

---

## 📊 Monitoring & Logs

* **PM2 Real-Time Monitor:**
  ```bash
  pm2 monit
  ```
* **View Aggregated Server Logs:**
  ```bash
  pm2 logs milk-collection-api
  ```
* **Check Health Endpoint:**
  ```bash
  curl https://backend.maddasystems.co.ke/api/health
  ```
