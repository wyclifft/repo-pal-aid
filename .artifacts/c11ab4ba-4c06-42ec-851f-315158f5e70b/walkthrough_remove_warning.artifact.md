# Walkthrough - Removed zeroOpt Warning Banner

I have removed the amber warning banner that appeared when the `zeroOpt` capture protection was active.

## Changes

### UI Cleanup
- **BuyProduceScreen**: Removed the amber warning banner that displayed "Clear weight to continue" when `zeroOptBlocked` was true.
- **SellProduceScreen**: Removed the same amber warning banner for consistency.

The underlying capture protection logic remains active: the Capture button will still be disabled until the scale returns to ≤0.5 kg, but it will now do so silently without the intrusive banner.

## Verification

### UI Verification
- [x] Verified that `zeroOptBlocked` state no longer renders the amber banner.
- [x] Verified that the Capture button still respects the `zeroOptBlocked` state (disables correctly).
