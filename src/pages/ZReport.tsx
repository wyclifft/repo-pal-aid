import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { formatWeight } from '@/utils/weightUtils';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { mysqlApi, type ZReportData, type DeviceZReportData } from '@/services/mysqlApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { ArrowLeft, Download, Calendar as CalendarIcon, AlertTriangle, Eye, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { generateZReportPDF } from '@/utils/pdfExport';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { DeviceAuthStatus } from '@/components/DeviceAuthStatus';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { resolveDashboardActiveRoute } from '@/utils/sessionMetadata';
import { isCompanyAnalysisAllowed } from '@/lib/supabase';
import { ZReportReceipt } from '@/components/ZReportReceipt';
import { DeviceZReportReceipt } from '@/components/DeviceZReportReceipt';
import { ZReportPeriodSelector, type ZReportPeriod } from '@/components/ZReportPeriodSelector';
import { ZReportTypeSelector, type ZReportType } from '@/components/ZReportTypeSelector';

// Helper to classify produce transactions (buy produce or sell produce) vs store/AI transactions
const isProduceTransaction = (tx: any, isCoffeeOrg?: boolean) => {
  if (!tx) return false;
  const tt = Number(tx.transtype || tx.Transtype) || 1;
  if (tt === 1) return true;
  if (tt === 3) return false;
  if (tt === 2) {
    const code = String(tx.product_code || tx.icode || '').trim().toUpperCase();
    const milkId = String(tx.milk_session_id || '').trim();
    if (code === 'S0001' || milkId.length === 10 || isCoffeeOrg || tx.recordType === 'produce_sale' || tx.type === 'produce' || tx.isMilkFormat === true) {
      return true;
    }
    return false;
  }
  return false;
};

