

## Block multOpt=0 duplicate captures with a clear modal — v2.10.61

### Problem

Today, when an operator (online or offline) tries to re-select a `multOpt=0` farmer who already has a delivery this session/day, the app:

- Refuses to select the farmer (good — no capture, no receipt)
- Shows a small toast that disappears in 5s (bad — operators miss it under bright sunlight, or while the printer is running)

You want a **persistent, unmissable modal/card** that the operator must explicitly dismiss, making it crystal clear *why* the farmer can't be captured again. Receipt generation is already prevented; this is purely a UX visibility upgrade.

### Where the blocking happens today (post-v2.10.60)

`src/components/BuyProduceScreen.tsx`:
- `resolveFarmerId()` (lines 202–252) — when typed/scanned, returns `null` and shows toast
- `handleSelectFarmer()` (lines 292–302) — when picked from search modal, returns early and shows toast

Both correctly stop the flow before `onSelectFarmer` propagates to `Index.tsx` → so no capture, no receipt, no IndexedDB row. The fix is purely the **UX surface** at these two gates.

### Fix — replace toast with a blocking AlertDialog

#### 1. New component: `src/components/DuplicateDeliveryDialog.tsx`

A small, focused `AlertDialog` (uses existing `@/components/ui/alert-dialog.tsx`) with:

- Header icon: amber `AlertTriangle` (Lucide)
- Title: **"Already Delivered This Session"**
- Body: structured info card showing
  - Farmer ID + Name (large, bold)
  - Session label (AM / PM for dairy, season name for coffee)
  - Date (today, formatted)
  - The reference of the existing receipt when known (else "Synced delivery on record")
  - Subtext: *"This farmer is set to one delivery per session (multOpt=0). Capture is blocked until the next session."*
- Single CTA: **"OK, Got It"** (no destructive option — this is informational, not actionable)
- Offline-aware footnote when `!navigator.onLine`: *"You're offline. The earlier delivery is saved locally and will sync when you reconnect."*
- Includes `AlertDialogDescription` for accessibility
- Cannot be dismissed by clicking outside or ESC by accident — only the OK button (matches the existing `SessionExpiredDialog` pattern)

Props:
```ts
interface DuplicateDeliveryDialogProps {
  open: boolean;
  farmer: { id: string; name: string } | null;
  sessionLabel: string;        // "AM", "PM", or season descript like "Main Season"
  reason: 'blacklist' | 'queue' | 'session-submitted';
  onClose: () => void;
}
```

The `reason` lets us tweak the subtext slightly:
- `blacklist` → "Already submitted (synced or pending sync)"
- `queue` → "Already in this session's capture queue"
- `session-submitted` → "Already submitted in this session"

#### 2. Wire it into `BuyProduceScreen.tsx`

- Add state: `const [duplicateDialog, setDuplicateDialog] = useState<{ farmer; reason } | null>(null)`
- Replace each of the **four** `toast.error("…has already delivered…")` calls (lines 215, 230, 244, 296) with `setDuplicateDialog({ farmer: …, reason: … })`
- Determine `reason` in `isFarmerBlocked()` by which branch matched (return a small object instead of just `boolean`, or expose a sibling helper `getBlockReason(farmerId)`)
- Render `<DuplicateDeliveryDialog … />` near the bottom of the JSX (next to `FarmerSearchModal`)
- Pass a friendly `sessionLabel` derived from:
  - Coffee (`isCoffee` from `useAppSettings`): `session.descript || session.scode || 'Current Season'`
  - Dairy: `getSessionType()` → "AM" or "PM"
- After dismissal, also call `onClearFarmer()` and clear `memberNo` so the input is ready for the next farmer (matches existing post-block behaviour)

#### 3. Keep the toast as a redundant *short* fallback (optional, recommended)

Some POS hardware delays modal rendering by ~200ms while the camera/printer hold the main thread. To avoid an awkward silent gap, keep a 2-second toast under the modal trigger (existing toast.error stays, just shortened). The modal is the primary surface; the toast is secondary. If you'd rather have a *single* surface, we drop the toast — your call (default in this plan: keep both, modal is primary).

#### 4. SellProduceScreen — leave alone

Per memory `multopt-session-blocking-rules`: Sell Portal (`transtype=2`) is exempt from multOpt blocking. No changes there.

#### 5. Receipt generation — already prevented

`onSelectFarmer` is not called when the gate trips → `farmerId`/`farmerName` in `Index.tsx` stays empty → `handleCapture()` early-returns at its existing farmer-required guard → no `MilkCollection` created → no IndexedDB row → no receipt printed/displayed. **No changes needed in capture/submit/print paths.**

#### 6. Version bump (per workspace rule)

- `src/constants/appVersion.ts` → **v2.10.61** (Code **83**) with comment *"v2.10.61 — multOpt=0 duplicate capture: replace toast with persistent AlertDialog so operators cannot miss the block."*
- `android/app/build.gradle` → `versionName "2.10.61"`, `versionCode 83`

### Files Touched

| File | Change |
|---|---|
| `src/components/DuplicateDeliveryDialog.tsx` | **NEW** — AlertDialog component (uses existing `@/components/ui/alert-dialog`) |
| `src/components/BuyProduceScreen.tsx` | Add dialog state + render; keep `isFarmerBlocked` logic untouched; replace 4 toast.error calls with `setDuplicateDialog(...)`; pass session label from `useAppSettings().isCoffee` + `session` |
| `src/constants/appVersion.ts` | Bump to v2.10.61 (Code 83) + changelog comment |
| `android/app/build.gradle` | `versionName "2.10.61"`, `versionCode 83` |

### What does NOT change

- Backend (`server.js`) — untouched
- `useSessionBlacklist.ts` — already correct after v2.10.60 (org-aware, local-date)
- `useDataSync.ts` — already correct after v2.10.60 (no silent drops)
- `Dashboard.tsx` "⚠ stuck receipts" chip — untouched
- IndexedDB schema, reference generator, sync engine, photo audit, Z-Reports — untouched
- Sell Portal (`transtype=2`) — still no blocking
- `multOpt=1` farmers — zero behaviour change

### Verification Checklist

1. **Online, multOpt=0**: capture+submit `M00123` for AM → re-select via search → modal appears, OK clears it, no receipt generated. ✓
2. **Offline (dairy)**: capture+submit `M00123` AM offline → close app → reopen offline → re-select → modal appears (Layer 1 from v2.10.60 keeps it blacklisted). ✓
3. **Offline (coffee)**: capture+submit for season `S0002` offline → re-select → modal appears with season name in body. ✓
4. **Re-key by typing** the farmer ID into the input + arrow button → modal appears (covers `resolveFarmerId` paths). ✓
5. **Re-key by typing numeric** (`123` → `M00123`) → modal appears. ✓
6. **Already in capture queue, not yet submitted** → modal appears with `reason='queue'` subtext. ✓
7. **multOpt=1 farmer** → no modal, capture proceeds normally. ✓
8. Sell Portal — unlimited captures, no modal. ✓
9. No new console errors; transactions/sync/receipts/photo audit unchanged.

### Out of scope

- Replacing toasts elsewhere in the app (only the four multOpt=0 blocks change)
- Server-side changes
- Adding a "View existing receipt" button inside the modal (operators can find it in Recent Receipts; can come later if needed)
- Auto-clearing the input on dismiss is included; auto-jumping focus into the search bar is not (preserves current keyboard flow)

