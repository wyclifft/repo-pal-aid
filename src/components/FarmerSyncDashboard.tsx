import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { mysqlApi } from '@/services/mysqlApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, AlertCircle, RefreshCw, Users, Database, Loader2, Search } from 'lucide-react';
import type { Farmer } from '@/lib/supabase';
import { generateDeviceFingerprint, getStoredDeviceId } from '@/utils/deviceFingerprint';

// Resolve fingerprint via canonical 'device_id' key (legacy 'device_fingerprint' key was wrong).
const resolveFingerprint = async (): Promise<string> => {
  const stored = getStoredDeviceId();
  if (stored) return stored;
  try {
    return await generateDeviceFingerprint();
  } catch {
    return '';
  }
};

interface FarmerSyncEntry {
  farmer_id: string;
  name: string;
  route: string;
  cumulativeTotal: number;
  baseCount: number;
  localCount: number;
  isCached: boolean;
}

const BATCH_SIZE = 20;
const PAGE_SIZE = 50;

const getActiveRoute = (): string => {
  try {
    const data = localStorage.getItem('active_session_data');
    if (data) {
      const parsed = JSON.parse(data);
      return (parsed?.route?.tcode || '').trim();
    }
  } catch {}
  return '';
};

export const FarmerSyncDashboard = () => {
  const { db, getFarmers, getFarmerCumulative, getUnsyncedReceipts, updateFarmerCumulative, isReady } = useIndexedDB();
  const { settings } = useAppSettings();
  const [entries, setEntries] = useState<FarmerSyncEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [progressInfo, setProgressInfo] = useState({ current: 0, total: 0, status: '' });
  const [bgProgress, setBgProgress] = useState<{ current: number; total: number; pass: number } | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const cancelledRef = useRef(false);
  const activeRoute = getActiveRoute();

  /**
   * Build a name lookup map from cm_members (IndexedDB or API).
   * Used only for display names — never for filtering the farmer list.
   */
  const buildNameLookup = useCallback(async (): Promise<Map<string, Farmer>> => {
    const lookup = new Map<string, Farmer>();
    const deviceFingerprint = await resolveFingerprint();

    // Try API first for the most complete list
    if (navigator.onLine && deviceFingerprint) {
      try {
        const response = await mysqlApi.farmers.getByDevice(deviceFingerprint);
        if (response.success && response.data && response.data.length > 0) {
          (response.data as Farmer[]).forEach(f => lookup.set(f.farmer_id.trim(), f));
          console.log(`[SyncDash] Name lookup: ${lookup.size} farmers from API`);
          return lookup;
        }
      } catch (err) {
        console.warn('[SyncDash] API name lookup failed, using IndexedDB:', err);
      }
    }

    // Fallback: IndexedDB cached farmers
    const farmers = await getFarmers();
    farmers.forEach(f => lookup.set(f.farmer_id.trim(), f));
    console.log(`[SyncDash] Name lookup: ${lookup.size} farmers from IndexedDB`);
    return lookup;
  }, [getFarmers]);

  /**
   * Online path: use batch cumulative API as the sole source of the farmer list.
   * Returns null if the batch API call fails (caller should fall back to offline).
   *
   * v2.10.62: On Capacitor (legacy WebView 52 / native HTTP bridge can flake),
   * retry once with a 2s back-off so we stay on the transaction-driven path
   * whenever the network is genuinely available — matching web behaviour.
   */
  const loadFromBatchAPI = useCallback(async (
    nameLookup: Map<string, Farmer>,
    route?: string
  ): Promise<FarmerSyncEntry[] | null> => {
    const deviceFingerprint = await resolveFingerprint();
    if (!deviceFingerprint) return null;

    const isNative = (() => {
      try { return Capacitor.isNativePlatform(); } catch { return false; }
    })();
    const maxAttempts = isNative ? 2 : 1;

    let batchResult: Awaited<ReturnType<typeof mysqlApi.farmerFrequency.getMonthlyFrequencyBatch>> | null = null;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        batchResult = await mysqlApi.farmerFrequency.getMonthlyFrequencyBatch(
          deviceFingerprint,
          route || undefined
        );
        if (batchResult?.success && batchResult.data?.farmers) break;
        if (attempt < maxAttempts) {
          console.warn(`[SyncDash] Batch API attempt ${attempt} failed, retrying in 2s...`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (!batchResult || !batchResult.success || !batchResult.data?.farmers) return null;

      const batchFarmers = batchResult.data.farmers;
      console.log(`[SyncDash] Batch API returned ${batchFarmers.length} farmers${route ? ` for route ${route}` : ''}`);

      const total = batchFarmers.length;
      setProgressInfo({ current: 0, total, status: `Processing 0 of ${total} farmers...` });

      const results: FarmerSyncEntry[] = [];

      for (let i = 0; i < batchFarmers.length; i += BATCH_SIZE) {
        if (cancelledRef.current) break;
        const batch = batchFarmers.slice(i, i + BATCH_SIZE);

        const batchResults = await Promise.all(
          batch.map(async (bf) => {
            const fId = bf.farmer_id.trim();
            const farmerMeta = nameLookup.get(fId);
            const cumData = await getFarmerCumulative(fId, route || activeRoute || undefined);
            return {
              farmer_id: fId,
              name: farmerMeta?.name || fId,
              route: farmerMeta?.route?.trim() || route || 'N/A',
              cumulativeTotal: cumData ? cumData.baseCount + cumData.localCount : bf.cumulative_weight || 0,
              baseCount: cumData?.baseCount || bf.cumulative_weight || 0,
              localCount: cumData?.localCount || 0,
              isCached: !!cumData,
            };
          })
        );
        results.push(...batchResults);

        const processed = Math.min(i + BATCH_SIZE, batchFarmers.length);
        setProgressInfo({ current: processed, total, status: `Processing ${processed} of ${total} farmers...` });
        if (i + BATCH_SIZE < batchFarmers.length) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      return results;
    } catch (err) {
      console.warn('[SyncDash] Batch API failed:', err);
      return null;
    }
  }, [getFarmerCumulative]);

  /**
   * Offline fallback (v2.10.62): transaction-driven, NOT cm_members-driven.
   *
   * Build the farmer list from evidence of activity:
   *   1. All entries in the `farmer_cumulative` IndexedDB store (cached backend totals).
   *   2. All unsynced receipts in IndexedDB (offline captures not yet uploaded).
   *
   * Drop any farmer whose total weight is 0 AND has no unsynced receipts
   * (matches web behaviour — only farmers with transactions appear).
   *
   * Hydrate display name + route from the cm_members `nameLookup` map.
   * Apply the active route filter the same way the online path does.
   */
  const loadFromOfflineCache = useCallback(async (
    nameLookup: Map<string, Farmer>
  ): Promise<FarmerSyncEntry[]> => {
    // 1. Read every farmer_cumulative key currently cached
    const cumulativeEntries: Array<{ farmer_id: string; baseCount: number; localCount: number }> = [];
    if (db) {
      try {
        await new Promise<void>((resolve) => {
          const tx = db.transaction('farmer_cumulative', 'readonly');
          const store = tx.objectStore('farmer_cumulative');
          const req = store.getAll();
          req.onsuccess = () => {
            const all = (req.result || []) as any[];
            for (const r of all) {
              const fid = String(r.farmer_id || '').replace(/^#/, '').trim();
              if (!fid) continue;
              cumulativeEntries.push({
                farmer_id: fid,
                baseCount: Number(r.baseCount || 0),
                localCount: Number(r.localCount || 0),
              });
            }
            resolve();
          };
          req.onerror = () => resolve();
        });
      } catch (err) {
        console.warn('[SyncDash] Failed to read farmer_cumulative store:', err);
      }
    }

    // 2. Union with farmer IDs from unsynced receipts (just-captured offline deliveries)
    const unsyncedReceipts = await getUnsyncedReceipts();
    const unsyncedByFarmer = new Map<string, number>();
    for (const r of unsyncedReceipts) {
      if ((r as any).type === 'sale') continue;
      if ((r as any).transtype === 2) continue;
      const fid = String((r as any).farmer_id || '').replace(/^#/, '').trim();
      if (!fid) continue;
      unsyncedByFarmer.set(fid, (unsyncedByFarmer.get(fid) || 0) + Number((r as any).weight || 0));
    }

    // Build union set of farmer IDs
    const farmerIds = new Set<string>();
    cumulativeEntries.forEach(e => farmerIds.add(e.farmer_id));
    unsyncedByFarmer.forEach((_, fid) => farmerIds.add(fid));

    // Index cumulative entries by farmer ID for O(1) lookup
    const cumulativeMap = new Map<string, { baseCount: number; localCount: number }>();
    for (const e of cumulativeEntries) cumulativeMap.set(e.farmer_id, e);

    const cleanActiveRoute = (activeRoute || '').trim();

    // 3. Build entries — drop zero-weight farmers, hydrate from nameLookup, apply route filter
    const built: FarmerSyncEntry[] = [];
    for (const fid of farmerIds) {
      const cum = cumulativeMap.get(fid);
      const baseCount = cum?.baseCount || 0;
      const localCount = cum?.localCount || 0;
      const unsyncedWeight = unsyncedByFarmer.get(fid) || 0;
      const total = baseCount + localCount + unsyncedWeight;

      // Drop if zero weight AND no unsynced receipts (matches web "with transactions only")
      if (total <= 0 && unsyncedWeight <= 0) continue;

      const meta = nameLookup.get(fid);
      const farmerRoute = (meta?.route || '').trim();

      // Tighten route filter: prefer cm_members route; if missing entirely, still include with 'N/A'
      if (cleanActiveRoute) {
        if (meta && farmerRoute && farmerRoute !== cleanActiveRoute) continue;
        // If meta missing OR route blank — include (don't silently hide transactions)
      }

      built.push({
        farmer_id: fid,
        name: meta?.name || fid,
        route: farmerRoute || 'N/A',
        cumulativeTotal: total,
        baseCount,
        localCount: localCount + unsyncedWeight,
        isCached: !!cum,
      });
    }

    setProgressInfo({ current: built.length, total: built.length, status: `Loaded ${built.length} farmers from offline cache` });
    return built;
  }, [db, getUnsyncedReceipts, activeRoute]);

  const loadData = useCallback(async (triggerSync = false) => {
    if (!isReady) return;
    cancelledRef.current = false;
    setIsLoading(true);
    setVisibleCount(PAGE_SIZE);
    setProgressInfo({ current: 0, total: 0, status: triggerSync ? 'Syncing offline receipts...' : 'Loading...' });

    try {
      // Step 1: Sync offline receipts if requested
      if (triggerSync && navigator.onLine) {
        setProgressInfo({ current: 0, total: 0, status: 'Syncing offline receipts to server...' });
        window.dispatchEvent(new CustomEvent('syncStart'));
        await new Promise(r => setTimeout(r, 2000));

        // Refresh cumulative cache from server
        setProgressInfo({ current: 0, total: 0, status: 'Fetching cumulative totals from server...' });
        const deviceFingerprint = await resolveFingerprint();
        if (deviceFingerprint) {
          try {
            const batchResult = await mysqlApi.farmerFrequency.getMonthlyFrequencyBatch(deviceFingerprint, activeRoute || undefined);
            if (batchResult.success && batchResult.data?.farmers) {
              const batchFarmers = batchResult.data.farmers;
              console.log(`[SyncDash] Batch API returned ${batchFarmers.length} cumulative records for cache refresh`);
              const WRITE_BATCH = 50;
              for (let i = 0; i < batchFarmers.length; i += WRITE_BATCH) {
                const wb = batchFarmers.slice(i, i + WRITE_BATCH);
                await Promise.all(wb.map(async (f) => {
                  await updateFarmerCumulative(f.farmer_id.trim(), f.cumulative_weight, true, f.by_product || [], activeRoute || undefined);
                }));
              }
            }
          } catch (err) {
            console.warn('[SyncDash] Batch cumulative refresh failed:', err);
          }
        }
      }

      // Step 2: Get unsynced receipts count
      const unsyncedReceipts = await getUnsyncedReceipts();
      setUnsyncedCount(unsyncedReceipts.filter((r: any) => r.orderId !== 'PRINTED_RECEIPTS').length);

      // Step 3: Load farmer list — transaction-driven (online) or cached (offline)
      let results: FarmerSyncEntry[] | null = null;

      // Always build name lookup — used by both online and offline paths for display names
      setProgressInfo({ current: 0, total: 0, status: 'Fetching farmer names...' });
      const nameLookup = await buildNameLookup();

      if (navigator.onLine) {
        // Use batch API as the sole source of the farmer list
        setProgressInfo({ current: 0, total: 0, status: 'Fetching transaction data...' });
        results = await loadFromBatchAPI(nameLookup, activeRoute || undefined);
      }

      // Offline fallback or batch API failure — transaction-driven (v2.10.62)
      if (!results) {
        setProgressInfo({ current: 0, total: 0, status: 'Loading from offline cache...' });
        results = await loadFromOfflineCache(nameLookup);
      }

      // Sort: cached first, then alphabetical
      results.sort((a, b) => {
        if (a.isCached !== b.isCached) return a.isCached ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setEntries(results);
      setProgressInfo({ current: results.length, total: results.length, status: 'Complete' });
    } catch (err) {
      console.error('[SyncDash] Failed to load farmer sync data:', err);
      setProgressInfo(prev => ({ ...prev, status: 'Error loading data' }));
    } finally {
      setIsLoading(false);
    }
  }, [isReady, activeRoute, buildNameLookup, loadFromBatchAPI, loadFromOfflineCache, getUnsyncedReceipts, updateFarmerCumulative]);

  useEffect(() => {
    loadData(false);

    const handleProgress = (e: any) => {
      setBgProgress(e.detail);
    };

    window.addEventListener('cumulative-sync-progress', handleProgress);
    
    return () => { 
      cancelledRef.current = true; 
      window.removeEventListener('cumulative-sync-progress', handleProgress);
    };
  }, [loadData]);

  const cachedCount = entries.filter(e => e.isCached).length;
  const totalCount = entries.length;
  const syncPercentage = totalCount > 0 ? Math.round((cachedCount / totalCount) * 100) : 0;
  const loadProgress = progressInfo.total > 0
    ? Math.round((progressInfo.current / progressInfo.total) * 100)
    : 0;

  const deviceCcode = localStorage.getItem('device_ccode') || '';

  const filtered = useMemo(() => {
    return searchQuery
      ? entries.filter(e =>
          e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.farmer_id.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : entries;
  }, [entries, searchQuery]);

  const visibleEntries = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const handleShowMore = useCallback(() => {
    setVisibleCount(prev => prev + PAGE_SIZE);
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Farmer Sync Status</CardTitle>
              <CardDescription>
                Cumulative data for <span className="font-medium">{deviceCcode || 'all'}</span>{activeRoute ? ` · Route: ${activeRoute}` : ''} cached offline
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={isLoading}
            className="gap-1"
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Loading progress */}
        {isLoading && (
          <div className="space-y-2 p-3 rounded-lg bg-muted/50 border">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-muted-foreground">{progressInfo.status}</span>
            </div>
            <Progress value={loadProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-right">{loadProgress}%</p>
          </div>
        )}

        {/* Background Sync Progress */}
        {bgProgress && bgProgress.current < bgProgress.total && (
          <div className="space-y-2 p-3 rounded-lg bg-primary/5 border border-primary/20 animate-pulse">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                <span className="font-medium text-primary">Background Cache Sync</span>
              </div>
              <Badge variant="outline" className="text-[10px] font-normal py-0">Pass {bgProgress.pass}/5</Badge>
            </div>
            <Progress value={(bgProgress.current / bgProgress.total) * 100} className="h-1.5 bg-primary/10" />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{bgProgress.current} / {bgProgress.total} records</span>
              <span>{Math.round((bgProgress.current / bgProgress.total) * 100)}%</span>
            </div>
          </div>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 rounded-lg bg-primary/10">
            <Users className="h-4 w-4 mx-auto mb-1 text-primary" />
            <p className="text-lg font-bold">{totalCount}</p>
            <p className="text-xs text-muted-foreground">Total Farmers</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-primary/10">
            <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-primary" />
            <p className="text-lg font-bold">{cachedCount}</p>
            <p className="text-xs text-muted-foreground">Cached</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-secondary/20">
            <AlertCircle className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{unsyncedCount}</p>
            <p className="text-xs text-muted-foreground">Unsynced Receipts</p>
          </div>
        </div>

        {/* Sync progress */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Offline cache coverage</span>
            <span className="font-medium">{syncPercentage}%</span>
          </div>
          <Progress value={syncPercentage} className="h-2" />
        </div>

        <Separator />

        {/* Search */}
        {totalCount > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search farmers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        {/* Farmer list */}
        {!isLoading && filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {totalCount === 0 ? 'No farmers with transactions found for this selection.' : 'No matching farmers found.'}
          </p>
        ) : !isLoading ? (
          <div className="max-h-64 overflow-y-auto space-y-1">
            {visibleEntries.map((entry) => (
              <div
                key={entry.farmer_id}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {entry.isCached ? (
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate">{entry.name || entry.farmer_id}</p>
                    <p className="text-xs text-muted-foreground">
                      ID: {entry.farmer_id} · Route: {entry.route}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  {entry.isCached ? (
                    <div>
                      <p className="font-semibold">{entry.cumulativeTotal.toFixed(1)} kg</p>
                      {entry.localCount > 0 && (
                        <p className="text-xs text-primary">+{entry.localCount.toFixed(1)} local</p>
                      )}
                    </div>
                  ) : (
                    <Badge variant="secondary" className="text-xs">Not cached</Badge>
                  )}
                </div>
              </div>
            ))}
            {visibleCount < filtered.length && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShowMore}
                className="w-full text-xs text-muted-foreground"
              >
                Show more ({filtered.length - visibleCount} remaining)
              </Button>
            )}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground text-center">
          Showing farmers for company code: <span className="font-medium">{deviceCcode || 'all'}</span>{activeRoute ? ` · Route: ${activeRoute}` : ''}
        </p>
      </CardContent>
    </Card>
  );
};
