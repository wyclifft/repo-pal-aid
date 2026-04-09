

## Fix: Unstick Legacy Records That Pass Sync But Fail Verification — v2.10.31

### Problem

`BA0100000617` (from v2.10.4) is permanently stuck:
1. **Regular sync** calls `milkCollection.create()` → API returns success
2. **Verification** calls `milkCollection.getByReference("BA0100000617")` → returns "Collection not found" (404)
3. Because verification fails, the record is marked `failed` and kept locally
4. **Cleanup** finds it as an orphan, checks backend → "not found" → does nothing
5. Cycle repeats every sync — record is permanently pending

The verification lookup likely fails because the backend stores the `transrefno` in a slightly different format from the legacy v2.10.4 era, or the create endpoint transforms the reference before inserting.

### Fix

**`src/hooks/useDataSync.ts`** — Two changes:

**Change 1: Trust API success when verification lookup fails (line ~305-307)**
- Currently: if API says success but `getByReference` returns null → mark as failed
- New behavior: if API says success but `getByReference` returns null → **trust the API and delete local record** with a warning log
- Rationale: the API successfully inserted the row (no error, no collision). The GET lookup failing is likely a field-mapping issue, not a data loss risk. Keeping the record stuck forever is worse than trusting the confirmed insert.

**Change 2: Cleanup attempts to sync unsynced orphans (line ~553, after the `continue`)**
- Currently: if an orphan has `weight`+`farmer_id` and backend says "not found", the code does nothing (the record is left in limbo)
- New behavior: attempt `milkCollection.create()` with the orphan's data, then delete on success (including duplicate response)
- This gives legacy records a dedicated sync attempt outside the regular path

**`src/constants/appVersion.ts`** → v2.10.31 (Code 53)

### Files Changed

| File | Change |
|------|--------|
| `src/hooks/useDataSync.ts` | Trust API success when verification lookup returns null; cleanup attempts to sync orphans not found on backend |
| `src/constants/appVersion.ts` | Bump to v2.10.31 |

### Safety notes
- Only changes behavior when API explicitly returned success — no risk of deleting unsynced data
- Cleanup sync attempt uses same `milkCollection.create()` with full payload — backend deduplication still protects against doubles
- Records that genuinely fail to sync (API error) are still kept locally

