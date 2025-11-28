import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Database, RefreshCw, Trash2, HardDrive, Wifi, WifiOff, AlertCircle, CheckCircle, Download, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useDataSync } from '@/hooks/useDataSync';
import { useAutoBackup } from '@/hooks/useAutoBackup';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DataManagement = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [cacheStats, setCacheStats] = useState({
    farmers: 0,
    items: 0,
    receipts: 0,
    sales: 0,
    zReports: 0,
    periodicReports: 0,
    totalSize: '0 KB'
  });
  const [isClearing, setIsClearing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { db, isReady } = useIndexedDB();
  const { syncAllData, isSyncing, lastSyncTime } = useDataSync();
  const { settings: backupSettings, updateSettings: updateBackupSettings, performBackup, getTimeUntilNextBackup } = useAutoBackup();

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Check authentication
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Load cache statistics
  useEffect(() => {
    if (isReady && db) {
      loadCacheStats();
    }
  }, [isReady, db]);

  const loadCacheStats = async () => {
    if (!db) return;

    try {
      const stores = ['farmers', 'items', 'receipts', 'sales', 'z_reports', 'periodic_reports'];
      const stats: any = {};
      let totalItems = 0;

      for (const storeName of stores) {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const count = await new Promise<number>((resolve, reject) => {
          const request = store.count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        
        const key = storeName === 'z_reports' ? 'zReports' : 
                     storeName === 'periodic_reports' ? 'periodicReports' : 
                     storeName;
        stats[key] = count;
        totalItems += count;
      }

      // Estimate size (rough calculation)
      const estimatedSize = totalItems * 0.5; // Assume ~0.5 KB per item average
      stats.totalSize = estimatedSize > 1024 
        ? `${(estimatedSize / 1024).toFixed(2)} MB` 
        : `${estimatedSize.toFixed(2)} KB`;

      setCacheStats(stats);
    } catch (error) {
      console.error('Error loading cache stats:', error);
    }
  };

  const handleClearCache = async () => {
    if (!db) {
      toast.error('Database not ready');
      return;
    }

    const confirmed = window.confirm(
      '⚠️ Are you sure you want to clear all cached data?\n\nThis will remove:\n• Farmers list\n• Store items\n• Z Reports\n• Periodic Reports\n\nNote: Pending receipts and sales will NOT be deleted.'
    );

    if (!confirmed) return;

    setIsClearing(true);
    try {
      // Clear all stores except receipts and sales (pending data)
      const storesToClear = ['farmers', 'items', 'z_reports', 'periodic_reports'];
      
      for (const storeName of storesToClear) {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        await new Promise<void>((resolve, reject) => {
          const request = store.clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }

      toast.success('Cache cleared successfully');
      await loadCacheStats();
    } catch (error) {
      console.error('Error clearing cache:', error);
      toast.error('Failed to clear cache');
    } finally {
      setIsClearing(false);
    }
  };

  const handleForceSync = async () => {
    toast.info('Starting data sync...');
    const success = await syncAllData(false);
    if (success) {
      await loadCacheStats();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <header className="bg-white/10 backdrop-blur-md shadow-lg sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 py-3">
          <Button onClick={() => navigate('/')} variant="ghost" size="sm" className="text-white hover:bg-white/20">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Database className="h-6 w-6" />
            Data Management
          </h1>
          <div className="w-20"></div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Connection Status */}
          <Card className="bg-white/95 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isOnline ? (
                    <Wifi className="h-8 w-8 text-green-600" />
                  ) : (
                    <WifiOff className="h-8 w-8 text-orange-600" />
                  )}
                  <div>
                    <div className="text-sm text-gray-600">Connection</div>
                    <div className="text-xl font-bold">
                      {isOnline ? 'Online' : 'Offline'}
                    </div>
                  </div>
                </div>
                <Badge variant={isOnline ? "default" : "secondary"} className={isOnline ? "bg-green-600" : "bg-orange-600"}>
                  {isOnline ? <CheckCircle className="h-4 w-4 mr-1" /> : <AlertCircle className="h-4 w-4 mr-1" />}
                  {isOnline ? 'Connected' : 'Cached Mode'}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Last Sync Info */}
          <Card className="bg-white/95 backdrop-blur-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <RefreshCw className={`h-8 w-8 ${isSyncing ? 'animate-spin text-blue-600' : 'text-gray-600'}`} />
                <div>
                  <div className="text-sm text-gray-600">Last Sync</div>
                  <div className="text-lg font-bold">
                    {lastSyncTime ? lastSyncTime.toLocaleTimeString() : 'Never'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cache Statistics */}
        <Card className="bg-white/95 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              Cache Statistics
            </CardTitle>
            <CardDescription>
              Current data stored in local cache for offline access
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">Farmers</div>
                <div className="text-2xl font-bold text-blue-600">{cacheStats.farmers}</div>
              </div>
              <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">Store Items</div>
                <div className="text-2xl font-bold text-green-600">{cacheStats.items}</div>
              </div>
              <div className="p-4 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">Pending Receipts</div>
                <div className="text-2xl font-bold text-orange-600">{cacheStats.receipts}</div>
              </div>
              <div className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">Pending Sales</div>
                <div className="text-2xl font-bold text-purple-600">{cacheStats.sales}</div>
              </div>
              <div className="p-4 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">Z Reports</div>
                <div className="text-2xl font-bold text-indigo-600">{cacheStats.zReports}</div>
              </div>
              <div className="p-4 bg-gradient-to-br from-pink-50 to-pink-100 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">Periodic Reports</div>
                <div className="text-2xl font-bold text-pink-600">{cacheStats.periodicReports}</div>
              </div>
            </div>
            <div className="mt-6 p-4 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border border-gray-200">
              <div className="text-sm text-gray-600">Estimated Total Size</div>
              <div className="text-xl font-bold text-gray-700">{cacheStats.totalSize}</div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <Card className="bg-white/95 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Data Actions</CardTitle>
            <CardDescription>
              Manage your local cache and sync data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Force Sync */}
            <div className="flex items-start justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
              <div className="flex-1">
                <div className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  Force Data Refresh
                  {!isOnline && <Badge variant="secondary" className="text-xs">Offline</Badge>}
                </div>
                <div className="text-sm text-gray-600">
                  {isOnline 
                    ? 'Sync all data from server: farmers, items, reports.'
                    : 'Internet connection required to sync data from server.'
                  }
                </div>
              </div>
              <Button 
                onClick={handleForceSync} 
                disabled={isSyncing || !isOnline}
                className="ml-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Refresh'}
              </Button>
            </div>

            {/* Clear Cache */}
            <div className="flex items-start justify-between p-4 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
              <div className="flex-1">
                <div className="font-semibold text-red-900 mb-1">Clear Cached Data</div>
                <div className="text-sm text-red-600">
                  Remove farmers, items, and reports from local cache. Pending receipts and sales are preserved.
                </div>
              </div>
              <Button 
                onClick={handleClearCache} 
                disabled={isClearing}
                variant="destructive"
                className="ml-4"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {isClearing ? 'Clearing...' : 'Clear Cache'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Automatic Backup */}
        <Card className="bg-white/95 backdrop-blur-sm border-2 border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-blue-600" />
              Automatic Data Backup
            </CardTitle>
            <CardDescription>
              Automatically export pending receipts to device storage
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Enable/Disable Backup */}
            <div className="flex items-center justify-between p-4 border rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50">
              <div className="flex-1">
                <Label htmlFor="backup-enabled" className="text-base font-semibold text-gray-900">
                  Enable Auto Backup
                </Label>
                <p className="text-sm text-gray-600 mt-1">
                  Automatically save pending receipts at regular intervals
                </p>
              </div>
              <Switch
                id="backup-enabled"
                checked={backupSettings.enabled}
                onCheckedChange={(enabled) => updateBackupSettings({ enabled })}
              />
            </div>

            {backupSettings.enabled && (
              <>
                {/* Backup Frequency */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Backup Frequency</Label>
                  <Select
                    value={backupSettings.frequency}
                    onValueChange={(frequency: 'hourly' | 'daily' | 'weekly') => 
                      updateBackupSettings({ frequency })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Every Hour</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Backup Format */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Export Format</Label>
                  <Select
                    value={backupSettings.format}
                    onValueChange={(format: 'txt' | 'csv' | 'both') => 
                      updateBackupSettings({ format })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="txt">Text File (.txt)</SelectItem>
                      <SelectItem value="csv">CSV File (.csv)</SelectItem>
                      <SelectItem value="both">Both Formats</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Backup Status */}
                <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Last Backup</div>
                      <div className="text-sm font-semibold flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {backupSettings.lastBackup 
                          ? new Date(backupSettings.lastBackup).toLocaleString()
                          : 'Never'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Next Backup</div>
                      <div className="text-sm font-semibold flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {getTimeUntilNextBackup()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Manual Backup Button */}
                <Button
                  onClick={() => performBackup(false)}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  size="lg"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Backup Now
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-blue-50/50 border-blue-200">
            <CardContent className="pt-6">
              <div className="space-y-2 text-sm text-gray-700">
                <p className="font-semibold text-blue-900 flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Offline Mode
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>All pages work offline with cached data</li>
                  <li>Receipts sync automatically when online</li>
                  <li>Auto-sync runs every 5 minutes</li>
                  <li>Data preserved between app restarts</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-green-50/50 border-green-200">
            <CardContent className="pt-6">
              <div className="space-y-2 text-sm text-gray-700">
                <p className="font-semibold text-green-900 flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  Cache Management
                </p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Clear cache if data seems outdated</li>
                  <li>Pending receipts never deleted</li>
                  <li>Force refresh to update all data</li>
                  <li>Safe to clear cache anytime</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default DataManagement;
