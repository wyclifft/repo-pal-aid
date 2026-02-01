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
          totalWeight: 0
        });
      }
      
      const group = typeMap.get(transtype)!;
      group.transactions.push(tx);
      group.totalWeight += tx.weight;
    }
    
    // Sort by transtype (1=Buy first, then 2=Sell, then 3=AI)
    return Array.from(typeMap.values()).sort((a, b) => a.transtype - b.transtype);
  }, [filteredTransactions]);
  
  // Calculate filtered totals
  const filteredTotals = useMemo(() => {
    const totalWeight = filteredTransactions.reduce((sum, tx) => sum + tx.weight, 0);
    const uniqueFarmers = new Set(filteredTransactions.map(tx => tx.farmer_id)).size;
    return {
      weight: totalWeight,
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
          })),
          totalWeight: filteredTotals.weight,
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

  // Render transactions for a type group - compact single-row layout
  const renderTypeSection = (group: TypeGroup, isFirst: boolean) => (
    <div key={group.transtype} className={!isFirst ? 'mt-2' : ''}>
      {/* Type Header - compact */}
      <div className="bg-muted py-0.5 px-1 rounded">
        <p className="font-bold text-center text-[10px]">== {group.typeLabel} ==</p>
      </div>
      
      {/* Column Headers: MNO|REF|QTY|TIME with dotted separators */}
      <div className="grid grid-cols-4 gap-0 font-bold text-center text-[9px] border-b border-dotted py-0.5 mt-0.5">
        <span className="border-r border-dotted">MNO</span>
        <span className="border-r border-dotted">REF</span>
        <span className="border-r border-dotted">QTY</span>
        <span>TIME</span>
      </div>

      {/* Transaction List - single row per transaction */}
      <div className="py-0.5">
        {group.transactions.map((tx, index) => (
          <div key={tx.transrefno || index} className="grid grid-cols-4 gap-0 text-center text-[10px] border-b border-dotted py-0.5">
            <span className="truncate border-r border-dotted">{tx.farmer_id.substring(0, 5)}</span>
            <span className="truncate border-r border-dotted">{getShortRef(tx.refno)}</span>
            <span className="border-r border-dotted">{tx.weight.toFixed(1)}</span>
            <span>{tx.time.substring(0, 5)}</span>
          </div>
        ))}
        {group.transactions.length === 0 && (
          <div className="text-center text-muted-foreground italic text-[10px] py-1">
            No transactions
          </div>
        )}
      </div>

      {/* Type Subtotal - compact */}
      <div className="flex justify-between text-[10px] font-bold pt-0.5">
        <span>{group.typeLabel}</span>
        <span>{group.totalWeight.toFixed(1)} {weightUnit}</span>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md font-mono text-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-0">
          <DialogTitle className="sr-only">Device Z Report</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-xs">
          {/* Company Name - Header */}
          <div className="text-center border-b border-dashed pb-2">
            <h3 className="font-bold text-base uppercase">{data.companyName}</h3>
            {/* Z Report Period - shown prominently */}
            <p className="font-bold text-sm mt-1">Z REPORT: {periodDisplayLabel.toUpperCase()}</p>
          </div>

          {/* Summary Type */}
          <div className="pt-1">
            <p className="font-semibold">* {data.produceLabel.toUpperCase()} SUMMARY</p>
          </div>

          {/* Season/Session */}
          <div className="flex">
            <span className="font-semibold">* {data.periodLabel.toUpperCase()}:</span>
            <span className="ml-2">{data.seasonName}</span>
          </div>

          {/* Date */}
          <div className="flex">
            <span className="font-semibold">* DATE:</span>
            <span className="ml-2">{formattedDate}</span>
          </div>

          {/* Center */}
          {centerName && (
            <div className="flex pb-1">
              <span className="font-semibold">* {routeLabel.toUpperCase()}:</span>
              <span className="ml-2">{centerName}</span>
            </div>
          )}

          {/* Produce */}
          <div className="flex pb-2">
            <span className="font-semibold">* PRODUCE:</span>
            <span className="ml-2">{data.produceName || data.produceLabel.toUpperCase()}</span>
          </div>

          {/* Transaction Groups by Type */}
          <div className="max-h-60 overflow-y-auto">
            {typeGroups.length > 0 ? (
              typeGroups.map((group, idx) => renderTypeSection(group, idx === 0))
            ) : (
              <div className="text-center text-muted-foreground italic py-2">
                No transactions
              </div>
            )}
          </div>

          {/* Grand Total - compact (uses filtered totals) */}
          <div className="border-t-2 border-double pt-1 mt-1">
            <div className="flex justify-between font-bold text-xs">
              <span>TOTAL</span>
              <span>{filteredTotals.weight.toFixed(1)} {weightUnit}</span>
            </div>
          </div>

          {/* Entry/Member counts - inline (uses filtered totals) */}
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Entries: {filteredTotals.entries}</span>
            <span>Members: {filteredTotals.farmers}</span>
          </div>

          {/* Footer: Clerk, Print Time, Device - compact */}
          <div className="border-t border-dashed pt-1 mt-1 space-y-0.5 text-[10px]">
            <div className="flex justify-between">
              <span>CLERK:</span>
              <span className="uppercase">{data.clerkName}</span>
            </div>
            <div className="flex justify-between">
              <span>{printDate}</span>
              <span>{printTime}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>DEV:</span>
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