const ZReport = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, currentUser } = useAuth();
  
  // Tracking refs declared before hooks/effects
  const lastFetchedKeyRef = useRef<string>('');
  const autoPrintTriggeredRef = useRef(false);

  // Get date from URL or use today
  const dateFromUrl = searchParams.get('date');
  const autoPrint = searchParams.get('autoprint') === 'true';
  const isSessionClose = searchParams.get('sessionclose') === 'true';
  const [selectedDate, setSelectedDate] = useState(dateFromUrl || new Date().toISOString().split('T')[0]);
  const [hasPrinted, setHasPrinted] = useState(false);

  // Session list states (declared before useMemo hooks)
  const [baseSessionList, setBaseSessionList] = useState<Array<{ SCODE?: string; descript?: string }>>([]);
  const baseSessionListRef = useRef(baseSessionList);
  baseSessionListRef.current = baseSessionList;
  const [sessionList, setSessionList] = useState<Array<{ SCODE?: string; descript?: string }>>([]);

  // Sync selectedDate when URL query param changes
  useEffect(() => {
    if (dateFromUrl && dateFromUrl !== selectedDate) {
      lastFetchedKeyRef.current = '';
      setSelectedDate(dateFromUrl);
    }
  }, [dateFromUrl]);

  // App settings
  const { sessionPrintOnly, routeLabel, produceLabel, isCoffee, isDairy, weightUnit, weightLabel, periodLabel, companyName } = useAppSettings();
  
  // Sync status tracking for sessprint enforcement
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncComplete, setIsSyncComplete] = useState(true);

  // Core Data States (MUST BE DECLARED BEFORE useMemo HOOKS)
  const [deviceReportData, setDeviceReportData] = useState<DeviceZReportData | null>(null);
  const [reportData, setReportData] = useState<ZReportData | null>(null);
  const [localDeviceTx, setLocalDeviceTx] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isDeviceLoading, setIsDeviceLoading] = useState(false);
  const [loadingRowId, setLoadingRowId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>("");

  // Receipt preview states
  const [dateOpen, setDateOpen] = useState(false);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [showDeviceReceiptPreview, setShowDeviceReceiptPreview] = useState(false);
  const [showPeriodSelector, setShowPeriodSelector] = useState(false);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<ZReportType>('produce');
  const [selectedPeriod, setSelectedPeriod] = useState<ZReportPeriod>('all');
  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState<string>('All Z');

  const { isReady, saveZReport, getZReport, getUnsyncedReceipts, getRecentReceipts, getSessions, getUnsyncedSales } = useIndexedDB();

  // Permission flag controlling Company Analysis view vs Device Analysis ONLY
  const canViewCompanyAnalysis = isCompanyAnalysisAllowed(currentUser);

  // Helper for safe date formatting without throwing uncaught RangeError exceptions
  const formatSelectedDate = useCallback((dateStr: string) => {
    if (!dateStr) return 'Select Date';
    try {
      const parsed = parseISO(dateStr);
      if (isNaN(parsed.getTime())) return dateStr;
      return format(parsed, 'PPP');
    } catch {
      return dateStr;
    }
  }, []);

  // Device report data constructed from server deviceReportData, reportData collections, AND local IndexedDB receipts
  const effectiveDeviceReportData: DeviceZReportData | null = useMemo(() => {
    // If server device report has non-empty transactions, use it directly
    if (deviceReportData && deviceReportData.transactions && deviceReportData.transactions.length > 0) {
      return deviceReportData;
    }

    const serverTxs = deviceReportData?.transactions || [];
    const reportCollections = reportData?.collections || [];
    const localTxs = localDeviceTx.map((c: any) => ({
      id: String(c.orderId || c.id || c.transrefno || c.referenceNo || Math.random()),
      farmer_id: String(c.farmer_id || c.farmerno || c.farmerId || c.memberno || ''),
      farmer_name: c.farmer_name || c.farmerName || '',
      weight: Number(c.weight || c.liters || c.quantity || c.totalQuantity || c.itemsCount || 0),
      amount: Number(c.amount || c.totalAmount || 0),
      session: c.session || 'AM',
      milk_session_id: c.milk_session_id || c.season_code || '',
      season_code: c.season_code || '',
      created_at: c.created_at || c.date || c.transdate || selectedDate,
      mno: c.mno || c.farmer_id || c.farmerno || c.farmerId || c.memberno || '',
      can_no: c.can_no || c.can || '',
      transtype: Number(c.transtype || (c.recordType === 'ai_sale' || c.type === 'ai' ? 3 : c.recordType === 'store_sale' || c.type === 'sale' ? 2 : 1)),
      transTypeLabel: c.transTypeLabel || (Number(c.transtype) === 3 || c.recordType === 'ai_sale' || c.type === 'ai' ? 'AI' : Number(c.transtype) === 2 || c.recordType === 'store_sale' || c.type === 'sale' ? 'SELL' : 'BUY'),
      product_code: c.icode || c.product_code || c.itemCode || '',
      product_name: c.product_name || c.itemName || '',
      route: c.route || '',
      route_name: c.route_name || c.routeName || c.route_descript || c.locationName || '',
      refno: c.refno || c.referenceNo || c.transrefno || '',
      time: c.time || c.transtime || '',
    }));

    // Combine all sources avoiding duplicate entries
    const combinedTxsMap = new Map<string, any>();

    serverTxs.forEach((t: any) => {
      const key = String(t.id || t.orderId || Math.random());
      combinedTxsMap.set(key, t);
    });

    reportCollections.forEach((c: any) => {
      const key = String(c.id || c.orderId || Math.random());
      if (!combinedTxsMap.has(key)) {
        combinedTxsMap.set(key, {
          id: key,
          farmer_id: String(c.farmer_id || c.farmerno || ''),
          farmer_name: c.farmer_name || c.farmerName || '',
          weight: Number(c.weight || c.liters || 0),
          session: c.session || 'AM',
          milk_session_id: c.milk_session_id || c.season_code || '',
          season_code: c.season_code || '',
          created_at: c.created_at || c.date || selectedDate,
          mno: c.mno || '',
          can_no: c.can_no || c.can || '',
          route: c.route || '',
          route_name: c.route_name || c.routeName || c.route_descript || c.locationName || '',
        });
      }
    });

    localTxs.forEach((t: any) => {
      if (!combinedTxsMap.has(t.id)) {
        combinedTxsMap.set(t.id, t);
      }
    });

    const allTransactions = Array.from(combinedTxsMap.values());

    if (allTransactions.length === 0 && !deviceReportData && !reportData) {
      return null;
    }

    const calculatedWeight = allTransactions.reduce((sum, t) => sum + Number(t.weight || 0), 0);
    const calculatedFarmers = new Set(allTransactions.map(t => String(t.farmer_id || '').trim()).filter(Boolean)).size;

    const totalWeight = calculatedWeight > 0 ? calculatedWeight : (deviceReportData?.totals?.weight || (reportData?.date === selectedDate ? reportData?.totals?.liters : 0) || 0);
    const totalFarmers = calculatedFarmers > 0 ? calculatedFarmers : (deviceReportData?.totals?.farmers || (reportData?.date === selectedDate ? reportData?.totals?.farmers : 0) || 0);
    const totalEntries = allTransactions.length || deviceReportData?.totals?.entries || (reportData?.date === selectedDate ? reportData?.totals?.entries : 0) || 0;

    return {
      date: selectedDate,
      deviceCode: deviceReportData?.deviceCode || currentUser?.device_code || localStorage.getItem('uniquedevcode') || 'DEVICE',
      companyName: deviceReportData?.companyName || companyName || 'Company',
      produceLabel: deviceReportData?.produceLabel || produceLabel || 'MILK',
      periodLabel: deviceReportData?.periodLabel || periodLabel || 'Session',
      seasonName: deviceReportData?.seasonName || '',
      routeLabel: deviceReportData?.routeLabel || routeLabel || 'Route',
      clerkName: deviceReportData?.clerkName || currentUser?.username || 'Clerk',
      totals: {
        weight: totalWeight,
        entries: totalEntries,
        farmers: totalFarmers,
      },
      transactions: allTransactions,
      isCoffee: isCoffee,
    };
  }, [deviceReportData, reportData, localDeviceTx, selectedDate, currentUser, companyName, produceLabel, periodLabel, routeLabel, isCoffee]);

  // Compute Device Sessions Overview for restricted clerks
  const deviceSessionsOverview = useMemo(() => {
    const activeData = effectiveDeviceReportData;
    const txs = activeData?.transactions || [];

    const list: Array<{
      id: string;
      label: string;
      period: string;
      farmers: number;
      weight: number;
      amount?: number;
      reportType?: 'produce' | 'store';
    }> = [];

    const sessionsList = deviceReportData?.sessionsList || [];

    // Helper to calculate exact farmers & weight for a milk_session_id from transactions
    const getMilkIdMetrics = (milkId: string, defaultName?: string, defaultFarmers?: number, defaultWeight?: number) => {
      const matchTxs = txs.filter((t: any) => isProduceTransaction(t, isCoffee) && String(t.milk_session_id || '').trim() === milkId);
      if (matchTxs.length > 0) {
        const farmersCount = new Set(matchTxs.map((t: any) => String(t.farmer_id || t.farmerno || '').trim()).filter(Boolean)).size;
        const totalWeight = matchTxs.reduce((sum: number, t: any) => sum + Number(t.weight || t.liters || 0), 0);
        const sessName = matchTxs[0]?.session || defaultName || 'Session';
        return { farmers: farmersCount, weight: totalWeight, name: sessName };
      }
      return { farmers: defaultFarmers || 0, weight: defaultWeight || 0, name: defaultName || 'Session' };
    };

    // 1. Individual milk session IDs from sessionsList or txs
    const seenMilkIds = new Set<string>();
    (sessionsList || []).forEach((s: any) => {
      const milkId = String(s?.milk_session_id || '').trim();
      if (milkId && milkId !== '0' && !seenMilkIds.has(milkId)) {
        seenMilkIds.add(milkId);
        const metrics = getMilkIdMetrics(milkId, s?.session, s?.farmers, s?.weight);
        list.push({
          id: milkId,
          label: `${metrics.name} (${milkId})`,
          period: milkId,
          farmers: metrics.farmers,
          weight: metrics.weight,
        });
      }
    });

    (txs || []).forEach((tx: any) => {
      const milkId = String(tx?.milk_session_id || '').trim();
      if (milkId && milkId !== '0' && !seenMilkIds.has(milkId)) {
        seenMilkIds.add(milkId);
        const metrics = getMilkIdMetrics(milkId, tx?.session);
        list.push({
          id: milkId,
          label: `${metrics.name} (${milkId})`,
          period: milkId,
          farmers: metrics.farmers,
          weight: metrics.weight,
        });
      }
    });

    // 2. Aggregate session metrics by actual session name in transactions / reportData
    const sessionAggregatesMap = new Map<string, { label: string; period: string; farmersSet: Set<string>; weight: number }>();

    txs.forEach((tx: any) => {
      // Exclude Store merchandise and AI sales from produce collection session totals
      if (!isProduceTransaction(tx, isCoffee)) return;

      const rawSess = String(tx.session || tx.season_code || '').trim();
      if (!rawSess) return;

      const key = rawSess.toUpperCase();
      const farmerId = String(tx.farmer_id || tx.farmerno || '').trim();
      const w = Number(tx.weight || tx.liters || 0);

      if (!sessionAggregatesMap.has(key)) {
        const sessionObj = (sessionList || []).find(s =>
          String(s?.SCODE || s?.milk_session_id || '').trim().toUpperCase() === key ||
          String(s?.descript || '').trim().toUpperCase() === key
        );
        const displayName = sessionObj?.descript || rawSess;
        sessionAggregatesMap.set(key, {
          label: `All ${displayName} Z`,
          period: rawSess,
          farmersSet: new Set<string>(),
          weight: 0,
        });
      }

      const agg = sessionAggregatesMap.get(key)!;
      if (farmerId) agg.farmersSet.add(farmerId);
      agg.weight += w;
    });

    // Fallback to reportData.bySession if txs had no session details
    if (sessionAggregatesMap.size === 0 && reportData?.bySession) {
      Object.entries(reportData.bySession).forEach(([sessKey, sessVal]) => {
        if ((sessVal?.liters || 0) > 0 || (sessVal?.farmers || 0) > 0) {
          list.push({
            id: `ALL_${sessKey.toUpperCase()}`,
            label: `All ${sessKey} Z`,
            period: sessKey,
            farmers: sessVal?.farmers || 0,
            weight: sessVal?.liters || 0,
          });
        }
      });
    } else {
      sessionAggregatesMap.forEach((agg, key) => {
        list.push({
          id: `ALL_${key}`,
          label: agg.label,
          period: agg.period,
          farmers: agg.farmersSet.size,
          weight: agg.weight,
        });
      });
    }

    // 3. Store & AI Transactions row (merchandise sales & AI services)
    const storeAndAiTxs = txs.filter((t: any) => !isProduceTransaction(t, isCoffee));

    if (storeAndAiTxs.length > 0) {
      const storeFarmers = new Set(
        storeAndAiTxs
          .map((t: any) => String(t.farmer_id || t.farmerno || t.memberno || '').trim())
          .filter(Boolean)
      ).size;
      const storeItemsOrWeight = storeAndAiTxs.reduce(
        (sum: number, t: any) => sum + Number(t.weight || t.quantity || t.totalQuantity || 0),
        0
      );
      const storeTotalAmount = storeAndAiTxs.reduce(
        (sum: number, t: any) => sum + Number(t.amount || t.totalAmount || 0),
        0
      );

      const hasStoreSales = storeAndAiTxs.some((t: any) => (Number(t.transtype) || 2) === 2);
      const hasAiSales = storeAndAiTxs.some((t: any) => (Number(t.transtype) || 2) === 3);

      let storeLabel = 'Store Z';
      if (hasStoreSales && hasAiSales) {
        storeLabel = 'Store & AI Z';
      } else if (!hasStoreSales && hasAiSales) {
        storeLabel = 'AI Services Z';
      }

      list.push({
        id: 'STORE_Z',
        label: storeLabel,
        period: 'all',
        farmers: storeFarmers,
        weight: storeItemsOrWeight,
        amount: storeTotalAmount,
        reportType: 'store',
      });
    }

    // 4. Full Day All Z
    const overallFarmers = activeData?.totals?.farmers ?? reportData?.totals?.farmers ?? 0;
    const overallWeight = activeData?.totals?.weight ?? reportData?.totals?.liters ?? 0;

    if (overallWeight > 0 || overallFarmers > 0 || list.length === 0) {
      list.push({
        id: 'ALL_Z',
        label: 'All Z',
        period: 'all',
        farmers: overallFarmers,
        weight: overallWeight,
      });
    }

    return list;
  }, [effectiveDeviceReportData, deviceReportData, reportData, sessionList, isCoffee]);

  // v2.12.20: Active route from dashboard for Store Z context
  const activeRoute = useMemo(() => resolveDashboardActiveRoute(), []);

  // Current company code for cache isolation
  const currentCcode = useMemo(() => {
    try {
      const settings = JSON.parse(localStorage.getItem('app_settings') || '{}');
      return (settings?.ccode || localStorage.getItem('ccode') || '').trim();
    } catch {
      return (localStorage.getItem('ccode') || '').trim();
    }
  }, []);

  // Check authentication - but don't redirect during session close flow
  useEffect(() => {
    if (!isAuthenticated && !isSessionClose) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate, isSessionClose]);

  // v2.10.114: Load cached sessions so the Z Report period selector can show
  // one option per session row (matched by transactions.CAN → sessions.SCODE,
  // labeled with sessions.descript). Works offline using whatever the rest
  // of the app (SessionSelector) has already cached.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isReady) return;
      try {
        const cached = await getSessions();
        if (!cancelled && Array.isArray(cached)) {
          setBaseSessionList(cached as any);
          setSessionList(cached as any);
        }
      } catch (err) {
        console.warn('[Z-REPORT] Failed to load cached sessions:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isReady]);

  // Check for pending syncs (for sessprint enforcement)
  useEffect(() => {
    const checkPendingSync = async () => {
      if (!isReady) return;
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
  }, [isReady]);

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

  // Atomic coordinated data loader for the active selectedDate
  const loadAllDataForDate = useCallback(async (targetDate: string, fingerprint: string) => {
    if (!fingerprint) return;

    setIsDataLoading(true);
    setLoading(true);

    try {
      // 1. Local IndexedDB & Native storage query
      const localPromise = (async () => {
        try {
          const [recent, unsyncedReceipts, unsyncedSales] = await Promise.all([
            getRecentReceipts ? getRecentReceipts() : Promise.resolve([]),
            getUnsyncedReceipts ? getUnsyncedReceipts() : Promise.resolve([]),
            getUnsyncedSales ? getUnsyncedSales() : Promise.resolve([])
          ]);

          let nativeSales: any[] = [];
          let nativeAI: any[] = [];
          try {
            const { isNativeStorageAvailable, getUnsyncedFromLocalDB } = await import('@/services/offlineStorage');
            if (isNativeStorageAvailable()) {
              nativeSales = (await getUnsyncedFromLocalDB('store_sale')) || [];
              nativeAI = (await getUnsyncedFromLocalDB('ai_sale')) || [];
            }
          } catch (e) {
            console.warn('[Z-REPORT] Native sales storage query skipped:', e);
          }

          const allLocal = [...recent, ...unsyncedReceipts, ...unsyncedSales, ...nativeSales, ...nativeAI];
          const seenIds = new Set<string>();
          return allLocal.filter((r: any) => {
            if (!r) return false;
            const rId = String(r.orderId || r.id || r.transrefno || r.referenceNo || `${r.farmer_id || r.farmerId}_${r.created_at || r.transdate}`);
            if (seenIds.has(rId)) return false;
            seenIds.add(rId);

            const rDateStr = r.date || r.created_at || r.transdate || '';
            if (!rDateStr) return true;

            try {
              const formattedDate = new Date(rDateStr).toISOString().split('T')[0];
              return formattedDate === targetDate;
            } catch {
              return String(rDateStr).includes(targetDate);
            }
          });
        } catch (err) {
          console.warn('[Z-REPORT] Local transactions query error:', err);
          return [];
        }
      })();

      // 2. Cached Z Report query
      const cachePromise = (async () => {
        try {
          return await getZReport(targetDate, currentCcode);
        } catch {
          return null;
        }
      })();

      // 3. Server Device Z Report query
      const deviceServerPromise = (async () => {
        if (!navigator.onLine) return null;
        try {
          return await mysqlApi.zReport.getByDevice(targetDate, fingerprint);
        } catch (e) {
          console.warn('[Z-REPORT] Device server fetch error:', e);
          return null;
        }
      })();

      // 4. Server Main Z Report query
      const mainServerPromise = (async () => {
        if (!navigator.onLine) return null;
        try {
          const res = await mysqlApi.zReport.get(targetDate, fingerprint);
          if (res) {
            return {
              date: res.date || targetDate,
              totals: res.totals || { liters: 0, farmers: 0, entries: 0 },
              byRoute: res.byRoute || {},
              bySession: res.bySession || { AM: { entries: 0, farmers: 0, liters: 0 }, PM: { entries: 0, farmers: 0, liters: 0 } },
              byCollector: res.byCollector || {},
              collections: res.collections || []
            } as ZReportData;
          }
        } catch (e) {
          console.warn('[Z-REPORT] Main server fetch error:', e);
        }
        return null;
      })();

      const [localRes, cacheRes, deviceRes, mainRes] = await Promise.all([
        localPromise,
        cachePromise,
        deviceServerPromise,
        mainServerPromise
      ]);

      const fetchedLocalTx = localRes || [];
      const fetchedDeviceReportData = deviceRes || null;
      const fetchedReportData = mainRes || cacheRes || null;

      // Save fresh main server data to cache
      if (mainRes) {
        try {
          await saveZReport(targetDate, mainRes, currentCcode);
        } catch (sErr) {
          console.warn('Failed to cache Z Report:', sErr);
        }
      }

      // Dynamic session list updating
      if (deviceRes) {
        if (!deviceRes.clerkName || deviceRes.clerkName === 'Unknown') {
          deviceRes.clerkName = currentUser?.username || 'Clerk';
        }
        const dynamicSessions = (deviceRes.sessionsList || [])
          .filter(s => {
            const mid = String(s.milk_session_id || '').trim();
            return mid !== '' && mid !== '0' && mid.length === 10;
          })
          .map(s => ({
            milk_session_id: s.milk_session_id,
            SCODE: s.season_code || s.session,
            descript: `${s.session} Session`
          }));

        const seen = new Set<string>();
        const merged: Array<{ milk_session_id?: string; SCODE?: string; descript?: string }> = [];

        dynamicSessions.forEach(ds => {
          const key = ds.milk_session_id || ds.SCODE || '';
          if (key && !seen.has(key)) {
            seen.add(key);
            merged.push(ds);
          }
        });

        baseSessionListRef.current.forEach(bs => {
          const key = (bs as any).milk_session_id || bs.SCODE || '';
          if (key && !seen.has(key)) {
            seen.add(key);
            merged.push(bs);
          } else if (!key) {
            merged.push(bs);
          }
        });

        setSessionList(merged);
      }

      // ATOMIC STATE BATCH UPDATE - ALL SETTERS CALLED TOGETHER
      setLocalDeviceTx(fetchedLocalTx);
      setDeviceReportData(fetchedDeviceReportData);
      setReportData(fetchedReportData);
    } catch (err) {
      console.error('[Z-REPORT] Error in atomic data load:', err);
    } finally {
      setLoading(false);
      setIsDataLoading(false);
    }
  }, [getRecentReceipts, getUnsyncedReceipts, getUnsyncedSales, getZReport, currentCcode, saveZReport, currentUser?.username]);

  // Fetch device-specific Z Report for period selection or receipt view
  const fetchDeviceReport = useCallback(async (period?: ZReportPeriod) => {
    if (!deviceFingerprint || !navigator.onLine) return;

    setIsDeviceLoading(true);
    try {
      const data = await mysqlApi.zReport.getByDevice(selectedDate, deviceFingerprint, undefined, period && period !== 'all' ? period : undefined);
      if (data) {
        if (!data.clerkName || data.clerkName === 'Unknown') {
          data.clerkName = currentUser?.username || 'Clerk';
        }
        setDeviceReportData(data);
      }
    } catch (err) {
      console.error('[Z-REPORT] Failed to fetch device report:', err);
    } finally {
      setIsDeviceLoading(false);
    }
  }, [selectedDate, deviceFingerprint, currentUser?.username]);

  useEffect(() => {
    if (!deviceFingerprint || !isReady) return;

    const fetchKey = `${selectedDate}_${deviceFingerprint}`;
    if (lastFetchedKeyRef.current !== fetchKey) {
      lastFetchedKeyRef.current = fetchKey;

      // Reset period selection and preview modals when selected date or device changes
      setSelectedPeriod('all');
      setSelectedPeriodLabel('All Z');
      setShowReceiptPreview(false);
      setShowDeviceReceiptPreview(false);
      setShowPeriodSelector(false);
      setShowTypeSelector(false);

      loadAllDataForDate(selectedDate, deviceFingerprint);
    }
  }, [selectedDate, deviceFingerprint, isReady, loadAllDataForDate]);

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

  // Inspect device report transactions to decide which Z report types apply.
  const detectAvailableTypes = useCallback((): { hasProduce: boolean; hasStore: boolean } => {
    const txs = effectiveDeviceReportData?.transactions || reportData?.collections || [];
    let hasProduce = false;
    let hasStore = false;
    for (const t of txs) {
      if (isProduceTransaction(t, isCoffee)) {
        hasProduce = true;
      } else {
        hasStore = true;
      }
      if (hasProduce && hasStore) break;
    }
    return { hasProduce, hasStore };
  }, [effectiveDeviceReportData, reportData, isCoffee]);

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
  const handlePeriodSelect = async (period: ZReportPeriod, periodLabel: string, reportType: ZReportType = 'produce') => {
    console.log('📋 Period selected:', period, periodLabel, reportType);
    setSelectedReportType(reportType);
    setSelectedPeriod(period);
    setSelectedPeriodLabel(periodLabel);
    setShowPeriodSelector(false);

    // Fetch device report with period filter from backend
    await fetchDeviceReport(period);

    setShowDeviceReceiptPreview(true);
  };

  // Row click handler with spinner support
  const handleSessionRowClick = async (item: { id: string; period: string; label: string; reportType?: ZReportType }) => {
    try {
      setLoadingRowId(item.id);
      await handlePeriodSelect(item.period, item.label, item.reportType || 'produce');
    } finally {
      setLoadingRowId(null);
    }
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
        <div className="text-white text-xl flex items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-white" />
          <span>Loading Z report...</span>
        </div>
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
          {canViewCompanyAnalysis && (
            <div className="flex gap-2">
              <Button
                onClick={handlePrintClick}
                variant="default"
                size="sm"
                disabled={(sessionPrintOnly && !isSyncComplete) || isDeviceLoading}
                className="bg-primary"
              >
                {isDeviceLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
                View & Print
              </Button>
            </div>
          )}
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
            <div className="thermal-line">DATE: {reportData.date && !isNaN(new Date(reportData.date).getTime()) ? new Date(reportData.date).toLocaleDateString('en-CA') : selectedDate}</div>
            <div className="thermal-line">TIME: {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-section">
              <div className="thermal-line">Total Entries: {reportData.totals?.entries ?? 0}</div>
              <div className="thermal-line">Total Farmers: {reportData.totals?.farmers ?? 0}</div>
              <div className="thermal-line">Total {weightLabel}: {formatWeight(reportData.totals?.liters ?? 0)}</div>
            </div>
            <div className="thermal-divider">--------------------------------</div>
            {!isCoffee && reportData.bySession && (
              <div className="thermal-section">
                <div className="thermal-line thermal-bold">BY SESSION:</div>
                {Object.entries(reportData.bySession || {}).map(([sessName, sessData]) => {
                  const sessObj = typeof sessData === 'object' && sessData !== null ? sessData : { liters: Number(sessData) || 0, farmers: 0 };
                  return (
                    <div key={sessName} className="thermal-line">
                      {sessName}: {sessObj?.farmers ?? 0} Farmers ({formatWeight(sessObj?.liters ?? 0)}{weightUnit})
                    </div>
                  );
                })}
              </div>
            )}
            {!isCoffee && <div className="thermal-divider">--------------------------------</div>}
            <div className="thermal-section">
              <div className="thermal-line thermal-bold">BY {routeLabel.toUpperCase()}:</div>
              {Object.entries(reportData.byRoute || {}).map(([route, data]) => {
                const totalW = typeof data === 'number' ? data : ((data as any)?.total ?? 0);
                return (
                  <div key={route} className="thermal-line">{route}: {formatWeight(totalW)}{weightUnit}</div>
                );
              })}
            </div>
            <div className="thermal-divider">--------------------------------</div>
            <div className="thermal-section">
              <div className="thermal-line thermal-bold">BY COLLECTOR:</div>
              {Object.entries(reportData.byCollector || {}).map(([collector, data]) => {
                const collectorObj = typeof data === 'object' && data !== null ? data : { liters: Number(data) || 0, farmers: 0 };
                return (
                  <div key={collector} className="thermal-line">{collector}: {formatWeight(collectorObj?.liters ?? 0)}{weightUnit}</div>
                );
              })}
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
            <div className="flex items-center gap-4 flex-wrap">
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="flex items-center gap-2 font-medium px-4 py-2.5 h-auto text-sm sm:text-base border border-gray-300 rounded-lg hover:bg-gray-50">
                    <CalendarIcon className="h-5 w-5 text-muted-foreground" />
                    <span>{formatSelectedDate(selectedDate)}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={selectedDate ? parseISO(selectedDate) : undefined}
                    onSelect={(d) => {
                      if (d) {
                        const newDateStr = format(d, 'yyyy-MM-dd');
                        if (newDateStr !== selectedDate) {
                          lastFetchedKeyRef.current = '';
                          setReportData(null);
                          setDeviceReportData(null);
                          setLocalDeviceTx([]);
                          setSelectedDate(newDateStr);
                          setSearchParams((prev) => {
                            const next = new URLSearchParams(prev);
                            next.set('date', newDateStr);
                            return next;
                          }, { replace: true });
                        }
                        setDateOpen(false);
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              {(loading || isDeviceLoading || isRefreshing) && (
                <div className="flex items-center gap-2 text-sm text-[#667eea] font-medium bg-purple-50 px-3 py-1.5 rounded-md border border-purple-200 animate-pulse">
                  <Loader2 className="h-4 w-4 animate-spin text-[#667eea]" />
                  <span>Fetching report data...</span>
                </div>
              )}
              {isOffline && (
                <span className="text-sm text-orange-600 font-semibold">
                  📡 Offline Mode
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Totals & Analysis */}
        {isDataLoading ? (
          <Card className="p-8 text-center bg-white/90 backdrop-blur-sm shadow-md">
            <CardContent className="pt-6 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-[#667eea]" />
              <p className="font-semibold text-lg text-gray-800">Fetching report data for {formatSelectedDate(selectedDate)}...</p>
              <p className="text-xs text-muted-foreground">Please wait while the collection totals and sessions are loaded.</p>
            </CardContent>
          </Card>
        ) : canViewCompanyAnalysis ? (
          reportData && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Total {weightLabel}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-[#667eea]">
                      {formatWeight(reportData.totals?.liters ?? 0)} {weightUnit}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Total Farmers</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-[#667eea]">
                      {reportData.totals?.farmers ?? 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Total Entries</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-[#667eea]">
                      {reportData.totals?.entries ?? 0}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* By Session - Only show for dairy (non-coffee) */}
              {!isCoffee && reportData?.bySession && (
                <Card>
                  <CardHeader>
                    <CardTitle>By {periodLabel}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{periodLabel}</TableHead>
                          <TableHead className="text-right">Farmers</TableHead>
                          <TableHead className="text-right">{weightLabel}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(reportData.bySession || {}).map(([sessName, sessData]) => {
                          const sessObj = typeof sessData === 'object' && sessData !== null ? sessData : { liters: Number(sessData) || 0, farmers: 0 };
                          return (
                            <TableRow key={sessName}>
                              <TableCell className="font-medium">{sessName}</TableCell>
                              <TableCell className="text-right">{sessObj?.farmers ?? 0}</TableCell>
                              <TableCell className="text-right">{formatWeight(sessObj?.liters ?? 0)} {weightUnit}</TableCell>
                            </TableRow>
                          );
                        })}
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
                        {!isCoffee && <TableHead className="text-right">AM Farmers</TableHead>}
                        {!isCoffee && <TableHead className="text-right">PM Farmers</TableHead>}
                        {isCoffee && <TableHead className="text-right">Farmers</TableHead>}
                        <TableHead className="text-right">Total {weightLabel}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(reportData.byRoute || {}).map(([route, data]) => {
                        const amList = Array.isArray((data as any)?.AM) ? (data as any).AM : [];
                        const pmList = Array.isArray((data as any)?.PM) ? (data as any).PM : [];
                        const amFarmers = new Set(amList.map((c: any) => c?.farmer_id || c?.farmerno || c?.memberno || '')).size;
                        const pmFarmers = new Set(pmList.map((c: any) => c?.farmer_id || c?.farmerno || c?.memberno || '')).size;
                        const totalFarmers = new Set([
                          ...amList.map((c: any) => c?.farmer_id || c?.farmerno || c?.memberno || ''),
                          ...pmList.map((c: any) => c?.farmer_id || c?.farmerno || c?.memberno || '')
                        ].filter(Boolean)).size;
                        const routeTotalWeight = typeof data === 'number' ? data : ((data as any)?.total ?? 0);
                        return (
                          <TableRow key={route}>
                            <TableCell className="font-medium">{route}</TableCell>
                            {!isCoffee && <TableCell className="text-right">{amFarmers}</TableCell>}
                            {!isCoffee && <TableCell className="text-right">{pmFarmers}</TableCell>}
                            {isCoffee && <TableCell className="text-right">{totalFarmers}</TableCell>}
                            <TableCell className="text-right">{formatWeight(routeTotalWeight)} {weightUnit}</TableCell>
                          </TableRow>
                        );
                      })}
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
                        {!isCoffee && <TableHead className="text-right">No of Session IDs</TableHead>}
                        <TableHead className="text-right">Total {weightLabel}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(reportData.byCollector || {}).map(([collector, data]) => {
                        const collectorObj = typeof data === 'object' && data !== null ? data : { liters: Number(data) || 0, farmers: 0 };
                        const sessionIdsCount = collectorObj?.sessionIds ?? (
                          Array.isArray(reportData.collections)
                            ? new Set(
                                reportData.collections
                                  .filter((c: any) => (c?.clerk_name || 'Unknown') === collector)
                                  .map((c: any) => (c?.milk_session_id || c?.season_code || c?.session || '').trim())
                                  .filter(Boolean)
                              ).size
                            : 0
                        );
                        return (
                          <TableRow key={collector}>
                            <TableCell className="font-medium">{collector}</TableCell>
                            <TableCell className="text-right">{collectorObj?.farmers ?? 0}</TableCell>
                            {!isCoffee && <TableCell className="text-right">{sessionIdsCount}</TableCell>}
                            <TableCell className="text-right">{formatWeight(collectorObj?.liters ?? 0)} {weightUnit}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )
        ) : (
          /* Inactivated View: Device Analysis ONLY for Restricted Clerks */
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-muted-foreground">Total {weightLabel}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-[#667eea]">
                    {formatWeight(effectiveDeviceReportData?.totals?.weight ?? reportData?.totals?.liters ?? 0)} {weightUnit}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-muted-foreground">Total Farmers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-[#667eea]">
                    {effectiveDeviceReportData?.totals?.farmers ?? reportData?.totals?.farmers ?? 0}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sessions Overview Card */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                  <CardTitle className="text-lg">Sessions Overview</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    (tap any row to preview and print z report)
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SESSION</TableHead>
                      <TableHead className="text-right">FARMERS</TableHead>
                      <TableHead className="text-right">TOTAL {weightLabel.toUpperCase()}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deviceSessionsOverview.map((item) => {
                      const isRowLoading = loadingRowId === item.id;
                      return (
                        <TableRow
                          key={item.id}
                          onClick={() => handleSessionRowClick(item as any)}
                          className="cursor-pointer hover:bg-muted/60 transition-colors"
                        >
                          <TableCell className="font-semibold text-foreground flex items-center gap-2">
                            {isRowLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin text-[#667eea] shrink-0" />
                            ) : null}
                            <span>{item.label}</span>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {item.farmers}
                          </TableCell>
                          <TableCell className="text-right font-bold text-[#667eea]">
                            {item.reportType === 'store' && item.amount && item.amount > 0
                              ? `KSh ${item.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                              : `${formatWeight(item.weight)} ${weightUnit}`}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
        
        {!reportData && !effectiveDeviceReportData && !loading && !isDataLoading && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              <Download className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No report data available</p>
              <p className="text-sm mt-2">
                {isOffline ? 'You are offline. Connect to fetch report.' : 'No collections recorded for this date.'}
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
        data={effectiveDeviceReportData}
        open={showDeviceReceiptPreview}
        onClose={handleDeviceReceiptPreviewClose}
        onPrint={handleReceiptPrint}
        routeName={activeRoute?.descript || routeLabel}
        activeRouteCode={activeRoute?.tcode}
        selectedPeriod={selectedPeriod}
        periodLabel={selectedPeriodLabel}
        reportType={selectedReportType}
      />
    </div>
  );
};

export default ZReport;
