

## Plan: Fix Offline Per-Product Cumulative

### Problem
Three places call `updateFarmerCumulative` with `fromBackend=true` but **don't pass `byProduct`**, causing the cached per-product breakdown to be wiped to `[]`:

1. **`src/pages/Index.tsx` line 378** — batch pre-fetch on mount (main sync path)
2. **`src/pages/Index.tsx` line 440** — individual fallback fetch
3. **`src/components/FarmerSyncDashboard.tsx` line 93** — dashboard refresh

When the app goes offline, `getFarmerTotalCumulative` reads `cached.byProduct` (now `[]`) and only has unsynced local receipts for breakdown — losing all previously synced product data.

### Fix

#### 1. `src/pages/Index.tsx` — Batch pre-fetch (line 378)
Extract `by_product` from the batch response (same pattern as line 241) and pass it:
```ts
const byProd = batchResult.data.farmers.find(f => f.farmer_id.trim() === fId)?.by_product || [];
await updateFarmerCumulative(fId, weight, true, byProd);
```

#### 2. `src/pages/Index.tsx` — Individual fallback (line 440)
Pass `by_product` from the individual API response:
```ts
await updateFarmerCumulative(fId, res.data.cumulative_weight ?? 0, true, res.data.by_product || []);
```

#### 3. `src/components/FarmerSyncDashboard.tsx` (line 93)
Pass `by_product` from batch data (requires the batch response to include it — it already does from the server fix):
```ts
await updateFarmerCumulative(fId, f.cumulative_weight, true, f.by_product || []);
```

These are three small, surgical fixes. No new logic, no new interfaces — just passing data that's already available but currently dropped.

