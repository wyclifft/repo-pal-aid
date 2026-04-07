
## Fix: Store printOption + ZeroOpt Button + Receipt Optimization — v2.10.17

### Bug 1: Store ignores `psettings.printOption`

**Problem**: `src/pages/Store.tsx` never imports or uses `useAppSettings`. The `TransactionReceipt` component receives no `printCopies` prop, so it defaults to `1` — always printing regardless of `psettings.printoptions`.

**Fix** in `src/pages/Store.tsx`:
- Import and use `useAppSettings` to get `printCopies` and `companyName`
- Pass `printCopies` into `createStoreReceiptData` receipt data
- When `printCopies === 0`, the `TransactionReceipt` already handles showing on-screen instead of printing

### Bug 2: Buy/Sell portals — Capture button not visually disabled when zeroOpt blocks

**Problem**: `zeroOptBlocked` is passed as a prop and shows a warning banner, but the Capture button only checks `captureDisabled || weight <= 0`. Users can still tap Capture and get a toast error instead of seeing a disabled button.

**Fix** in `src/components/BuyProduceScreen.tsx` and `src/components/SellProduceScreen.tsx`:
- Add `zeroOptBlocked` to the Capture button's `disabled` condition
- Update the className opacity condition to match

### Bug 3: Optimize store receipt for space savings

**Problem**: The printed receipt uses wide label padding (14 chars) and a redundant duplicate timestamp at the bottom.

**Fix** in `src/services/bluetooth.ts` (`printStoreAIReceipt`):
- Use compact 10-char labels (matching milk receipt style): `MNO`, `Name`, `Ref`, `Date`, `Total[KES]`, `Region`, `Clerk`
- Remove the duplicate timestamp line at the bottom

### Feature: Add ID NO and SIGN fields to store receipt

Based on the receipt photo, "ID NO ___" and "SIGN ___" fields are being handwritten. These should be printed automatically.

**Fix** in `src/services/bluetooth.ts`:
- After the Clerk line, print two blank signature fields with underlines

Also update the on-screen receipt in `TransactionReceipt.tsx` to show these fields.

### Version bump
`src/constants/appVersion.ts` → v2.10.17

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Store.tsx` | Import `useAppSettings`, pass `printCopies` to receipt data |
| `src/components/BuyProduceScreen.tsx` | Disable Capture button when `zeroOptBlocked` |
| `src/components/SellProduceScreen.tsx` | Disable Capture button when `zeroOptBlocked` |
| `src/services/bluetooth.ts` | Compact labels, remove duplicate timestamp, add ID NO/SIGN fields |
| `src/components/TransactionReceipt.tsx` | Add ID NO/SIGN fields to on-screen store receipt |
| `src/constants/appVersion.ts` | Bump to v2.10.17 |
