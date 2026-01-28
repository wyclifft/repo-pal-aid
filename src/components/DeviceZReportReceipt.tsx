/**
 * Device-specific Z Report Receipt Component
 * Layout:
 * COMPANY NAME
 * * COFFEE/MILK SUMMARY
 * * SEASON/SESSION: [name]
 * * DATE: DD/MM/YYYY
 * * CENTER: [center name] (displayed below date)
 * MNO    REFNO    QTY    TIME
 * [transaction rows grouped by center...]
 * TOTAL           [weight] KGS
 * CLERK          [clerk name]
 * PRINTED ON     DD/MM/YYYY - HH:MM AM/PM
 * DEVICE CODE    [devcode]
 */

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Printer, Download, X, Loader2 } from 'lucide-react';
import { isPrinterConnected, printZReport } from '@/services/bluetooth';
import { toast } from 'sonner';
import { generateDeviceZReportPDF } from '@/utils/pdfExport';
import type { DeviceZReportData, DeviceZReportTransaction } from '@/services/mysqlApi';

interface DeviceZReportReceiptProps {
  data: DeviceZReportData | null;
  open: boolean;
  onClose: () => void;
  onPrint?: () => void;
  routeName?: string; // Factory name from route selection
}

// Helper to group transactions by center (route)
interface CenterGroup {
  centerName: string;
  centerCode: string;
  transactions: DeviceZReportTransaction[];
  totalWeight: number;
}

