import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { mysqlApi, type ZReportData } from '@/services/mysqlApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Download, Printer, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { generateZReportPDF } from '@/utils/pdfExport';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { DeviceAuthStatus } from '@/components/DeviceAuthStatus';
import { useIndexedDB } from '@/hooks/useIndexedDB';

const ZReport = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  // Check authentication
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);
  const [reportData, setReportData] = useState<ZReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>("");
  
  const { saveZReport, getZReport } = useIndexedDB();

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

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    if (reportData) {
      generateZReportPDF(reportData);
      toast.success('PDF downloaded successfully');
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
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2] print:bg-white">
      {/* Header - Hide on print */}
      <header className="bg-white shadow-md sticky top-0 z-50 print:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Button onClick={() => navigate('/')} variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-xl font-bold text-[#667eea]">Z Report</h1>
            <DeviceAuthStatus />
          </div>
          <div className="flex gap-2">
            <Button onClick={handlePrint} variant="outline" size="sm">
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button onClick={handleDownloadPDF} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {/* Thermal Print Layout - Only visible on print */}
        {reportData && (
          <div className="thermal-print">
            <div className="thermal-header">MILK COLLECTION Z REPORT</div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-line">DATE: {new Date(reportData.date).toLocaleDateString()}</div>
            <div className="thermal-line">TIME: {new Date().toLocaleTimeString()}</div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-section">
              <div className="thermal-line">Total Entries: {reportData.totals.entries}</div>
              <div className="thermal-line">Total Farmers: {reportData.totals.farmers}</div>
              <div className="thermal-line">Total Litres: {reportData.totals.liters.toFixed(2)}</div>
            </div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-section">
              <div className="thermal-line thermal-bold">BY SESSION:</div>
              <div className="thermal-line">Morning: {reportData.bySession.AM.entries} ({reportData.bySession.AM.liters.toFixed(2)}L)</div>
              <div className="thermal-line">Evening: {reportData.bySession.PM.entries} ({reportData.bySession.PM.liters.toFixed(2)}L)</div>
            </div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-section">
              <div className="thermal-line thermal-bold">BY ROUTE:</div>
              {Object.entries(reportData.byRoute).map(([route, data]) => (
                <div key={route} className="thermal-line">{route}: {data.total.toFixed(2)}L</div>
              ))}
            </div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-section">
              <div className="thermal-line thermal-bold">BY COLLECTOR:</div>
              {Object.entries(reportData.byCollector).map(([collector, data]) => (
                <div key={collector} className="thermal-line">{collector}: {data.liters.toFixed(2)}L</div>
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
                  <CardTitle className="text-lg">Total Liters</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-[#667eea]">
                    {reportData.totals.liters.toFixed(2)} L
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

            {/* By Session */}
            <Card>
              <CardHeader>
                <CardTitle>By Session</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session</TableHead>
                      <TableHead className="text-right">Entries</TableHead>
                      <TableHead className="text-right">Liters</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">Morning (AM)</TableCell>
                      <TableCell className="text-right">{reportData.bySession.AM.entries}</TableCell>
                      <TableCell className="text-right">{reportData.bySession.AM.liters.toFixed(2)} L</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Evening (PM)</TableCell>
                      <TableCell className="text-right">{reportData.bySession.PM.entries}</TableCell>
                      <TableCell className="text-right">{reportData.bySession.PM.liters.toFixed(2)} L</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* By Route */}
            <Card>
              <CardHeader>
                <CardTitle>By Route</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Route</TableHead>
                      <TableHead className="text-right">AM Entries</TableHead>
                      <TableHead className="text-right">PM Entries</TableHead>
                      <TableHead className="text-right">Total Liters</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(reportData.byRoute).map(([route, data]) => (
                      <TableRow key={route}>
                        <TableCell className="font-medium">{route}</TableCell>
                        <TableCell className="text-right">{data.AM.length}</TableCell>
                        <TableCell className="text-right">{data.PM.length}</TableCell>
                        <TableCell className="text-right">{data.total.toFixed(2)} L</TableCell>
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
                      <TableHead className="text-right">Total Liters</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(reportData.byCollector).map(([collector, data]) => (
                      <TableRow key={collector}>
                        <TableCell className="font-medium">{collector}</TableCell>
                        <TableCell className="text-right">{data.farmers}</TableCell>
                        <TableCell className="text-right">{data.entries}</TableCell>
                        <TableCell className="text-right">{data.liters.toFixed(2)} L</TableCell>
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
    </div>
  );
};

export default ZReport;
