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
  selectedPeriod?: ZReportPeriod; // Period filter
  periodLabel?: string; // Display label for selected period (e.g., "Morning Z")
}

// Helper to group transactions by transaction type
interface TypeGroup {
  transtype: number;
  typeLabel: string;
  transactions: DeviceZReportTransaction[];
  totalWeight: number;
  totalAmount: number;
}

export const DeviceZReportReceipt = ({ 
  data, 
  open, 
  onClose, 
  onPrint,
  routeName,
  selectedPeriod = 'all',
  periodLabel: periodLabelProp
}: DeviceZReportReceiptProps) => {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Get the display label for the period
  const periodDisplayLabel = periodLabelProp || getPeriodDisplayLabel(selectedPeriod);
  
  // Filter transactions by selected period
  const filteredTransactions = useMemo(() => {
    if (!data?.transactions?.length) return [];
    return filterTransactionsByPeriod(data.transactions, selectedPeriod);
  }, [data?.transactions, selectedPeriod]);
  
  // Group filtered transactions by transaction type (1=Buy, 2=Sell, 3=AI)
  const typeGroups = useMemo<TypeGroup[]>(() => {
    if (!filteredTransactions.length) return [];
    
    const typeMap = new Map<number, TypeGroup>();
    
    for (const tx of filteredTransactions) {
      const transtype = tx.transtype || 1;
      const typeLabel = tx.transTypeLabel || (transtype === 2 ? 'SELL' : transtype === 3 ? 'AI' : 'BUY');
      
      if (!typeMap.has(transtype)) {
        typeMap.set(transtype, {
          transtype,
          typeLabel,
          transactions: [],
          totalWeight: 0,
          totalAmount: 0,
        });
      }
      
      const group = typeMap.get(transtype)!;
      group.transactions.push(tx);
      group.totalWeight += tx.weight;
      group.totalAmount += Number(tx.amount || 0);
    }
    
    const sorted = Array.from(typeMap.values()).sort((a, b) => a.transtype - b.transtype);
    sorted.forEach(group => {
      group.transactions.sort((a, b) => (a.product_code || '').localeCompare(b.product_code || ''));
    });
    return sorted;
  }, [filteredTransactions]);
  
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
  
  // Get center name from first transaction if available
  const centerName = useMemo(() => {
    if (typeGroups.length > 0 && typeGroups[0].transactions.length > 0) {
      return typeGroups[0].transactions[0].route_name || routeName || '';
    }
    return routeName || '';
  }, [typeGroups, routeName]);
  
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
          seasonName: data.seasonName,
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
          })),
          totalWeight: filteredTotals.weight,
          totalAmount: filteredTotals.amount,
          clerkName: data.clerkName,
          deviceCode: data.deviceCode,
          isCoffee: data.isCoffee,
          periodFilter: periodDisplayLabel, // Pass period label for display on receipt
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
      const success = await generateDeviceZReportPDF(data, routeName);
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
  // BUY (transtype=1): MNO | REF | AMOUNT | TIME — AMOUNT is weight in KGS.
  // SELL/AI (transtype 2/3): MNO | REF | QTY | KSh | TIME — QTY is integer ITEMS, never KGS.
  // Column templates use explicit char widths so the headers sit directly above the data.
  const renderTypeSection = (group: TypeGroup, isFirst: boolean) => {
    const showMoney = group.transtype !== 1;
    // Same template used for header AND every data row → guaranteed alignment.
    const gridTemplate = showMoney
      ? 'grid grid-cols-[6ch_5ch_1fr_1fr_5ch] gap-2'
      : 'grid grid-cols-[7ch_6ch_1fr_5ch] gap-2';

    // Suppress single-product divider when the section only has one product.
    const distinctProducts = new Set(group.transactions.map(t => t.product_code || '')).size;
    const showProductDividers = distinctProducts > 1;

    // Integer item count for SELL/AI subtotal display.
    const itemCount = showMoney
      ? group.transactions.reduce((s, t) => s + Math.max(0, Math.round(t.weight || 0)), 0)
      : 0;
    const itemsLabel = itemCount === 1 ? 'item' : 'items';

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
            const showItemSeparator = showProductDividers && prevTx && prevTx.product_code !== tx.product_code;
            const qtyDisplay = showMoney
              ? String(Math.max(0, Math.round(tx.weight || 0)))
              : tx.weight.toFixed(1);

            return (
              <div key={tx.transrefno || index}>
                {showItemSeparator && (
                  <div className="my-1.5">
                    <div className="border-t border-dotted border-muted-foreground/60" />
                    <div className="text-center text-[9px] font-semibold text-muted-foreground tracking-wide py-0.5">
                      ── {tx.product_name || tx.product_code || 'OTHER'} ──
                    </div>
                  </div>
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
          {group.transactions.length === 0 && (
            <div className="text-center text-muted-foreground italic text-[11px] py-1">
              No transactions
            </div>
          )}
        </div>

        {/* Type subtotal — single consolidated line per section */}
        <div className="flex justify-between text-xs font-bold pt-1">
          <span>{group.typeLabel} TOTAL</span>
          <span className="tabular-nums">
            {showMoney ? (
              <>
                {itemCount} {itemsLabel}
                <span className="ml-3">KSh {group.totalAmount.toFixed(0)}</span>
              </>
            ) : (
              <>{group.totalWeight.toFixed(1)} {weightUnit}</>
            )}
          </span>
        </div>
      </div>
    );
  };

  // Has any monetary section?
  const hasMoneySections = typeGroups.some(g => g.transtype !== 1);

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
            <p className="font-bold text-sm mt-1">Z REPORT: {periodDisplayLabel.toUpperCase()}</p>
          </div>

          {/* Metadata block (left-aligned 2-col grid for readability) */}
          <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm pb-2 border-b border-dashed">
            <span className="font-semibold">SUMMARY</span>
            <span>{data.produceLabel.toUpperCase()}</span>

            <span className="font-semibold">{data.periodLabel.toUpperCase()}</span>
            <span>{data.seasonName}</span>

            <span className="font-semibold">DATE</span>
            <span>{formattedDate}</span>

            {centerName && (
              <>
                <span className="font-semibold">{routeLabel.toUpperCase()}</span>
                <span className="truncate">{centerName}</span>
              </>
            )}

            <span className="font-semibold">PRODUCE</span>
            <span>{data.produceName || data.produceLabel.toUpperCase()}</span>
          </div>

          {/* Transaction Groups by Type */}
          <div className="max-h-80 overflow-y-auto pr-1">
            {typeGroups.length > 0 ? (
              typeGroups.map((group, idx) => renderTypeSection(group, idx === 0))
            ) : (
              <div className="text-center text-muted-foreground italic py-3">
                No transactions
              </div>
            )}
          </div>

          {/* Grand Total */}
          <div className="border-t-2 border-double pt-2 mt-2 space-y-1">
            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL</span>
              <span className="tabular-nums">{filteredTotals.weight.toFixed(1)} {weightUnit}</span>
            </div>
            {hasMoneySections && (
              <div className="flex justify-between font-bold text-sm">
                <span>TOTAL VALUE</span>
                <span className="tabular-nums">KSh {filteredTotals.amount.toFixed(0)}</span>
              </div>
            )}
          </div>

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
