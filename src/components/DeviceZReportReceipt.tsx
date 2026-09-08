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

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Printer, Download, X, Loader2 } from 'lucide-react';
import { isPrinterConnected, printZReport } from '@/services/bluetooth';
import { toast } from 'sonner';
import { generateDeviceZReportPDF } from '@/utils/pdfExport';
import type { DeviceZReportData, DeviceZReportTransaction } from '@/services/mysqlApi';
import { filterTransactionsByPeriod, type ZReportPeriod, getPeriodDisplayLabel } from './ZReportPeriodSelector';

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
  reportType?: 'produce' | 'store';
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
  const isStoreReport = reportType === 'store';
  
  // Get the display label for the period (Store reports ignore period entirely)
  const periodDisplayLabel = isStoreReport
    ? 'Store Z'
    : (periodLabelProp || getPeriodDisplayLabel(selectedPeriod));
  
  // Filter transactions by report type first, then by selected period.
  // Store report → only transtype 2 (SELL) and 3 (AI), and skip the session/period filter.
  // Produce report → only transtype 1, with normal period filtering preserved.
  const filteredTransactions = useMemo(() => {
    if (!data?.transactions?.length) return [];

    if (isStoreReport) {
      // Store Portal Report: Only sales/AI from Store portal (no milk_session_id)
      const storeOnly = data.transactions.filter(t => {
        const tt = Number((t as any).transtype) || 1;
        const milkId = String((t as any).milk_session_id || '').trim();
        // If it has a 10-character milk_session_id, it belongs to a Dairy Milk Session, not Store portal
        if (milkId.length === 10) return false;
        return tt === 2 || tt === 3;
      });
      return filterTransactionsByPeriod(storeOnly, selectedPeriod, data.orgtype);
    }

    // Produce Session Report: Buy produce (1) and Sell produce (2)
    const produceOnly = data.transactions.filter(t => {
      const tt = Number((t as any).transtype) || 1;
      const milkId = String((t as any).milk_session_id || '').trim();
      if (tt === 1) return true;
      // In Dairy (orgtype D), include transtype=2 (Sell Produce) if it belongs to a milk session.
      // In Coffee (orgtype C), include transtype=2 (Sell Produce) unconditionally.
      if (tt === 2) {
        if (data.orgtype === 'C') return true;
        if (data.orgtype === 'D' && milkId.length === 10) return true;
      }
      return false;
    });
    return filterTransactionsByPeriod(produceOnly, selectedPeriod, data.orgtype);
  }, [data?.transactions, selectedPeriod, isStoreReport, data?.orgtype]);
  
  // Group filtered transactions by Store (Route) and then by Type (1=Buy, 2=Sell, 3=AI)
  const storeGroups = useMemo<StoreGroup[]>(() => {
    if (!filteredTransactions.length) return [];
    
    const storeMap = new Map<string, StoreGroup>();
    
    for (const tx of filteredTransactions) {
      const route = tx.route || 'OTHER';
      const routeNameLabel = tx.route_name || route;

      if (!storeMap.has(route)) {
        storeMap.set(route, {
          route,
          routeName: routeNameLabel,
          typeGroups: []
        });
      }

      const storeGroup = storeMap.get(route)!;
      const transtype = tx.transtype || 1;
      const typeLabel = tx.transTypeLabel || (transtype === 2 ? 'SELL' : transtype === 3 ? 'AI' : 'BUY');
      
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
  }, [filteredTransactions, activeRouteCode]);
  
  // Calculate filtered totals
  const filteredTotals = useMemo(() => {
    const totalWeight = filteredTransactions.reduce((sum, tx) => sum + tx.weight, 0);
    const totalAmount = filteredTransactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const uniqueFarmers = new Set(filteredTransactions.map(tx => tx.farmer_id)).size;
    return {
      weight: totalWeight,
      amount: totalAmount,
      entries: filteredTransactions.length,
      farmers: uniqueFarmers
    };
  }, [filteredTransactions]);
  
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

    if (filteredTransactions.length > 0) {
      const sess = (filteredTransactions[0] as any).session || (filteredTransactions[0] as any).season_code;
      if (sess) {
        return String(sess).toUpperCase();
      }
    }
    if (selectedPeriod && selectedPeriod !== 'all' && selectedPeriod.length < 10) {
      let code = selectedPeriod.toUpperCase();
      if (['MO', 'MORNING', 'AM'].includes(code)) code = 'AM';
      if (['AF', 'AFTERNOON', 'PM', 'EV', 'EVE', 'EVENING'].includes(code)) code = 'PM';
      return code;
    }
    return (data?.seasonName || 'AM').toUpperCase();
  }, [filteredTransactions, selectedPeriod, data?.seasonName, data?.isCoffee, data?.orgtype]);

  if (!data) return null;

  // Format date as DD/MM/YYYY
  const formattedDate = new Date(data.date).toLocaleDateString('en-GB', {
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
    
    setIsPrinting(true);
    
    try {
      const printerConnected = isPrinterConnected();
      
      if (printerConnected) {
        // Send Z Report data to thermal printer - use filtered transactions
        const result = await printZReport({
          companyName: data.companyName,
          produceLabel: data.produceLabel,
          periodLabel: data.periodLabel,
          seasonName: activeSessionName,
          date: data.date,
          factoryName: centerName || routeName || data.routeLabel || 'FACTORY',
          routeLabel: data.routeLabel || 'Center',
          produceName: data.produceName,
          transactions: filteredTransactions.map(tx => ({
            farmer_id: tx.farmer_id,
            refno: tx.refno,
            weight: tx.weight,
            time: tx.time,
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
          })),
          totalWeight: filteredTotals.weight,
          totalAmount: filteredTotals.amount,
          clerkName: data.clerkName,
          deviceCode: data.deviceCode,
          isCoffee: data.isCoffee,
          activeRouteCode, // v2.12.21: pass active store context to printer
          periodFilter: periodDisplayLabel, // Pass period label for display on receipt
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
        // No Bluetooth printer - use browser print dialog
        window.print();
        toast.info('Opened print dialog (no Bluetooth printer connected)');
        onPrint?.();
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
  const getShortRef = (refno: string) => (refno || '').slice(-6);

  // Helper to determine if a transaction represents produce (weight in KGS/LITERS) vs store merchandise (items)
  const isProduceTx = (tx: { product_code?: string; milk_session_id?: string; transtype?: number }) => {
    const code = (tx.product_code || '').trim().toUpperCase();
    const milkId = String(tx.milk_session_id || '').trim();
    return code === 'S0001' || tx.transtype === 1 || milkId.length === 10 || (tx.transtype === 2 && data?.orgtype === 'C');
  };

  // Render transactions for a type group.
  const renderTypeSection = (group: TypeGroup, isFirst: boolean) => {
    const showMoney = group.transtype !== 1;
    // Same template used for header AND every data row → guaranteed alignment.
    const gridTemplate = showMoney
      ? 'grid grid-cols-[6ch_5ch_1fr_1fr_5ch] gap-2'
      : 'grid grid-cols-[7ch_6ch_1fr_5ch] gap-2';

    // Suppress single-product divider when the section only has one product.
    const distinctProducts = new Set(group.transactions.map(t => t.product_code || '')).size;
    const showProductDividers = distinctProducts > 1;

    // Unit label for section subtotal: produce sales use KGS, store items use items.
    const isProduceGroup = !isStoreReport && (group.transtype === 1 || group.transactions.every(t => isProduceTx(t)));
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
            const qtyDisplay = (Math.floor((Number(tx.weight) || 0) * 10) / 10).toFixed(1);

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
                  <span className="text-right tabular-nums">{tx.time.substring(0, 5)}</span>
                </div>
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
                {(Math.floor(group.totalWeight * 10) / 10).toFixed(1)} {subtotalUnitLabel}
                <span className="ml-3">KSh {group.totalAmount.toFixed(0)}</span>
              </>
            ) : (
              <>{(Math.floor(group.totalWeight * 10) / 10).toFixed(1)} {weightUnit}</>
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
      <DialogContent className="max-w-lg font-mono text-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-0">
          <DialogTitle className="sr-only">Device Z Report</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {/* Company Name - Header (centered, intentional) */}
          <div className="text-center border-b border-dashed pb-2">
            <h3 className="font-bold text-base uppercase tracking-wide">{data.companyName}</h3>
            <p className="font-bold text-sm mt-1">
              {isStoreReport ? 'STORE Z REPORT' : 'Z REPORT'}
            </p>
          </div>

          {/* Metadata block (left-aligned 2-col grid for readability) */}
          <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm pb-2 border-b border-dashed">
            {!isStoreReport && (
              <>
                <span className="font-semibold">SUMMARY</span>
                <span>{data.produceLabel.toUpperCase()}</span>

                <span className="font-semibold">{data.periodLabel.toUpperCase()}</span>
                <span>{activeSessionName}</span>
              </>
            )}

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

            {!isStoreReport && (
              <>
                <span className="font-semibold">PRODUCE</span>
                <span>{data.produceName || data.produceLabel.toUpperCase()}</span>
              </>
            )}
          </div>


          {/* Store Groups */}
          <div className="max-h-80 overflow-y-auto pr-1">
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

            // Actual Store merchandise transactions (transtype=2 or 3 without produce code)
            let storeItemsCount = 0;
            let sellAiAmount = 0;
            filteredTransactions.forEach(tx => {
              if ((tx.transtype || 1) === 1) return;
              sellAiAmount += Number(tx.amount || 0);
              if (!isProduceTx(tx)) {
                storeItemsCount += Number(tx.weight || 0);
              }
            });
            const itemsLabel = storeItemsCount === 1 ? 'item' : 'items';

            return (
              <div className="border-t-2 border-double pt-2 mt-2 space-y-1">
                {buyWeight > 0 && (
                  <div className="flex justify-between font-bold text-sm">
                    <span>GRAND TOTAL BUY</span>
                    <span className="tabular-nums">{(Math.floor(buyWeight * 10) / 10).toFixed(1)} {weightUnit}</span>
                  </div>
                )}
                {sellProduceWeight > 0 && (
                  <div className="flex justify-between font-bold text-sm">
                    <span>GRAND TOTAL SELL PRODUCE</span>
                    <span className="tabular-nums">{(Math.floor(sellProduceWeight * 10) / 10).toFixed(1)} {weightUnit}</span>
                  </div>
                )}
                {storeItemsCount > 0 && (
                  <div className="flex justify-between font-bold text-sm">
                    <span>GRAND TOTAL STORE ITEMS</span>
                    <span className="tabular-nums">{(Math.floor(storeItemsCount * 10) / 10).toFixed(1)} {itemsLabel}</span>
                  </div>
                )}
                {sellAiAmount > 0 && (
                  <div className="flex justify-between font-bold text-sm">
                    <span>GRAND TOTAL VALUE</span>
                    <span className="tabular-nums">KSh {sellAiAmount.toFixed(0)}</span>
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

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handlePrint}
            disabled={isPrinting}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
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
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md font-medium hover:bg-secondary/80 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-md font-medium hover:bg-muted/80 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
