import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { mysqlApi, type ZReportData, type DeviceZReportData } from '@/services/mysqlApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Download, Calendar, AlertTriangle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { generateZReportPDF } from '@/utils/pdfExport';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { DeviceAuthStatus } from '@/components/DeviceAuthStatus';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { ZReportReceipt } from '@/components/ZReportReceipt';
import { DeviceZReportReceipt } from '@/components/DeviceZReportReceipt';
import { ZReportPeriodSelector, type ZReportPeriod } from '@/components/ZReportPeriodSelector';
import { ZReportTypeSelector, type ZReportType } from '@/components/ZReportTypeSelector';

const ZReport = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, currentUser } = useAuth();
  
  // Get date from URL or use today
  const dateFromUrl = searchParams.get('date');
  const autoPrint = searchParams.get('autoprint') === 'true';
  const isSessionClose = searchParams.get('sessionclose') === 'true';
  const [selectedDate, setSelectedDate] = useState(dateFromUrl || new Date().toISOString().split('T')[0]);
  const autoPrintTriggeredRef = useRef(false);
  const [hasPrinted, setHasPrinted] = useState(false);
  
  // App settings
  const { sessionPrintOnly, routeLabel, produceLabel, isCoffee, isDairy, weightUnit, weightLabel, periodLabel, companyName } = useAppSettings();
  
  // Sync status tracking for sessprint enforcement
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncComplete, setIsSyncComplete] = useState(true);

  // Receipt preview states
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [showDeviceReceiptPreview, setShowDeviceReceiptPreview] = useState(false);
  const [showPeriodSelector, setShowPeriodSelector] = useState(false);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<ZReportType>('produce');
  const [selectedPeriod, setSelectedPeriod] = useState<ZReportPeriod>('all');
  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState<string>('All Z');
  
  // Device Z Report state (for receipt/print only)
  const [deviceReportData, setDeviceReportData] = useState<DeviceZReportData | null>(null);

  // Check authentication - but don't redirect during session close flow
  useEffect(() => {
    if (!isAuthenticated && !isSessionClose) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate, isSessionClose]);
  const [reportData, setReportData] = useState<ZReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>("");
  
  const { saveZReport, getZReport, getUnsyncedReceipts, getSessions } = useIndexedDB();

  // v2.10.114: Load cached sessions so the Z Report period selector can show
  // one option per session row (matched by transactions.CAN → sessions.SCODE,
  // labeled with sessions.descript). Works offline using whatever the rest
  // of the app (SessionSelector) has already cached.
  const [sessionList, setSessionList] = useState<Array<{ SCODE?: string; descript?: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await getSessions();
        if (!cancelled && Array.isArray(cached)) {
          setSessionList(cached as any);
        }
      } catch (err) {
        console.warn('[Z-REPORT] Failed to load cached sessions:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [getSessions]);

  // Check for pending syncs (for sessprint enforcement)
  useEffect(() => {
    const checkPendingSync = async () => {
      try {
        const unsynced = await getUnsyncedReceipts();
        const receiptsOnly = unsynced.filter((r: any) => r.type !== 'sale');
        setPendingSyncCount(receiptsOnly.length);
        setIsSyncComplete(receiptsOnly.length === 0);
      } catch (err) {
        console.error('Failed to check pending sync:', err);
      }
    };
    
    checkPendingSync();
    
    // Listen for sync events
    const handleSyncComplete = () => checkPendingSync();
    window.addEventListener('syncComplete', handleSyncComplete);
    
    return () => window.removeEventListener('syncComplete', handleSyncComplete);
  }, [getUnsyncedReceipts]);

  useEffect(() => {
    const initDevice = async () => {
      const fingerprint = await generateDeviceFingerprint();
      setDeviceFingerprint(fingerprint);
    };
    initDevice();

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    fetchReport();
    fetchDeviceReport();
  }, [selectedDate, deviceFingerprint]);

  // Fetch device-specific Z Report (for receipt/print output only)
  // Now accepts period filter for server-side filtering
  // v2.10.114: Always fetch the full day's transactions from the backend;
  // period filtering is done client-side by SCODE (transactions.CAN) inside
  // DeviceZReportReceipt. This keeps the backend contract unchanged while
  // supporting any session row defined in the sessions table.
  const fetchDeviceReport = useCallback(async (_period?: ZReportPeriod) => {
    if (!deviceFingerprint || !navigator.onLine) return;

    try {
      const data = await mysqlApi.zReport.getByDevice(selectedDate, deviceFingerprint);
      if (data) {
        // Add clerk name from current user if not set
        if (!data.clerkName || data.clerkName === 'Unknown') {
          data.clerkName = currentUser?.username || 'Clerk';
        }
        setDeviceReportData(data);
        console.log('[Z-REPORT] Device report loaded:', data.transactions.length, 'transactions (client-side period filter applied later)');
      }
    } catch (err) {
      console.error('[Z-REPORT] Failed to fetch device report:', err);
    }
  }, [selectedDate, deviceFingerprint, currentUser]);

  const fetchReport = async () => {
    if (!deviceFingerprint) {
      return;
    }

    setLoading(true);
    
    // 1. ALWAYS load from cache first for instant display
    try {
      const cached = await getZReport(selectedDate);
      if (cached) {
        setReportData(cached);
        setLoading(false);
        console.log('[Z-REPORT] Loaded from cache');
      }
    } catch (cacheError) {
      console.error('Cache read error:', cacheError);
    }

    // 2. Then fetch fresh data in background if online
    if (navigator.onLine) {
      try {
        const data = await mysqlApi.zReport.get(selectedDate, deviceFingerprint);
        if (data) {
          const safeData: ZReportData = {
            date: data.date || selectedDate,
            totals: data.totals || { liters: 0, farmers: 0, entries: 0 },
            byRoute: data.byRoute || {},
            bySession: data.bySession || { AM: { entries: 0, liters: 0 }, PM: { entries: 0, liters: 0 } },
            byCollector: data.byCollector || {},
            collections: data.collections || []
          };
          setReportData(safeData);
          try {
            await saveZReport(selectedDate, safeData);
          } catch (saveErr) {
            console.warn('Failed to cache Z Report:', saveErr);
          }
        }
      } catch (error) {
        console.error('Error syncing report:', error);
      }
    }
    
    setLoading(false);
  };

  // Auto-print when autoprint param is true (triggered by session close with sessPrint=1)
  useEffect(() => {
    if (autoPrint && reportData && !loading && !autoPrintTriggeredRef.current) {
      autoPrintTriggeredRef.current = true;
      console.log('🖨️ Auto-printing Z-report (sessPrint session close)');
      toast.success('Z-report ready - printing...');
      
      // Small delay to ensure UI is rendered
      setTimeout(() => {
        window.print();
        setHasPrinted(true);
      }, 500);
    }
  }, [autoPrint, reportData, loading]);

  // v2.10.97: Inspect device report transactions to decide which Z report types apply.
  // transtype 1 = produce (Coffee/Milk), 2 = SELL, 3 = AI → both 2 & 3 are "store".
  const detectAvailableTypes = useCallback((): { hasProduce: boolean; hasStore: boolean } => {
    const txs = deviceReportData?.transactions || [];
    let hasProduce = false;
    let hasStore = false;
    for (const t of txs) {
      const tt = Number(t.transtype) || 1;
      if (tt === 1) hasProduce = true;
      else if (tt === 2 || tt === 3) hasStore = true;
      if (hasProduce && hasStore) break;
    }
    return { hasProduce, hasStore };
  }, [deviceReportData]);

  // Open the produce flow: dairy → show period selector, otherwise skip to preview.
  const openProduceFlow = useCallback(async () => {
    setSelectedReportType('produce');
    if (isDairy) {
      setShowPeriodSelector(true);
    } else {
      setSelectedPeriod('all');
      setSelectedPeriodLabel('All Z');
      await fetchDeviceReport('all');
      setShowDeviceReceiptPreview(true);
    }
  }, [isDairy, fetchDeviceReport]);

  // Open the store flow: no period selector regardless of orgtype.
  const openStoreFlow = useCallback(async () => {
    setSelectedReportType('store');
    setSelectedPeriod('all');
    setSelectedPeriodLabel('Store Z');
    await fetchDeviceReport('all');
    setShowDeviceReceiptPreview(true);
  }, [fetchDeviceReport]);

  // Handle print button click - choose Z type first, then period if applicable.
  const handlePrintClick = () => {
    console.log('🖨️ Print button clicked', { sessionPrintOnly, isSyncComplete, pendingSyncCount });
    // Enforce sessprint: only show preview if sync is complete
    if (sessionPrintOnly && !isSyncComplete) {
      toast.error(`Cannot print Z-report: ${pendingSyncCount} collection(s) pending sync. Please sync first.`);
      return;
    }

    const { hasProduce, hasStore } = detectAvailableTypes();

    // Only one type of data present → skip the type selector entirely.
    if (hasProduce && !hasStore) {
      void openProduceFlow();
      return;
    }
    if (!hasProduce && hasStore) {
      void openStoreFlow();
      return;
    }

    // No transactions yet — fall back to existing produce flow (preserves old UX).
    if (!hasProduce && !hasStore) {
      void openProduceFlow();
      return;
    }

    // Mixed data → ask the user which Z report to generate.
    setShowTypeSelector(true);
  };

  // Type selector callback
  const handleTypeSelect = (type: ZReportType) => {
    setShowTypeSelector(false);
    if (type === 'store') {
      void openStoreFlow();
    } else {
      void openProduceFlow();
    }
  };

  // Handle period selection - fetch filtered data from backend and show receipt preview
  const handlePeriodSelect = async (period: ZReportPeriod, periodLabel: string) => {
    console.log('📋 Period selected:', period, periodLabel);
    setSelectedPeriod(period);
    setSelectedPeriodLabel(periodLabel);
    setShowPeriodSelector(false);

    // Fetch device report with period filter from backend
    await fetchDeviceReport(period);

    setShowDeviceReceiptPreview(true);
  };
  
  // Handle device receipt preview close
  const handleDeviceReceiptPreviewClose = () => {
    setShowDeviceReceiptPreview(false);
  };

  // Handle receipt preview close
  const handleReceiptPreviewClose = () => {
    setShowReceiptPreview(false);
  };

  // Handle print from receipt preview
  const handleReceiptPrint = () => {
    setHasPrinted(true);
  };

  // Handle session close completion
  const handleCompleteSessionClose = () => {
    console.log('✅ Session close confirmed from Z-report page');
    // Clear session storage
    localStorage.removeItem('active_session_data');
    // Dispatch event to notify Dashboard
    window.dispatchEvent(new CustomEvent('sessionCloseComplete'));
    toast.success('Session closed successfully');
    navigate('/', { replace: true });
  };

  // Handle cancel session close
  const handleCancelSessionClose = () => {
    console.log('❌ Session close cancelled from Z-report page');
    // Dispatch event to notify Dashboard
    window.dispatchEvent(new CustomEvent('sessionCloseCancelled'));
    navigate('/', { replace: true });
  };

  const handlePrint = () => {
    console.log('🖨️ handlePrint called', { sessionPrintOnly, isSyncComplete });
    // Enforce sessprint: only print if sync is complete
    if (sessionPrintOnly && !isSyncComplete) {
      toast.error(`Cannot print Z-report: ${pendingSyncCount} collection(s) pending sync. Please sync first.`);
      return;
    }
    console.log('🖨️ Triggering window.print()');
    window.print();
    setHasPrinted(true);
  };

  const handleDownloadPDF = async () => {
    console.log('📥 PDF button clicked', { sessionPrintOnly, isSyncComplete, reportData: !!reportData });
    // Enforce sessprint: only download if sync is complete
    if (sessionPrintOnly && !isSyncComplete) {
      toast.error(`Cannot download Z-report: ${pendingSyncCount} collection(s) pending sync. Please sync first.`);
      return;
    }
    if (reportData) {
      console.log('📥 Generating PDF');
      const success = await generateZReportPDF(reportData);
      if (success) {
        toast.success('Report file saved');
      } else {
        toast.error('Failed to save report file');
      }
    } else {
      console.log('📥 No report data available for PDF');
      toast.error('No report data available to download');
    }
  };

  if (loading && !reportData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center">
        <div className="text-white text-xl">Loading report...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2] print:bg-white" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Session Close Banner - Show when closing session */}
      {isSessionClose && (
        <div className="bg-amber-500 text-white px-4 py-3 text-center print:hidden">
          <p className="font-semibold">Session Close Mode</p>
          <p className="text-sm">Print or view the Z-report, then complete session close below</p>
        </div>
      )}
      
      {/* Header - Hide on print */}
      <header className="bg-white shadow-md sticky top-0 z-50 print:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          {isSessionClose ? (
            <Button onClick={handleCancelSessionClose} variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          ) : (
            <Button onClick={() => navigate('/')} variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          )}
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-xl font-bold text-[#667eea]">Z Report</h1>
            <DeviceAuthStatus />
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={handlePrintClick} 
              variant="default" 
              size="sm"
              disabled={sessionPrintOnly && !isSyncComplete}
              className="bg-primary"
            >
              <Eye className="mr-2 h-4 w-4" />
              View & Print
            </Button>
          </div>
        </div>
        
        {/* Session Close Actions */}
        {isSessionClose && (
          <div className="flex gap-3 px-4 py-3 bg-gray-50 border-t">
            <Button 
              onClick={handleCompleteSessionClose}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              {hasPrinted ? '✓ Complete Session Close' : 'Complete Session Close'}
            </Button>
            <Button 
              onClick={handleCancelSessionClose}
              variant="outline"
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        )}
      </header>

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {/* Sessprint Warning Banner */}
        {sessionPrintOnly && !isSyncComplete && (
          <Card className="border-amber-500 bg-amber-50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-600" />
                <div>
                  <p className="font-semibold text-amber-800">Z-Report Printing Blocked</p>
                  <p className="text-sm text-amber-700">
                    {pendingSyncCount} collection{pendingSyncCount !== 1 ? 's' : ''} pending sync. 
                    Print/download will be enabled after all data is synced.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        {/* Thermal Print Layout - Only visible on print */}
        {reportData && (
          <div className="thermal-print">
            <div className="thermal-header">{produceLabel.toUpperCase()} COLLECTION Z REPORT</div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-line">DATE: {new Date(reportData.date).toLocaleDateString('en-CA')}</div>
            <div className="thermal-line">TIME: {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-section">
              <div className="thermal-line">Total Entries: {reportData.totals.entries}</div>
              <div className="thermal-line">Total Farmers: {reportData.totals.farmers}</div>
              <div className="thermal-line">Total {weightLabel}: {reportData.totals.liters.toFixed(2)}</div>
            </div>
            <div className="thermal-divider">--------------------------------</div>
            {!isCoffee && (
              <div className="thermal-section">
                <div className="thermal-line thermal-bold">BY SESSION:</div>
                <div className="thermal-line">Morning: {reportData.bySession.AM.entries} ({reportData.bySession.AM.liters.toFixed(2)}{weightUnit})</div>
                <div className="thermal-line">Evening: {reportData.bySession.PM.entries} ({reportData.bySession.PM.liters.toFixed(2)}{weightUnit})</div>
              </div>
            )}
            {!isCoffee && <div className="thermal-divider">--------------------------------</div>}
            <div className="thermal-section">
              <div className="thermal-line thermal-bold">BY {routeLabel.toUpperCase()}:</div>
              {Object.entries(reportData.byRoute).map(([route, data]) => (
                <div key={route} className="thermal-line">{route}: {data.total.toFixed(2)}{weightUnit}</div>
              ))}
            </div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-section">
              <div className="thermal-line thermal-bold">BY COLLECTOR:</div>
              {Object.entries(reportData.byCollector).map(([collector, data]) => (
                <div key={collector} className="thermal-line">{collector}: {data.liters.toFixed(2)}{weightUnit}</div>
              ))}
            </div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-line">Generated: {new Date().toLocaleString()}</div>
            <div className="thermal-divider">--------------------------------</div>
          </div>
        )}
        
        <div className="screen-only space-y-4">
        {/* Date Selector */}
        <Card className="print:hidden">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#667eea]"
              />
              {isOffline && (
                <span className="text-sm text-orange-600 font-semibold">
                  📡 Offline Mode
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Totals */}
        {reportData && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Total {weightLabel}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-[#667eea]">
                    {reportData.totals.liters.toFixed(2)} {weightUnit}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Total Farmers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-[#667eea]">
                    {reportData.totals.farmers}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Total Entries</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-[#667eea]">
                    {reportData.totals.entries}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* By Session - Only show for dairy (non-coffee) */}
            {!isCoffee && (
              <Card>
                <CardHeader>
                  <CardTitle>By {periodLabel}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{periodLabel}</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead className="text-right">{weightLabel}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">Morning (AM)</TableCell>
                        <TableCell className="text-right">{reportData.bySession.AM.entries}</TableCell>
                        <TableCell className="text-right">{reportData.bySession.AM.liters.toFixed(2)} {weightUnit}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Evening (PM)</TableCell>
                        <TableCell className="text-right">{reportData.bySession.PM.entries}</TableCell>
                        <TableCell className="text-right">{reportData.bySession.PM.liters.toFixed(2)} {weightUnit}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* By Route */}
            <Card>
              <CardHeader>
                <CardTitle>By {routeLabel}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{routeLabel}</TableHead>
                      {!isCoffee && <TableHead className="text-right">AM Entries</TableHead>}
                      {!isCoffee && <TableHead className="text-right">PM Entries</TableHead>}
                      {isCoffee && <TableHead className="text-right">Entries</TableHead>}
                      <TableHead className="text-right">Total {weightLabel}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(reportData.byRoute).map(([route, data]) => (
                      <TableRow key={route}>
                        <TableCell className="font-medium">{route}</TableCell>
                        {!isCoffee && <TableCell className="text-right">{data.AM.length}</TableCell>}
                        {!isCoffee && <TableCell className="text-right">{data.PM.length}</TableCell>}
                        {isCoffee && <TableCell className="text-right">{data.AM.length + data.PM.length}</TableCell>}
                        <TableCell className="text-right">{data.total.toFixed(2)} {weightUnit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* By Collector */}
            <Card>
              <CardHeader>
                <CardTitle>By Collector</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Collector</TableHead>
                      <TableHead className="text-right">Farmers</TableHead>
                      <TableHead className="text-right">Entries</TableHead>
                      <TableHead className="text-right">Total {weightLabel}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(reportData.byCollector).map(([collector, data]) => (
                      <TableRow key={collector}>
                        <TableCell className="font-medium">{collector}</TableCell>
                        <TableCell className="text-right">{data.farmers}</TableCell>
                        <TableCell className="text-right">{data.entries}</TableCell>
                        <TableCell className="text-right">{data.liters.toFixed(2)} {weightUnit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Print Footer - Only visible on print */}
            <div className="hidden print:block text-center mt-8 pt-4 border-t">
              <p className="text-sm text-gray-600">
                Generated on {new Date().toLocaleString()}
              </p>
            </div>
          </>
        )}
        
        {!reportData && !loading && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              <Download className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No report data available</p>
              <p className="text-sm mt-2">
                {isOffline ? 'You are offline. Connect to fetch report.' : 'Loading report...'}
              </p>
            </CardContent>
          </Card>
        )}
        </div>
      </div>

      {/* Receipt Preview Modal - Summary style */}
      <ZReportReceipt
        data={reportData}
        open={showReceiptPreview}
        onClose={handleReceiptPreviewClose}
        onPrint={handleReceiptPrint}
        companyName={companyName}
        produceLabel={produceLabel}
        routeLabel={routeLabel}
        periodLabel={periodLabel}
        weightLabel={weightLabel}
        weightUnit={weightUnit}
        isCoffee={isCoffee}
      />
      
      {/* Type Selector Dialog — only shown when both produce + store data exist */}
      <ZReportTypeSelector
        open={showTypeSelector}
        produceLabel={produceLabel}
        onClose={() => setShowTypeSelector(false)}
        onSelect={handleTypeSelect}
      />

      {/* Period Selector Dialog — gated to orgtype === 'D' (Dairy) by handlePrintClick */}
      <ZReportPeriodSelector
        open={showPeriodSelector}
        onClose={() => setShowPeriodSelector(false)}
        onSelect={handlePeriodSelect}
        sessions={sessionList}
      />

      {/* Device Z Report Receipt Modal - Uses handwritten layout for printing */}
      <DeviceZReportReceipt
        data={deviceReportData}
        open={showDeviceReceiptPreview}
        onClose={handleDeviceReceiptPreviewClose}
        onPrint={handleReceiptPrint}
        routeName={routeLabel}
        selectedPeriod={selectedPeriod}
        periodLabel={selectedPeriodLabel}
        reportType={selectedReportType}
      />
    </div>
  );
};

export default ZReport;
