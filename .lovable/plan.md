## Goal

Make the **ID NO** and **SIGN** writing lines on the printed Store/AI purchase receipt longer and roomier so users can comfortably hand-write an ID number and signature.

Scope: print output only — `printStoreAIReceipt` in `src/services/bluetooth.ts`, lines 2335–2336. No backend, no on-screen UI changes, no business logic.

## Current state

```
ID NO: _________________________   (label + 25 underscores)
SIGN:  _________________________
```

Only ~25 underscore characters for handwriting — too cramped, and the two fields sit back-to-back with no vertical breathing room.

## Change

Restructure each field as **label on its own line followed by a single full-width underscore line**, with a blank line between the two fields for vertical writing room:

```
ID NO:
________________________________
                                 <- blank line for writing height
SIGN:
________________________________
```

Implementation:
- Replace lines 2335–2336 with a small block emitting, for each field:
  - the label line (`ID NO:` / `SIGN:`)
  - one underscore line spanning the full printer column width using `'_'.repeat(W)` (W = 32) so it scales with the existing width constant.
- Insert a single blank `'\n'` between the ID block and the SIGN block to leave breathing room for handwriting.

Result on a 32-col printer:
- ID NO: ~32 underscores of writing space (vs 25 today).
- SIGN: ~32 underscores of writing space, with a clear blank gap above it for the ID number to be written into.

## Versioning

Per workspace rule, bump:
- `src/constants/appVersion.ts` → `2.10.80` (version code 102)
- `android/app/build.gradle` → matching versionName / versionCode
- `public/sw.js` cache → `v27`

## Verification

- Reprint a Store/AI receipt and confirm:
  - `ID NO:` label sits on its own line with a long underscore line beneath it.
  - A blank line separates ID NO from SIGN.
  - `SIGN:` label sits on its own line with one long underscore line beneath it.
  - Layout above (header, items, TOTAL, Region, Clerk) is unchanged.
- Reprint a milk Periodic/standard receipt to confirm it is unaffected (no ID/SIGN block there).

## Files touched

- `src/services/bluetooth.ts` (only `printStoreAIReceipt`, lines ~2335–2336)
- `src/constants/appVersion.ts`
- `android/app/build.gradle`
- `public/sw.js`