export const DeviceZReportReceipt = ({ 
  data, 
  open, 
  onClose, 
  onPrint,
  routeName
}: DeviceZReportReceiptProps) => {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Group transactions by center (route)
  const centerGroups = useMemo<CenterGroup[]>(() => {
    if (!data?.transactions?.length) return [];
    
    const groupMap = new Map<string, CenterGroup>();
    
    for (const tx of data.transactions) {
      const centerCode = tx.route || 'Unknown';
      
      if (!groupMap.has(centerCode)) {
        groupMap.set(centerCode, {
          centerCode,
          centerName: centerCode, // Will be replaced with description if available
          transactions: [],
          totalWeight: 0
        });
      }
      
      const group = groupMap.get(centerCode)!;
      group.transactions.push(tx);
      group.totalWeight += tx.weight;
    }
    
    return Array.from(groupMap.values());
  }, [data?.transactions]);
  
  // Check if we have multiple centers
  const hasMultipleCenters = centerGroups.length > 1;
  
  if (!data) return null;

  // Format date as DD/MM/YYYY
  const formattedDate = new Date(data.date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  
  // Format print time as DD/MM/YYYY - HH:MM AM/PM
  const now = new Date();
  const printDate = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const printTime = now.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true
  }).toUpperCase();

  const handlePrint = async () => {
    if (!data) return;
    
    setIsPrinting(true);
    
    try {
      const printerConnected = isPrinterConnected();
      
      if (printerConnected) {
        // Send Z Report data to thermal printer
        const result = await printZReport({
          companyName: data.companyName,
          produceLabel: data.produceLabel,
          periodLabel: data.periodLabel,
          seasonName: data.seasonName,
          date: data.date,
          factoryName: routeName || data.routeLabel || 'FACTORY',
          produceName: data.produceName,
          transactions: data.transactions,
          totalWeight: data.totals.weight,
          clerkName: data.clerkName,
          deviceCode: data.deviceCode,
          isCoffee: data.isCoffee,
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

  const weightUnit = data.isCoffee ? 'KGS' : 'LTS';
  const routeLabel = data.routeLabel || 'Center';

  // Render a single center's transactions section
  const renderCenterSection = (group: CenterGroup, showHeader: boolean, isLast: boolean) => (
    <div key={group.centerCode}>
      {/* Center Header (only when multiple centers) */}
      {showHeader && (
        <div className="border-t border-dashed pt-2 mt-2">
          <p className="font-semibold text-center">{routeLabel}: {group.centerName}</p>
        </div>
      )}
      
      {/* Transaction List Header */}
      <div className="border-t border-b border-dashed py-1 mt-1">
        <div className="grid grid-cols-4 gap-1 font-bold text-center">
          <span>MNO</span>
          <span>REFNO</span>
          <span>QTY</span>
          <span>TIME</span>
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-0.5 py-1">
        {group.transactions.map((tx, index) => (
          <div key={tx.transrefno || index} className="grid grid-cols-4 gap-1 text-center text-[11px]">
            <span className="truncate">{tx.farmer_id}</span>
            <span className="truncate">{tx.refno}</span>
            <span>{tx.weight.toFixed(1)}</span>
            <span>{tx.time}</span>
          </div>
        ))}
        {group.transactions.length === 0 && (
          <div className="text-center text-muted-foreground italic py-2">
            No transactions
          </div>
        )}
      </div>

      {/* Center Subtotal (only when multiple centers) */}
      {showHeader && (
        <div className="border-t border-dashed pt-1">
          <div className="flex justify-between text-sm">
            <span className="font-semibold">{routeLabel} Total</span>
            <span className="font-semibold">{group.totalWeight.toFixed(2)} {weightUnit}</span>
          </div>
        </div>
      )}
      
      {/* Dotted line separator between centers */}
      {showHeader && !isLast && (
        <div className="text-center text-muted-foreground my-1">
          · · · · · · · · · · · · · · · · · ·
        </div>
      )}
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

          {/* Center (displayed only when single center - otherwise shown per group) */}
          {!hasMultipleCenters && centerGroups.length > 0 && (
            <div className="flex pb-1">
              <span className="font-semibold">* {routeLabel.toUpperCase()}:</span>
              <span className="ml-2">{routeName || centerGroups[0].centerName}</span>
            </div>
          )}

          {/* Produce */}
          <div className="flex pb-2">
            <span className="font-semibold">* PRODUCE:</span>
            <span className="ml-2">{data.produceName || data.produceLabel.toUpperCase()}</span>
          </div>

          {/* Transaction List - grouped by center if multiple centers */}
          <div className="max-h-60 overflow-y-auto">
            {hasMultipleCenters ? (
              // Multiple centers - show grouped with headers
              centerGroups.map((group, idx) => 
                renderCenterSection(group, true, idx === centerGroups.length - 1)
              )
            ) : (
              // Single center - flat list
              <>
                {/* Transaction List Header */}
                <div className="border-t border-b border-dashed py-1">
                  <div className="grid grid-cols-4 gap-1 font-bold text-center">
                    <span>MNO</span>
                    <span>REFNO</span>
                    <span>QTY</span>
                    <span>TIME</span>
                  </div>
                </div>

                {/* Transaction List */}
                <div className="space-y-0.5 py-1">
                  {data.transactions.map((tx, index) => (
                    <div key={tx.transrefno || index} className="grid grid-cols-4 gap-1 text-center text-[11px]">
                      <span className="truncate">{tx.farmer_id}</span>
                      <span className="truncate">{tx.refno}</span>
                      <span>{tx.weight.toFixed(1)}</span>
                      <span>{tx.time}</span>
                    </div>
                  ))}
                  {data.transactions.length === 0 && (
                    <div className="text-center text-muted-foreground italic py-2">
                      No transactions
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Grand Totals */}
          <div className="border-t border-dashed pt-2 mt-1">
            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL</span>
              <span>{data.totals.weight.toFixed(2)} {weightUnit}</span>
            </div>
          </div>

          {/* Footer: Clerk, Print Time, Device Code */}
          <div className="border-t border-dashed pt-2 mt-2 space-y-1">
            <div className="flex justify-between">
              <span className="font-semibold">CLERK</span>
              <span className="uppercase">{data.clerkName}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold">PRINTED ON</span>
              <span>{printDate} - {printTime}</span>
            </div>
            <div className="flex justify-between font-bold text-sm pt-1">
              <span>DEVICE CODE</span>
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
