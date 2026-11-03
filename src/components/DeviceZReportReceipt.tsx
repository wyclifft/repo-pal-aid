/**
 * Device-specific Z Report Receipt Component
 * Layout:
 * COMPANY NAME
 * * COFFEE/MILK SUMMARY
 * * SEASON/SESSION: [name]
 * * DATE: DD/MM/YYYY
 * * CENTER: [center name] (displayed below date)
 * 
 * === BUY TRANSACTIONS ===
 * MNO :.: QTY :.: TIME
 * [transaction rows...]
 * Ref: [last 5 digits]
 * BUY TOTAL: [weight] KGS
 * 
 * === SELL TRANSACTIONS ===
 * [similar layout...]
 * 
 * === AI TRANSACTIONS ===
 * [similar layout...]
 * 
 * GRAND TOTAL    [weight] KGS
 * CLERK          [clerk name]
 * PRINTED ON     DD/MM/YYYY - HH:MM (24-hour format)
 * DEVICE CODE    [devcode]
 */

import { useState, useMemo, useEffect } from 'react';
import { formatWeight } from '@/utils/weightUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Printer, Download, X, Loader2 } from 'lucide-react';
import { isPrinterConnected, printZReport } from '@/services/bluetooth';
import { toast } from 'sonner';
import { generateDeviceZReportPDF } from '@/utils/pdfExport';
import type { DeviceZReportData, DeviceZReportTransaction } from '@/services/mysqlApi';
import { TRANSTYPE_BUY_PRODUCE, TRANSTYPE_SELL_PRODUCE, TRANSTYPE_STORE, TRANSTYPE_AI, isBuyProduce, isSellProduce, isStore, isAI, getTransTypeLabel } from '@/utils/transtypeUtils';
import { filterTransactionsByPeriod, type ZReportPeriod, getPeriodDisplayLabel } from './ZReportPeriodSelector';
import { useIndexedDB } from '@/hooks/useIndexedDB';

export const format24HourTime = (tx: any): string => {
  if (!tx) return '00:00';

  const fields = [
    tx.transtime,
    tx.time,
    tx.created_at,
    tx.transdate,
    tx.timestamp,
    tx.date,
    tx.created
  ];

  for (const val of fields) {
    if (val === undefined || val === null) continue;
    const str = String(val).trim();
    if (!str || str.toUpperCase() === 'AM' || str.toUpperCase() === 'PM') continue;

    // Check for 12-hour AM/PM string (e.g., "3:56 PM" or "03:56:03 PM")
    const ampmMatch = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1], 10);
      const minutes = ampmMatch[2];
      const period = ampmMatch[3].toUpperCase();
      if (period === 'PM' && hours < 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      return `${String(hours).padStart(2, '0')}:${minutes}`;
    }

    // Check for 24-hour time or time with seconds (e.g. "15:56:03", "15:56", "9:56:03", "9:56")
    if (str.includes(':')) {
      const parts = str.split(' ');
      const timePart = parts.find(p => p.includes(':')) || str;
      const cleanTime = timePart.includes('T') ? timePart.split('T')[1] : timePart;
      const timeMatch = cleanTime.match(/^(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        const hh = String(parseInt(timeMatch[1], 10)).padStart(2, '0');
        const mm = timeMatch[2];
        return `${hh}:${mm}`;
      }
    }

    // Unix numeric timestamp
    const num = Number(str);
    if (!isNaN(num) && num > 1000000000) {
      const d = new Date(num);
      if (!isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      }
    }
  }

  const rawDateStr = String(tx.transdate || tx.date || '').trim();
  if (rawDateStr.includes(' ')) {
    const timePart = rawDateStr.split(' ')[1];
    if (timePart && timePart.includes(':')) {
      const match = timePart.match(/^(\d{1,2}):(\d{2})/);
      if (match) {
        return `${String(parseInt(match[1], 10)).padStart(2, '0')}:${match[2]}`;
      }
    }
  }

  return '00:00';
};

