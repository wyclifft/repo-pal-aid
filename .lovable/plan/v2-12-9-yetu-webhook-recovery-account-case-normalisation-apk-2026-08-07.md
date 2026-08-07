# v2.12.9 — Yetu webhook recovery, account case-normalisation, APK update check

Two topics: (A) the failed Yetu deposits in the shared CSV plus case handling of
invoice numbers, and (B) why the v2.12.8 APK will not install over v2.10.121.

---

## A. Yetu webhook — what the CSV actually shows

All 66 rows are `http_status = 500`, `outcome = error`, with the same
`error_message`: **`Column 'ccode' cannot be null`**. That is a database error,
not a payload problem. v2.12.8 deliberately inserts `ccode = NULL` for deposits
whose account is not found in `sacco_members`, and the accompanying migration
(section 6 of `MIGRATION_YETU_SACCO.sql`, `MODIFY COLUMN ccode VARCHAR(20) NULL`)
has evidently not been applied to the production database — so every unallocated
deposit is rejected with a 500 and nothing is stored.

Note this also means Yetu received a failure envelope for each of these, so they
may re-send some of them.

### A1. Run the pending migration (required first step)

Apply section 6 of `backend-api/MIGRATION_YETU_SACCO.sql` on the Contabo MariaDB:
`sacco_transactions.ccode` nullable, `sacco_members.account_number` and
`Users.link_account` widened. Nothing else changes.

### A2. Case-insensitive invoice numbers

Matching in `resolveMember()` already upper-cases both sides, so `7136#t008`
resolves the same as `7136#T008`. What is *not* normalised is storage: the
account is written to `sacco_transactions.account_number_raw` exactly as typed,
so the same member's deposits appear under mixed spellings in exports and in any
future direct query.

Change: keep the raw payload untouched in `raw_payload`, but store a canonical
`account_number_raw` — trimmed, inner spaces removed, upper-cased. Portal reads
already compare with `UPPER(TRIM(...))`, so existing rows keep working.

### A3. Manual retry file for Postman

Produce `/mnt/documents/yetu-retry-<date>.json` from the CSV containing every
failed `raw_body` as a JSON array, plus a short README block with the endpoint,
method, HTTP Basic auth header note and content type taken from the logged
headers. Each entry keeps its original `TransRef`, so replaying after the
migration is safe: the unique key on `transaction_reference` makes a repeat a
no-op duplicate rather than a double credit.

Order of operations: run A1 → deploy A2 → replay the JSON.

---

## B. APK update failure (v2.10.121 → v2.12.8)

`android/app/build.gradle` has **no `signingConfigs` block and no
`signingConfig` on the release build type**, so release APKs are produced
unsigned (or signed with whatever key the machine's build happens to use).
Android refuses to install an update whose signing certificate differs from the
installed app — the usual symptom is "App not installed" or
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`. The applicationId (`app.delicoop101`) and
versionCode (184 > 121-era) are both fine, so signing is the leading candidate.

Plan:

1. Confirm the cause on the device before changing anything: capture
   `adb install -r` output / logcat, and compare the installed app's signer with
   the new APK's (`apksigner verify --print-certs`).
2. If the signature differs — add a documented `signingConfigs.release` block
   reading keystore path/passwords from `gradle.properties` or environment
   variables (never committed), wired to `buildTypes.release`, so every future
   build is signed with the one production key. Document the keystore
   requirement in `CAPACITOR_BUILD_GUIDE.md`.
3. If the original keystore is unavailable, the only path is uninstall +
   reinstall on each device; the plan will then cover a safe rollout note
   (offline data lives in the app sandbox, so a backup/export step is called out
   before uninstalling).
4. If the logcat shows a different reason (ABI, minSdk, storage), fix that
   instead — no signing change made blindly.

---

## Technical notes

- `backend-api/yetuService.js` — add `canonicalAccount()` and use it for the
  stored `account_number_raw` and for the `resolveMember()` lookup argument.
  No change to `resolveMember`'s SQL, to the webhook response envelope, or to
  the allocated/unallocated decision.
- No frontend behaviour change; portal queries are already case-insensitive.
- `android/app/build.gradle` — signing config only, after step B1 confirms it.
- Version bump to **v2.12.9 (code 185)** in `src/constants/appVersion.ts` and
  `android/app/build.gradle`; `public/sw.js` cache to `v59`.
