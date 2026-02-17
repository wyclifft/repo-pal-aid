import { useState, useEffect, useCallback } from 'react';
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

export const FarmerSyncDashboard = () => {
  const { getFarmers, getFarmerCumulative, getUnsyncedReceipts, isReady } = useIndexedDB();
  const [entries, setEntries] = useState<FarmerSyncEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [unsyncedCount, setUnsyncedCount] = useState(0);

  const loadData = useCallback(async () => {
    if (!isReady) return;
    setIsLoading(true);
    try {
      const [farmers, unsyncedReceipts] = await Promise.all([
        getFarmers(),
        getUnsyncedReceipts(),
      ]);

      setUnsyncedCount(unsyncedReceipts.filter((r: any) => r.orderId !== 'PRINTED_RECEIPTS').length);

      const results: FarmerSyncEntry[] = [];
      for (const farmer of farmers) {
        const cumData = await getFarmerCumulative(farmer.farmer_id);
        results.push({
          farmer_id: farmer.farmer_id,
          name: farmer.name || '',
          route: farmer.route || 'N/A',
          cumulativeTotal: cumData ? cumData.baseCount + cumData.localCount : 0,
          baseCount: cumData?.baseCount || 0,
          localCount: cumData?.localCount || 0,
          isCached: !!cumData,
        });
      }

      // Sort: cached first, then by name
      results.sort((a, b) => {
        if (a.isCached !== b.isCached) return a.isCached ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setEntries(results);
    } catch (err) {
      console.error('Failed to load farmer sync data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isReady, getFarmers, getFarmerCumulative, getUnsyncedReceipts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const cachedCount = entries.filter(e => e.isCached).length;
  const totalCount = entries.length;
  const syncPercentage = totalCount > 0 ? Math.round((cachedCount / totalCount) * 100) : 0;

  const filtered = searchQuery
    ? entries.filter(e =>
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.farmer_id.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : entries;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Farmer Sync Status</CardTitle>
              <CardDescription>Cumulative data cached for offline use</CardDescription>
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
        {isLoading ? (
          <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading farmer data...</span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {totalCount === 0 ? 'No farmers cached locally yet. Go to the collection screen to sync.' : 'No matching farmers found.'}
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1">
            {filtered.map((entry) => (
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
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center">
          Cached farmers have their monthly cumulative totals stored locally for accurate offline receipts.
        </p>
      </CardContent>
    </Card>
  );
};
