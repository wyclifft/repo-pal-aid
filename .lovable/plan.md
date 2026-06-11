# v2.10.110 — Fix Passenger "Can't acquire lock" on sync-service deploy

## Problem

Your only Node app is registered in cPanel as:

```
Domain : 2backend.maddasystems.co.ke
Path   : /home/maddasys/public_html/sync-service
Node   : 19.9.0   (status: started)
```

This directory hosts the **backend-api** code (the live `/api/devices/...` calls in the network log prove it).

After uploading the v2.10.109 `server.js` + `.htaccess`, Passenger fails with:

```
Can't acquire lock for app: public_html/sync-service
```

### Root cause

`sync-service/.htaccess` declares the Node binary **twice**, with different versions:

```apache
# top block (auto-managed by cPanel) — Node 19
PassengerNodejs "/home/maddasys/nodevenv/public_html/sync-service/19/bin/node"
...
# bottom block (manual, legacy) — Node 14
PassengerNodejs /opt/alt/alt-nodejs14/root/usr/bin/node
```

Apache uses the **last** `PassengerNodejs` directive, so Passenger tries to spawn the app under Node 14 while cPanel's app registry has it pinned to Node 19. The two fight for the same Passenger app lockfile, neither side wins, and `Restart` returns *Can't acquire lock for app*.

A secondary risk: the duplicate `PassengerEnabled / PassengerAppRoot / PassengerAppType / PassengerStartupFile` block below the auto-managed header is redundant and increases the chance of Passenger refusing to (re)register the app.

## Fix (file changes)

### 1. `sync-service/.htaccess` — keep one Node, one Passenger block

- Keep ONLY the cPanel-managed Passenger header block (Node 19).
- Delete the second `PassengerEnabled / PassengerAppRoot / PassengerAppType / PassengerStartupFile / PassengerNodejs` block.
- Keep all `SetEnv` lines (MySQL creds, pool tunables, CORS module, OPTIONS rewrite, `<FilesMatch>` protection, `<IfModule Litespeed>` env block).
- Result: a single, unambiguous Node 19 declaration that matches what cPanel's Node Selector has registered.

### 2. `backend-api/.htaccess` — preventive cleanup

Same duplicate-block pattern exists. Collapse to a single Passenger header + SetEnv block so a future redeploy of that app does not hit the same lock error.

### 3. `src/constants/appVersion.ts` + `android/app/build.gradle`

- Bump app version to **v2.10.110 (Code 131)**.
- Changelog note: *"Fix Passenger app-lock failure caused by duplicate PassengerNodejs directives in .htaccess; backend deploy is now lock-safe. No client logic changes."*

### 4. `.lovable/memory/architecture/backend-connection-pooling.md`

Append a short subsection **"Passenger .htaccess discipline"** capturing the rule: only ONE `PassengerNodejs` and ONE Passenger app block per `.htaccess`, always matching the Node version registered in cPanel's Node Selector. This prevents the next deploy from re-introducing the bug.

## Recovery steps the user runs on cPanel (one-time, after uploading the fixed .htaccess)

1. **Setup Node.js App → 2backend.maddasystems.co.ke → Stop App**.
2. **Terminal** (or SSH):
   ```bash
   # kill any stale node worker still holding the lock
   pkill -u $USER -f "public_html/sync-service/server.js" || true
   # clear the Passenger restart lock if present
   rm -f ~/public_html/sync-service/tmp/restart.txt
   rm -f ~/public_html/sync-service/tmp/*.lock 2>/dev/null || true
   ```
3. Re-upload `server.js` and the **fixed** `.htaccess`.
4. **Setup Node.js App → Run NPM Install** (only if `package.json` changed; for v2.10.109 it did not).
5. **Start App** → wait until status shows *started*.
6. Sanity check:
   ```bash
   curl -i https://2backend.maddasystems.co.ke/api/health
   curl -i https://2backend.maddasystems.co.ke/api/devices/fingerprint/<any-known-fp>
   ```

## What this does NOT change

- `backend-api/server.js` (already deployed in v2.10.109).
- `MIGRATION_APPROVED_DEVICES_HW.sql` (already executed).
- Client login flow, device fingerprint logic, reference generator, sync engine.
- MySQL pool sizing (`MYSQL_POOL_LIMIT 8` for backend-api, `5` for sync-service stays).

## Rollback

If the fixed `.htaccess` causes any new symptom, restore the previous version from the repo and Stop/Start the app. The change is config-only and reversible.

## Risk

Very low: removing conflicting/duplicate directives, no code paths touched, no schema work, no API surface change. Old APKs continue to work.
