import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, AlertCircle, RefreshCw, Users, Database, Loader2, Search } from 'lucide-react';
import type { Farmer } from '@/lib/supabase';

interface FarmerSyncEntry {
  farmer_id: string;
  name: string;
  route: string;
  cumulativeTotal: number;
  baseCount: number;
  localCount: number;
  isCached: boolean;
}

const BATCH_SIZE = 20; // Process farmers in batches of 20
const PAGE_SIZE = 50; // Show 50 farmers at a time in the list

export const FarmerSyncDashboard = () => {
  const { getFarmers, getFarmerCumulative, getUnsyncedReceipts, isReady } = useIndexedDB();
  const [entries, setEntries] = useState<FarmerSyncEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [progressInfo, setProgressInfo] = useState({ current: 0, total: 0, status: '' });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const cancelledRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!isReady) return;
    cancelledRef.current = false;
    setIsLoading(true);
    setVisibleCount(PAGE_SIZE);
    setProgressInfo({ current: 0, total: 0, status: 'Fetching farmers list...' });

    try {
      const [farmers, unsyncedReceipts] = await Promise.all([
        getFarmers(),
        getUnsyncedReceipts(),
      ]);

      setUnsyncedCount(unsyncedReceipts.filter((r: any) => r.orderId !== 'PRINTED_RECEIPTS').length);

      const deviceCcode = localStorage.getItem('device_ccode') || '';
      const filteredFarmers = deviceCcode
        ? farmers.filter((f: Farmer) => f.ccode === deviceCcode)
        : farmers;

      const total = filteredFarmers.length;
      setProgressInfo({ current: 0, total, status: `Processing 0 of ${total} farmers...` });

      const results: FarmerSyncEntry[] = [];

      // Process in batches to avoid blocking the main thread
      for (let i = 0; i < filteredFarmers.length; i += BATCH_SIZE) {
        if (cancelledRef.current) break;
        
        const batch = filteredFarmers.slice(i, i + BATCH_SIZE);
        
        // Process batch concurrently
        const batchResults = await Promise.all(
          batch.map(async (farmer) => {
            const cumData = await getFarmerCumulative(farmer.farmer_id);
            return {
              farmer_id: farmer.farmer_id,
              name: farmer.name || '',
              route: farmer.route || 'N/A',
              cumulativeTotal: cumData ? cumData.baseCount + cumData.localCount : 0,
              baseCount: cumData?.baseCount || 0,
              localCount: cumData?.localCount || 0,
              isCached: !!cumData,
            };
          })
        );
        
        results.push(...batchResults);

        // Update progress once per batch (not per farmer)
        const processed = Math.min(i + BATCH_SIZE, filteredFarmers.length);
        setProgressInfo({
          current: processed,
          total,
          status: `Processing ${processed} of ${total} farmers...`,
        });

        // Yield to main thread between batches
        if (i + BATCH_SIZE < filteredFarmers.length) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      // Sort: cached first, then by name
      results.sort((a, b) => {
        if (a.isCached !== b.isCached) return a.isCached ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      // Single state update with final results
      setEntries(results);
      setProgressInfo({ current: total, total, status: 'Complete' });
    } catch (err) {
      console.error('Failed to load farmer sync data:', err);
      setProgressInfo(prev => ({ ...prev, status: 'Error loading data' }));
    } finally {
      setIsLoading(false);
    }
  }, [isReady, getFarmers, getFarmerCumulative, getUnsyncedReceipts]);

  useEffect(() => {
    loadData();
    return () => { cancelledRef.current = true; };
  }, [loadData]);

  const cachedCount = entries.filter(e => e.isCached).length;
  const totalCount = entries.length;
  const syncPercentage = totalCount > 0 ? Math.round((cachedCount / totalCount) * 100) : 0;
  const loadProgress = progressInfo.total > 0
    ? Math.round((progressInfo.current / progressInfo.total) * 100)
    : 0;

  const deviceCcode = localStorage.getItem('device_ccode') || '';

  const filtered = useMemo(() => {
    const base = searchQuery
      ? entries.filter(e =>
          e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.farmer_id.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : entries;
    return base;
  }, [entries, searchQuery]);

  // Only render visible portion
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
                Cumulative data for <span className="font-medium">{deviceCcode || 'all'}</span> cached offline
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
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

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 rounded-lg bg-primary/10">
            <Users className="h-4 w-4 mx-auto mb-1 text-primary" />
            <p className="text-lg font-bold">{totalCount}</p>
            <p className="text-xs text-muted-foreground">Total Farmers</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-green-600" />
            <p className="text-lg font-bold">{cachedCount}</p>
            <p className="text-xs text-muted-foreground">Cached</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-orange-500/10">
            <AlertCircle className="h-4 w-4 mx-auto mb-1 text-orange-600" />
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
            {totalCount === 0 ? 'No farmers cached locally for this device\'s company code.' : 'No matching farmers found.'}
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
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
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
                        <p className="text-xs text-orange-600">+{entry.localCount.toFixed(1)} local</p>
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
          Showing farmers for company code: <span className="font-medium">{deviceCcode || 'all'}</span>
        </p>
      </CardContent>
    </Card>
  );
};