interface DeviceZReportReceiptProps {
  data: DeviceZReportData | null;
  open: boolean;
  onClose: () => void;
  onPrint?: () => void;
  routeName?: string; // Factory name from route selection
  activeRouteCode?: string; // v2.12.20: dashboard-selected store code
  selectedPeriod?: ZReportPeriod; // Period filter
  periodLabel?: string; // Display label for selected period (e.g., "Morning Z")
  // v2.10.97: 'store' renders an independent stock-only Z report that excludes
  // session, season, produce and farmer-delivery metadata. Defaults to 'produce'
  // so the existing dairy/coffee Z report layout is fully backward-compatible.
  reportType?: 'produce' | 'sell_produce' | 'store' | 'ai';
}

// Helper to group transactions by store and then by transaction type
interface TypeGroup {
  transtype: number;
  typeLabel: string;
  transactions: DeviceZReportTransaction[];
  totalWeight: number;
  totalAmount: number;
}

interface StoreGroup {
  route: string;
  routeName: string;
  typeGroups: TypeGroup[];
}

export const DeviceZReportReceipt = ({ 
  data, 
  open, 
  onClose, 
  onPrint,
  routeName,
  activeRouteCode,
  selectedPeriod = 'all',
  periodLabel: periodLabelProp,
  reportType = 'produce'
}: DeviceZReportReceiptProps) => {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const isStoreReport = reportType === 'store' || reportType === 'ai';

  const { isReady, getRoutes } = useIndexedDB();
  const [cachedRouteMap, setCachedRouteMap] = useState<Map<string, string>>(new Map());

  // Load cached routes from IndexedDB to map route codes to descriptions
  useEffect(() => {
    let active = true;
    const loadRoutes = async () => {
      try {
        if (!getRoutes) return;
        const routesList = await getRoutes();
        if (active && Array.isArray(routesList) && routesList.length > 0) {
          const map = new Map<string, string>();
          routesList.forEach((r: any) => {
            const code = String(r.tcode || r.code || '').trim();
            const name = String(r.descript || r.name || '').trim();
            if (code && name) {
              map.set(code, name);
              map.set(code.toUpperCase(), name);
              map.set(code.toLowerCase(), name);
            }
            if (name) {
              map.set(name, name);
              map.set(name.toUpperCase(), name);
            }
          });
          setCachedRouteMap(map);
        }
      } catch (err) {
        console.warn('[Z-REPORT] Failed to load cached routes:', err);
      }
    };
    if (isReady && open) {
      loadRoutes();
    }
    return () => { active = false; };
  }, [isReady, getRoutes, open]);

  // Get the display label for the period (Store reports ignore period entirely)
  const periodDisplayLabel = isStoreReport
    ? 'Store Z'
    : (periodLabelProp || getPeriodDisplayLabel(selectedPeriod));
  
  // Helper to determine if a transaction represents produce (weight in KGS/LITERS) vs store merchandise (items)
  const isProduceTx = (tx: { product_code?: string; milk_session_id?: string; transtype?: number; recordType?: string; type?: string; isMilkFormat?: boolean }) => {
    if (!tx) return false;
    if (isBuyProduce(tx.transtype)) return true;
    if (isAI(tx.transtype)) return false;
    if (isStore(tx.transtype, tx.isMilkFormat)) return false;
    if (isSellProduce(tx.transtype, tx.isMilkFormat)) return true;
    const code = (tx.product_code || '').trim().toUpperCase();
    const milkId = String(tx.milk_session_id || '').trim();
    return code === 'S0001' || milkId.length === 10 || data?.orgtype === 'C' || data?.isCoffee === true || tx.recordType === 'produce_sale' || tx.type === 'produce' || tx.isMilkFormat === true;
  };

  // Filter transactions by report type first, then by selected period.
  const filteredTransactions = useMemo(() => {
    if (!data?.transactions?.length) return [];

    let matched = data.transactions;
    if (reportType === 'produce') {
      matched = data.transactions.filter(t => isBuyProduce(t.transtype) || (!t.transtype && isProduceTx(t)));
    } else if (reportType === 'sell_produce') {
      matched = data.transactions.filter(t => isSellProduce(t.transtype, t.isMilkFormat) || (Number(t.transtype) === 2 && isProduceTx(t)));
    } else if (reportType === 'store') {
      matched = data.transactions.filter(t => isStore(t.transtype, t.isMilkFormat));
    } else if (reportType === 'ai') {
      matched = data.transactions.filter(t => isAI(t.transtype));
    }

    return filterTransactionsByPeriod(matched, selectedPeriod, data.orgtype);
  }, [data?.transactions, selectedPeriod, reportType, data?.orgtype]);
  
  // Group filtered transactions by Store (Route) and then by Type (1=Buy, 2=Sell, 3=AI)
  const storeGroups = useMemo<StoreGroup[]>(() => {
    if (!filteredTransactions.length) return [];
    
    const storeMap = new Map<string, StoreGroup>();
    
    for (const tx of filteredTransactions) {
      const rawRoute = String(tx.route || '').trim();
      const rawRouteName = String(tx.route_name || '').trim();

      // Resolve human-readable route description
      let routeNameLabel = '';
      if (rawRouteName && rawRouteName !== rawRoute && rawRouteName.toUpperCase() !== 'OTHER') {
        routeNameLabel = rawRouteName;
      } else if (rawRoute && cachedRouteMap.has(rawRoute)) {
        routeNameLabel = cachedRouteMap.get(rawRoute)!;
      } else if (rawRoute && cachedRouteMap.has(rawRoute.toUpperCase())) {
        routeNameLabel = cachedRouteMap.get(rawRoute.toUpperCase())!;
      } else if ((!rawRoute || rawRoute === 'OTHER') && routeName && routeName !== 'Route' && routeName !== 'Center') {
        routeNameLabel = routeName;
      } else {
        routeNameLabel = rawRouteName || rawRoute || 'OTHER';
      }

      const storeKey = rawRoute || routeNameLabel || 'OTHER';

      if (!storeMap.has(storeKey)) {
        storeMap.set(storeKey, {
          route: storeKey,
          routeName: routeNameLabel,
          typeGroups: []
        });
      }

      const storeGroup = storeMap.get(storeKey)!;
      const transtype = tx.transtype || 1;
      const typeLabel = tx.transTypeLabel || getTransTypeLabel(transtype, tx.isMilkFormat);
      
      let typeGroup = storeGroup.typeGroups.find(g => g.transtype === transtype);
      if (!typeGroup) {
        typeGroup = {
          transtype,
          typeLabel,
          transactions: [],
          totalWeight: 0,
          totalAmount: 0,
        };
        storeGroup.typeGroups.push(typeGroup);
      }
      
      typeGroup.transactions.push(tx);
      typeGroup.totalWeight += tx.weight;
      typeGroup.totalAmount += Number(tx.amount || 0);
    }
    
    const sortedStores = Array.from(storeMap.values()).sort((a, b) => {
      // Prioritize active route if provided
      if (activeRouteCode) {
        if (a.route === activeRouteCode) return -1;
        if (b.route === activeRouteCode) return 1;
      }
      return a.routeName.localeCompare(b.routeName);
    });

    sortedStores.forEach(sg => {
      sg.typeGroups.sort((a, b) => a.transtype - b.transtype);
      sg.typeGroups.forEach(tg => {
        tg.transactions.sort((a, b) => (a.product_code || '').localeCompare(b.product_code || ''));
      });
    });

    return sortedStores;
  }, [filteredTransactions, activeRouteCode, cachedRouteMap, routeName]);
  
  // Calculate filtered totals for milk/produce transactions or store/ai transactions
  const filteredTotals = useMemo(() => {
    const targetTxs = (reportType === 'store' || reportType === 'ai')
      ? filteredTransactions
      : filteredTransactions.filter(tx => isProduceTx(tx));
    const totalWeight = targetTxs.reduce((sum, tx) => sum + Number(tx.weight || tx.quantity || 0), 0);
    const totalAmount = targetTxs.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const uniqueFarmers = new Set(targetTxs.map(tx => tx.farmer_id || (tx as any).farmerno).filter(Boolean)).size;
    return {
      weight: totalWeight,
      amount: totalAmount,
      entries: targetTxs.length,
      farmers: uniqueFarmers
    };
  }, [filteredTransactions, reportType]);
  
  // Get center name from data or props
  const centerName = useMemo(() => {
    return routeName || '';
  }, [routeName]);

  const activeMilkSessionId = useMemo(() => {
    if (selectedPeriod && String(selectedPeriod).trim().length === 10 && selectedPeriod !== 'all' && selectedPeriod !== '0') {
      return selectedPeriod;
    }
    return null;
  }, [selectedPeriod]);

  const activeSessionName = useMemo(() => {
    const isCoffeeOrg = data?.isCoffee || data?.orgtype === 'C';
    if (isCoffeeOrg && data?.seasonName) {
      return String(data.seasonName).toUpperCase();
    }

    if (selectedPeriod === 'all' || periodLabelProp === 'All Z') {
      return 'ALL Z';
    }

    const upperPeriod = String(selectedPeriod || '').trim().toUpperCase();
    const upperLabel = String(periodLabelProp || '').trim().toUpperCase();

    if (upperPeriod === 'AM' || upperLabel.includes(' AM')) {
      return 'ALL AM';
    }
    if (upperPeriod === 'PM' || upperLabel.includes(' PM')) {
      return 'ALL PM';
    }
    if (upperLabel.startsWith('ALL ')) {
      let cleaned = upperLabel;
      if (cleaned.endsWith(' Z') && cleaned.length > 2) {
        cleaned = cleaned.substring(0, cleaned.length - 2).trim();
      }
      return cleaned;
    }

    if (filteredTransactions.length > 0) {
      const sess = (filteredTransactions[0] as any).session || (filteredTransactions[0] as any).season_code;
      if (sess) {
        return String(sess).toUpperCase();
      }
    }
    if (selectedPeriod && selectedPeriod !== 'all' && selectedPeriod.length < 10) {
      return selectedPeriod.toUpperCase();
    }
    return (data?.seasonName || 'AM').toUpperCase();
  }, [filteredTransactions, selectedPeriod, periodLabelProp, data?.seasonName, data?.isCoffee, data?.orgtype]);

  if (!data) return null;

  // Format date as DD/MM/YYYY
  const formattedDate = data?.date && !isNaN(new Date(data.date).getTime())
    ? new Date(data.date).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      })
    : new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
  
  // Format print time as DD/MM/YYYY - HH:MM (24-hour format, no AM/PM)
  const now = new Date();
  const printDate = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const printTime = now.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false
  });

  const handlePrint = async () => {
    if (!data) return;
    if (!navigator.onLine) {
      toast.error('Cannot print Z-report while offline. Connect online and sync first.');
      return;
    }

    setIsPrinting(true);
    
    try {
      const printerConnected = isPrinterConnected();
      
      if (printerConnected) {
        const hasProduceTx = filteredTransactions.some(tx => isBuyProduce(tx.transtype) || isSellProduce(tx.transtype, tx.isMilkFormat));
        const hasStoreOrAiTx = filteredTransactions.some(tx => isStore(tx.transtype, tx.isMilkFormat) || isAI(tx.transtype));
        const isMixedData = hasProduceTx && hasStoreOrAiTx;
        const isAllDayZ = isMixedData || selectedPeriod === 'all' || activeSessionName === 'ALL DAY Z' || activeSessionName === 'ALL Z';

        // Send Z Report data to thermal printer - use filtered transactions
        const result = await printZReport({
          companyName: data.companyName,
          produceLabel: data.produceLabel,
          periodLabel: isAllDayZ ? 'All Day Z' : data.periodLabel,
          selectedPeriod: selectedPeriod,
          period: selectedPeriod,
          seasonName: activeSessionName,
          date: data.date,
          factoryName: centerName || routeName || data.routeLabel || 'FACTORY',
          routeLabel: data.routeLabel || 'Center',
          produceName: data.produceName,
          transactions: filteredTransactions.map(tx => {
            const fullRef = String(tx.transrefno || (tx as any).referenceNo || (tx as any).uploadrefno || tx.refno || '').trim();
            const shortRef = tx.refno || (fullRef.length >= 5 ? fullRef.slice(-5) : fullRef);
            return {
              ...tx,
              farmer_id: tx.farmer_id,
              refno: shortRef,
              transrefno: fullRef || shortRef,
              weight: tx.weight,
              transtime: (tx as any).transtime || tx.time,
              time: format24HourTime(tx),
              created_at: (tx as any).created_at,
              transdate: (tx as any).transdate,
              timestamp: (tx as any).timestamp,
              date: (tx as any).date,
              route: tx.route,
              route_name: tx.route_name,
              product_code: tx.product_code,
              product_name: tx.product_name,
              transtype: tx.transtype,
              transTypeLabel: tx.transTypeLabel,
              session: tx.session,
              price: tx.price,
              amount: tx.amount,
              milk_session_id: (tx as any).milk_session_id,
            };
          }),
          totalWeight: filteredTotals.weight,
          totalAmount: filteredTotals.amount,
          clerkName: data.clerkName,
          deviceCode: data.deviceCode,
          isCoffee: data.isCoffee,
          activeRouteCode, // v2.12.21: pass active store context to printer
          periodFilter: isAllDayZ ? 'All Day Z' : periodDisplayLabel, // Pass period label for display on receipt
          milkSessionId: activeMilkSessionId || undefined,
          reportType, // v2.10.98: store mode strips produce metadata in print
        });
        
        if (result.success) {
          toast.success('Z-report sent to printer');
          onPrint?.();
        } else {
          toast.error(result.error || 'Failed to print Z-report');
        }
      } else {
        if (Capacitor.isNativePlatform()) {
          toast.error('No printer connected. Connect a Bluetooth or internal printer in Settings.');
        } else if (typeof window.print === 'function') {
          window.print();
          toast.info('Opened print dialog (no Bluetooth printer connected)');
          onPrint?.();
        } else {
          toast.error('Printing is not supported on this browser.');
        }
      }
    } catch (err) {
      console.error('Print failed:', err);
      toast.error('Failed to print Z-report');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!data) return;
    if (!navigator.onLine) {
      toast.error('Cannot download Z-report while offline. Connect online and sync first.');
      return;
    }

    setIsDownloading(true);
    
    try {
      const reportDataForPDF: DeviceZReportData = {
        ...data,
        seasonName: activeSessionName,
        transactions: filteredTransactions,
      };
      const success = await generateDeviceZReportPDF(reportDataForPDF, routeName, selectedPeriod);
      if (success) {
        toast.success('Report file saved');
      } else {
        toast.error('Failed to save report file');
      }
    } catch (err) {
      console.error('Download failed:', err);
      toast.error('Failed to download report');
    } finally {
      setIsDownloading(false);
    }
  };

  const weightUnit = 'KGS';
  const routeLabel = data.routeLabel || 'Center';

  // Get last 5 digits of reference number
  const getShortRef = (refno: string) => (refno || '').slice(-5);

  // Render transactions for a type group.
  const renderTypeSection = (group: TypeGroup, isFirst: boolean) => {
    const showMoney = !isBuyProduce(group.transtype) && !isSellProduce(group.transtype, true);
    // Same template used for header AND every data row → guaranteed alignment.
    const gridTemplate = showMoney
      ? 'grid grid-cols-[6ch_5ch_1fr_1fr_5ch] gap-2'
      : 'grid grid-cols-[7ch_6ch_1fr_5ch] gap-2';

    // Suppress single-product divider when the section only has one product.
    const distinctProducts = new Set(group.transactions.map(t => t.product_code || '')).size;
    const showProductDividers = distinctProducts > 1;

    // Unit label for section subtotal: produce sales use KGS, store items use items.
    const isProduceGroup = !isStoreReport && (isBuyProduce(group.transtype) || isSellProduce(group.transtype, true) || group.transactions.every(t => isProduceTx(t)));
    const itemCount = showMoney
      ? group.transactions.reduce((s, t) => s + Math.max(0, Math.round(t.weight || 0)), 0)
      : 0;
    const itemsLabel = itemCount === 1 ? 'item' : 'items';
    const subtotalUnitLabel = isProduceGroup ? weightUnit : itemsLabel;

    return (
      <div key={group.transtype} className={!isFirst ? 'mt-3' : ''}>
        {/* Type Header — left-anchored over the MNO/REF columns, not centered */}
        <div className="mb-1">
          <span className="bg-muted px-2 py-0.5 rounded font-bold text-xs">
            == {group.typeLabel} ==
          </span>
        </div>

        {/* Column Headers — same grid template as data rows */}
        <div className={`${gridTemplate} font-bold text-[10px] uppercase border-b border-foreground/30 py-1`}>
          <span className="text-left">MNO</span>
          <span className="text-left">REF</span>
          {showMoney ? (
            <>
              <span className="text-right">QTY</span>
              <span className="text-right">KSh</span>
            </>
          ) : (
            <span className="text-right">AMOUNT</span>
          )}
          <span className="text-right">TIME</span>
        </div>

        {/* Transaction list */}
        <div className="py-0.5">
          {group.transactions.map((tx, index) => {
            const prevTx = index > 0 ? group.transactions[index - 1] : null;
            // v2.10.75: render product header for every distinct product group,
            // including the first one (was only shown on transitions).
            const showItemSeparator = showProductDividers && (!prevTx || prevTx.product_code !== tx.product_code);
            const qtyDisplay = formatWeight(Number(tx.weight) || 0);

            return (
              <div key={tx.transrefno || index}>
                {showItemSeparator && (
                  isStoreReport && showMoney ? (
                    // v2.10.98: store — item name left-aligned full-width, no fixed column.
                    <div className="text-left font-semibold text-[11px] pt-1.5 pb-0.5 uppercase">
                      {(tx.product_name || tx.product_code || 'OTHER').trim()}
                    </div>
                  ) : (
                    <div className="my-1.5">
                      <div className="border-t border-dotted border-muted-foreground/60" />
                      <div className="text-center text-[9px] font-semibold text-muted-foreground tracking-wide py-0.5">
                        ── {tx.product_name || tx.product_code || 'OTHER'} ──
                      </div>
                    </div>
                  )
                )}
                <div className={`${gridTemplate} text-[11px] border-b border-dotted border-muted-foreground/30 py-1`}>
                  <span className="truncate text-left">{tx.farmer_id}</span>
                  <span className="truncate text-left">{getShortRef(tx.refno)}</span>
                  <span className="text-right tabular-nums">{qtyDisplay}</span>
                  {showMoney && (
                    <span className="text-right tabular-nums">{Number(tx.amount || 0).toFixed(0)}</span>
                  )}
                  <span className="text-right tabular-nums">
                    {format24HourTime(tx)}
                  </span>
                </div>
                {/* AI specific details sub-row */}
                {isAI(group.transtype) && ((tx as any).cow_name || (tx as any).cowname || (tx as any).bullname || (tx as any).bull_name || (tx as any).straw_no) && (
                  <div className="pl-2 pb-1 text-[10px] text-muted-foreground font-mono space-y-0.5 border-b border-dotted border-muted-foreground/20">
                    {((tx as any).cow_name || (tx as any).cowname) && (
                      <div>Cow: {(tx as any).cow_name || (tx as any).cowname} {(tx as any).cow_breed ? `(${(tx as any).cow_breed})` : ''}</div>
                    )}
                    {((tx as any).bullname || (tx as any).bull_name) && (
                      <div>Bull: {(tx as any).bullname || (tx as any).bull_name} {(tx as any).straw_no ? `(Straw: ${(tx as any).straw_no})` : ''}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Type subtotal — single consolidated line per section */}
        <div className="flex justify-between text-xs font-bold pt-1">
          <span>{group.typeLabel} TOTAL</span>
          <span className="tabular-nums">
            {showMoney ? (
              <>
                {formatWeight(group.totalWeight)} {subtotalUnitLabel}
                <span className="ml-3">KSh {group.totalAmount.toFixed(0)}</span>
              </>
            ) : (
              <>{formatWeight(group.totalWeight)} {weightUnit}</>
            )}
          </span>
        </div>
      </div>
    );
  };

  if (!data) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-xs p-6 text-center flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="font-medium text-sm text-muted-foreground">Loading Z Report data...</p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg font-mono text-sm max-h-[90vh] flex flex-col p-4 sm:p-6 overflow-hidden">
        <DialogHeader className="pb-0 flex-shrink-0">
          <DialogTitle className="sr-only">Device Z Report</DialogTitle>
        </DialogHeader>

        {/* Scrollable Receipt Preview Body */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
          {/* Company Name - Header (centered, intentional) */}
          <div className="text-center border-b border-dashed pb-2">
            <h3 className="font-bold text-base uppercase tracking-wide">{data.companyName}</h3>
            <p className="font-bold text-sm mt-1">
              {reportType === 'store'
                ? 'STORE SALES Z REPORT'
                : reportType === 'sell_produce'
                ? 'SELL PRODUCE Z REPORT'
                : reportType === 'ai'
                ? 'AI SERVICES Z REPORT'
                : selectedPeriod === 'all' || activeSessionName === 'ALL DAY Z' || activeSessionName === 'ALL Z'
                ? 'ALL DAY Z REPORT'
                : reportType === 'produce'
                ? 'BUY PRODUCE Z REPORT'
                : 'Z REPORT'}
            </p>
          </div>

          {/* Metadata block (left-aligned 2-col grid for readability) */}
          <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm pb-2 border-b border-dashed">
            {selectedPeriod === 'all' || activeSessionName === 'ALL DAY Z' || activeSessionName === 'ALL Z' ? (
              <>
                <span className="font-semibold">SESSION</span>
                <span>ALL DAY Z</span>
              </>
            ) : !isStoreReport ? (
              <>
                <span className="font-semibold">SUMMARY</span>
                <span>{data.produceLabel.toUpperCase()}</span>

                <span className="font-semibold">{data.periodLabel.toUpperCase()}</span>
                <span>{activeSessionName}</span>
              </>
            ) : null}

            {!isStoreReport && activeMilkSessionId && (
              <>
                <span className="font-semibold">SESSION ID</span>
                <span className="font-mono">{activeMilkSessionId}</span>
              </>
            )}

            <span className="font-semibold">DATE</span>
            <span>{formattedDate}</span>

            {!isStoreReport && centerName && (
              <>
                <span className="font-semibold">{routeLabel.toUpperCase()}</span>
                <span className="truncate">{centerName}</span>
              </>
            )}

            {!isStoreReport && !(selectedPeriod === 'all' || activeSessionName === 'ALL DAY Z' || activeSessionName === 'ALL Z') && (
              <>
                <span className="font-semibold">PRODUCE</span>
                <span>{data.produceName || data.produceLabel.toUpperCase()}</span>
              </>
            )}
          </div>

          {/* Store Groups */}
          <div className="space-y-2">
            {storeGroups.length > 0 ? (
              storeGroups.map((storeGroup, sIdx) => (
                <div key={storeGroup.route} className={sIdx > 0 ? 'mt-6 pt-4 border-t-2 border-dashed' : ''}>
                  {/* Store Name Header */}
                  <div className="text-center mb-2">
                    <span className="bg-foreground text-background px-3 py-1 rounded text-xs font-bold uppercase tracking-widest">
                      {storeGroup.routeName}
                    </span>
                  </div>

                  {storeGroup.typeGroups.map((group, tIdx) => renderTypeSection(group, tIdx === 0))}
                </div>
              ))
            ) : (
              <div className="text-center text-muted-foreground italic py-3">
                No transactions
              </div>
            )}
          </div>

          {/* Grand Totals */}
          {(() => {
            const buyWeight = filteredTransactions
              .filter(tx => (tx.transtype || 1) === 1)
              .reduce((s, tx) => s + tx.weight, 0);

            // Sell Produce transactions (transtype=2 with produce code or milk session)
            const sellProduceWeight = filteredTransactions
              .filter(tx => (tx.transtype || 1) !== 1 && isProduceTx(tx))
              .reduce((s, tx) => s + tx.weight, 0);

            // Actual Store merchandise or AI transactions
            let storeItemsCount = 0;
            let storeAmount = 0;
            let aiServicesCount = 0;
            let aiAmount = 0;
            let sellProduceAmount = 0;
            let sellAiAmount = 0;

            filteredTransactions.forEach(tx => {
              const tt = tx.transtype || 1;
              const amt = Number(tx.amount || 0);
              if (tt === 1) return;
              sellAiAmount += amt;
              if (isAI(tt)) {
                aiServicesCount += Number(tx.weight || (tx as any).quantity || 1);
                aiAmount += amt;
              } else if (isProduceTx(tx)) {
                sellProduceAmount += amt;
              } else {
                storeItemsCount += Number(tx.weight || (tx as any).quantity || 0);
                storeAmount += amt;
              }
            });
            const storeItemsLabel = storeItemsCount === 1 ? 'item' : 'items';
            const aiServicesLabel = aiServicesCount === 1 ? 'service' : 'services';
            const totalMoneyAmount = storeAmount + aiAmount + sellProduceAmount;

            return (
              <div className="border-t-2 border-double pt-2 mt-2 space-y-1">
                {buyWeight > 0 && (
                  <div className="flex justify-between font-bold text-sm flex-wrap">
                    <span>TOTAL BUY</span>
                    <span className="tabular-nums">{formatWeight(buyWeight)} {weightUnit}</span>
                  </div>
                )}
                {sellProduceWeight > 0 && (
                  <div className="flex justify-between font-bold text-sm flex-wrap">
                    <span>TOTAL SELL PRODUCE</span>
                    <span className="tabular-nums">{formatWeight(sellProduceWeight)} {weightUnit}</span>
                  </div>
                )}
                {storeItemsCount > 0 && (
                  <div className="flex justify-between font-bold text-sm flex-wrap">
                    <span>TOTAL STORE ITEMS</span>
                    <span className="tabular-nums">{formatWeight(storeItemsCount)} {storeItemsLabel} (KSh {storeAmount.toFixed(0)})</span>
                  </div>
                )}
                {aiServicesCount > 0 && (
                  <div className="flex justify-between font-bold text-sm flex-wrap">
                    <span>TOTAL AI SERVICES</span>
                    <span className="tabular-nums">{formatWeight(aiServicesCount)} {aiServicesLabel} (KSh {aiAmount.toFixed(0)})</span>
                  </div>
                )}
                {totalMoneyAmount > 0 && (
                  <div className="flex justify-between font-bold text-sm border-t border-dashed pt-1 flex-wrap">
                    <span>GRAND TOTAL KSh</span>
                    <span className="tabular-nums">KSh {totalMoneyAmount.toFixed(0)}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Entry/Member counts */}
          <div className="flex justify-between text-[11px] text-muted-foreground pt-1">
            <span>Entries: {filteredTotals.entries}</span>
            <span>Members: {filteredTotals.farmers}</span>
          </div>

          {/* Footer */}
          <div className="border-t border-dashed pt-2 mt-2 space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="font-semibold">CLERK</span>
              <span className="uppercase">{data.clerkName}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{printDate}</span>
              <span>{printTime}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>DEVICE</span>
              <span>{data.deviceCode}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons - Fixed Sticky Footer */}
        <div className="flex-shrink-0 pt-3 border-t bg-background sticky bottom-0 z-20 flex gap-2">
          <button
            onClick={handlePrint}
            disabled={isPrinting}
            className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isPrinting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            {isPrinting ? 'Printing...' : 'Print'}
          </button>
          <button
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="px-4 py-2.5 bg-secondary text-secondary-foreground rounded-md font-medium hover:bg-secondary/80 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            title="Download PDF"
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            <span>PDF</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 bg-muted text-muted-foreground rounded-md font-medium hover:bg-muted/80 transition-colors flex items-center justify-center"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
