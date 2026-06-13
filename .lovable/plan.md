# v2.10.118 — Auto-Heal Stale Rejections When Online

v2.10.117 stops bad decreases but caches that are already too high never converge. This patch lets a backend write win when (a) the device is online and (b) the write came from a user/sync-driven fetch. Everything else keeps STALE-REJECT behaviour.

---

## Behaviour

Inside `updateFarmerCumulative` (the single writer), when a backend write would otherwise be rejected:

```text
if  fromBackend === true
and !options.allowDecrease
and newValue < prevValue
and navigator.onLine === true
and verifySource ∈ { W1:postsync-refresh, W4:on-select-fetch, W5:postcapture-refresh }
→ emit pinned `CUM:STALE-RECONCILE` and WRITE the lower value (auto-heal)
else
→ existing STALE-REJECT behaviour (unchanged)
```

| Writer | Online heal? | Offline |
|---|---|---|
| W1 post-sync refresh | yes | reject |
| W4 on-select fetch | yes | reject |
| W5 post-capture refresh | yes | reject |
| W2 collision-retry | reject | reject |
| W3 prewarm batch | reject | reject |
| W6 on-screen print | reject | reject |
| W7 background print | reject | reject |
| local capture | n/a (never decreases via this path) | n/a |

No 3×/60s observation window. No manual heal button. No new tabs. Receipt math untouched.

---

## Logging

`CUM:STALE-RECONCILE` (pinned warn) carries the same ctx as STALE-REJECT plus:
`healedFrom = prevValue`, `healedTo = newValue`, `delta`, `verifySource`, `caller`, `route`, `factory`, `deviceCode`, `sessionId`, `online: true`, `writeSeq`.

`localCount` is preserved across the heal. `writeSeq` increments. `lastWriteSource = 'backend-heal'`.

---

## Files touched

```text
src/utils/cumulativeMonitor.ts   add logStaleReconcile() helper (pinned warn, tag CUM:STALE-RECONCILE)
src/hooks/useIndexedDB.ts        in updateFarmerCumulative rejection branch, add online+writer gate;
                                 on heal fall through to put() with reconcile logging, preserve localCount,
                                 bump writeSeq, set lastWriteSource='backend-heal'
src/pages/DebugConsole.tsx       Cumulative tab: add sibling panel
                                 "Auto-heal reconciliations (24h)" listing CUM:STALE-RECONCILE rows,
                                 same row schema and one-tap copy as the existing rejection panel
src/constants/appVersion.ts      2.10.118, code 139, tag "auto-heal-online-stale-reject"
android/app/build.gradle         versionCode 139 / versionName "2.10.118"
.lovable/plan.md                 replace with this plan
```

## Untouched

Backend / server.js, MySQL schema, IndexedDB schema (no version bump), sync engine, reference generator, receipt math, local capture, photo, Bluetooth, auth, Z-report, All-Logs tab UI, Capacitor config.

## Production safety

- Single writer site changed; existing call sites and signatures unchanged.
- `options.allowDecrease` semantics unchanged.
- Offline path identical to v2.10.117.
- Web + Capacitor identical (uses `navigator.onLine`, already in use elsewhere).

## Verification matrix

| # | Scenario | Expected |
|---|---|---|
| 1 | M00001 repro online, force sync | one `CUM:STALE-RECONCILE` from W1; cache heals to backend value; next print correct |
| 2 | M00001 repro offline | `CUM:STALE-REJECT` only; cache unchanged |
| 3 | Healthy device (BA01 pattern) | only STALE-CHECK accepts; zero RECONCILE; zero REJECT |
| 4 | W3 prewarm sees stale-lower value | STALE-REJECT (not healed) |
| 5 | W6/W7 print path | STALE-REJECT (not healed); receipt math intact |
| 6 | Two rapid captures online | baseCount monotonic; no spurious heals |
| 7 | WRITE → VERIFY → CAPTURE-READ → PRINT after heal | all four report the healed value |

Ready for build mode.
