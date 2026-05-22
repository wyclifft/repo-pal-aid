
# Cumulative audit — what the log actually says vs what your device shows

You reported on the device:
- M00003 = **32.1 kg**
- M00001 = **5040.1 kg**
- M00007 = **91.9 kg**

The log says (last refresh for each, route `T001`):
- M00003 = **54.8 kg** (RECALC unchanged, route T001)
- M00001 = **6080.6 kg** (3 products, route T001)
- M00007 = **144.4 kg** (3 products, route T001)

These don't match — and the gap is the whole point of your question.

## The most likely cause: combined vs per-product

Every `[SYNC] ✅ Refreshed cumulative for ...` line ends with `(3 products)`. That total is the **combined cumulative across all icodes** for that farmer (per the `Combined + breakdown by_product` rule). What your device screen shows for an S001 receipt is likely the **per-product (S001 only) total**, which is a subset.

The arithmetic backs this up:
- M00007 combined = 144.4, your S001 display = 91.9 → S001 contributes 91.9 of 144.4 (≈63%)
- M00001 combined = 6080.6, your S001 display = 5040.1 → S001 contributes 5040.1 (≈83%)
- M00003 combined = 54.8, your S001 display = 32.1 → S001 contributes 32.1 (≈59%)

The remainder in each case is the other 2 icodes (the message literally says "3 products"). So **neither number is wrong** — they're two different views (combined vs per-icode), and the log just doesn't tell you which icode the per-product slice belongs to.

## What the log does NOT currently show (and you correctly want it to)

I checked `persistentLogger.ts` — the row schema is:
```
ts, level, tag, message, data, count, route(page), version
```
- The `route` column on every row is the **page route** (`/`, `/settings`) — **not** your selected `tcode` (T001).
- There is **no `icode` field**, **no `scode` field**.
- `tcode` only appears for `CUM:RECALC` rows (in the `data` JSON), and even then `icode` and `scode` are missing.
- `[SYNC] ✅ Refreshed cumulative for ...` messages have no per-icode breakdown — only the combined total + a product count.

So the log can confirm you were on route T001 (from CUM:RECALC rows: `route":"T001"`), but it cannot confirm S001 / S0001 because we never write them.

## And the timestamps

Every row is stored as `ts` (epoch ms) and the CSV export writes ISO/UTC (`2026-05-22T21:29:16.404Z`). That's correct UTC but reads confusingly to a Nairobi-based operator — `21:29 UTC` is `00:29 EAT` the next day, which is exactly why the values you remembered taking at "morning" appear under a date that looks like "next day" in the file. The export filename is already EAT (Africa/Nairobi), only the row timestamps are UTC.

## What I'd change (proposed v2.10.95 — surgical, no API contracts touched)

All four items are local frontend/logging changes only — no schema migrations, no backend changes, no sync logic changes:

1. **Log session context on every cumulative event** — augment `cumulativeMonitor.observeBaseChange` and the SYNC refresh log so each row's `data` JSON carries `{ tcode, icode, scode, ccode }` pulled from `resolveSessionMetadata()` + active dashboard selection. Existing rows stay backward-compatible.
2. **Log per-icode breakdown in the SYNC refresh line** — change `[SYNC] ✅ Refreshed cumulative for M00007: 144.4 kg (3 products)` to `… 144.4 kg [S001:91.9, S002:..., S003:...] tcode=T001 scode=S0001` so the slice you see on screen and the total in the log can be reconciled instantly.
3. **Render timestamps in Africa/Nairobi in the Debug Console UI** — the storage format stays epoch (so logs remain timezone-agnostic and exportable), but `DebugConsole.tsx`'s `LogRow` formats with `Intl.DateTimeFormat(..., { timeZone: "Africa/Nairobi", hour12: false })`. CSV/NDJSON exports get an additional `ts_eat` column so analysis tools also see Kenya time without losing UTC truth.
4. **Header strip on /debug** — show currently-selected `tcode / scode / icode / devcode` at the top of the Cumulative tab, so when you open the log you can confirm at a glance "yes, the device was on T001 / S0001 / S001 when this snapshot was captured".

### Files touched (read-only audit found these are the only files involved)
- `src/utils/persistentLogger.ts` — add `ts_eat` to CSV export, no schema change.
- `src/utils/cumulativeMonitor.ts` — enrich `data` payload with `tcode/icode/scode/ccode`.
- `src/hooks/useDataSync.ts` — enrich `[SYNC] ✅ Refreshed cumulative …` with per-icode breakdown + context.
- `src/pages/DebugConsole.tsx` — EAT formatting in `LogRow`, context strip on Cumulative tab.
- `src/constants/appVersion.ts` + `public/sw.js` + `android/app/build.gradle` — bump to `2.10.95` / code `117` / cache `v42`.

### Stability guarantees (per the production rules)
- No backend changes, no API changes, no IndexedDB schema changes.
- Sync, reference generation, receipts, photo upload, and offline storage are not touched.
- Pure additive enrichment — old logs still render, new logs simply carry more context.

### What this answers about your three farmers
Once #2 lands, the next refresh row will read something like:
```
[SYNC] ✅ Refreshed cumulative for M00003: 54.8 kg [S001:32.1, S00x:..., S00y:...] tcode=T001 scode=S0001
```
…which is exactly the proof point you're looking for — combined matches the engine, S001-slice matches your screen.

Tell me if you want me to implement v2.10.95 as scoped above, or trim it (e.g. only items 1+3, skip the UI strip).
