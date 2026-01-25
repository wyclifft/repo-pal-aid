import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { mysqlApi, type ZReportData } from '@/services/mysqlApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Download, Printer, Calendar, AlertTriangle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { generateZReportPDF } from '@/utils/pdfExport';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { DeviceAuthStatus } from '@/components/DeviceAuthStatus';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { ZReportReceipt } from '@/components/ZReportReceipt';

const ZReport = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  
  // Get date from URL or use today
  const dateFromUrl = searchParams.get('date');
  const autoPrint = searchParams.get('autoprint') === 'true';
  const isSessionClose = searchParams.get('sessionclose') === 'true';
  const [selectedDate, setSelectedDate] = useState(dateFromUrl || new Date().toISOString().split('T')[0]);
  const autoPrintTriggeredRef = useRef(false);
  const [hasPrinted, setHasPrinted] = useState(false);
  
  // App settings
  const { sessionPrintOnly, routeLabel, produceLabel, isCoffee, weightUnit, weightLabel, periodLabel, companyName } = useAppSettings();
  
  // Sync status tracking for sessprint enforcement
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncComplete, setIsSyncComplete] = useState(true);

  // Receipt preview state
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);

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
  
  const { saveZReport, getZReport, getUnsyncedReceipts } = useIndexedDB();

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
  }, [selectedDate, deviceFingerprint]);

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
        console.log('📦 Loaded Z Report from cache');
      }
    } catch (cacheError) {
      console.error('Cache read error:', cacheError);
    }

    // 2. Then fetch fresh data in background if online
    if (navigator.onLine) {
      try {
        const data = await mysqlApi.zReport.get(selectedDate, deviceFingerprint);
        if (data) {
          // Ensure data has valid structure before using
          const safeData: ZReportData = {
            date: data.date || selectedDate,
            totals: data.totals || { liters: 0, farmers: 0, entries: 0 },
            byRoute: data.byRoute || {},
            bySession: data.bySession || { AM: { entries: 0, liters: 0 }, PM: { entries: 0, liters: 0 } },
            byCollector: data.byCollector || {},
            collections: data.collections || []
          };
          setReportData(safeData);
          // Cache in IndexedDB for offline access
          try {
            await saveZReport(selectedDate, safeData);
            console.log('✅ Z Report synced and cached');
          } catch (saveErr) {
            console.warn('Failed to cache Z Report:', saveErr);
          }
        }
      } catch (error) {
        console.error('Error syncing report:', error);
        // Data already loaded from cache, just log the error
        if (!reportData) {
          // Only show toast if no data at all
          console.log('No data available for this date');
        }
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

  // Handle print button click - show preview first
  const handlePrintClick = () => {
    console.log('🖨️ Print button clicked', { sessionPrintOnly, isSyncComplete, pendingSyncCount, reportData: !!reportData });
    // Enforce sessprint: only show preview if sync is complete
    if (sessionPrintOnly && !isSyncComplete) {
      toast.error(`Cannot print Z-report: ${pendingSyncCount} collection(s) pending sync. Please sync first.`);
      return;
    }
    setShowReceiptPreview(true);
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

  const handleDownloadPDF = () => {
    console.log('📥 PDF button clicked', { sessionPrintOnly, isSyncComplete, reportData: !!reportData });
    // Enforce sessprint: only download if sync is complete
    if (sessionPrintOnly && !isSyncComplete) {
      toast.error(`Cannot download Z-report: ${pendingSyncCount} collection(s) pending sync. Please sync first.`);
      return;
    }
    if (reportData) {
      console.log('📥 Generating PDF');
      generateZReportPDF(reportData);
      toast.success('PDF downloaded successfully');
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
            <div className="thermal-line">DATE: {new Date(reportData.date).toLocaleDateString()}</div>
            <div className="thermal-line">TIME: {new Date().toLocaleTimeString()}</div>
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
        {/* Date Selector - Hide on print */}
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

        {reportData && (
          <>
            {/* Summary Totals */}
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
        </div>
      </div>

      {/* Receipt Preview Modal - matches TransactionReceipt styling */}
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
    </div>
  );
};

export default ZReport;
