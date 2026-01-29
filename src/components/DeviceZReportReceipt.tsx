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

// Helper to group by produce type
interface ProduceGroup {
  produceName: string;
  productCode: string;
  centerGroups: CenterGroup[];
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
  
  // Group transactions by produce type, then by center (route)
  const produceGroups = useMemo<ProduceGroup[]>(() => {
    if (!data?.transactions?.length) return [];
    
    const produceMap = new Map<string, ProduceGroup>();
    
    for (const tx of data.transactions) {
      const productCode = tx.product_code || 'DEFAULT';
      const productName = tx.product_name || data.produceName || data.produceLabel;
      
      if (!produceMap.has(productCode)) {
        produceMap.set(productCode, {
          productCode,
          produceName: productName,
          centerGroups: [],
          totalWeight: 0
        });
      }
      
      const produceGroup = produceMap.get(productCode)!;
      produceGroup.totalWeight += tx.weight;
      
      // Find or create center group within this produce
      const centerCode = tx.route || 'Unknown';
      const centerName = tx.route_name || centerCode;
      
      let centerGroup = produceGroup.centerGroups.find(g => g.centerCode === centerCode);
      if (!centerGroup) {
        centerGroup = {
          centerCode,
          centerName,
          transactions: [],
          totalWeight: 0
        };
        produceGroup.centerGroups.push(centerGroup);
      }
      
      centerGroup.transactions.push(tx);
      centerGroup.totalWeight += tx.weight;
    }
    
    return Array.from(produceMap.values());
  }, [data?.transactions, data?.produceName, data?.produceLabel]);
  
  // Check if we have multiple produces or multiple centers
  const hasMultipleProduces = produceGroups.length > 1;
  const hasMultipleCenters = produceGroups.some(pg => pg.centerGroups.length > 1) || 
    (produceGroups.length === 1 && produceGroups[0].centerGroups.length > 1);
  
  // For single produce single center - get the center name
  const singleCenterName = !hasMultipleProduces && !hasMultipleCenters && produceGroups.length > 0 && produceGroups[0].centerGroups.length > 0
    ? produceGroups[0].centerGroups[0].centerName
    : routeName || '';
  
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
        // Send Z Report data to thermal printer - include route_name for grouping
        const result = await printZReport({
          companyName: data.companyName,
          produceLabel: data.produceLabel,
          periodLabel: data.periodLabel,
          seasonName: data.seasonName,
          date: data.date,
          factoryName: singleCenterName || routeName || data.routeLabel || 'FACTORY',
          routeLabel: data.routeLabel || 'Center',
          produceName: data.produceName,
          transactions: data.transactions.map(tx => ({
            farmer_id: tx.farmer_id,
            refno: tx.refno,
            weight: tx.weight,
            time: tx.time,
            route: tx.route,
            route_name: tx.route_name, // Pass full center name
            product_code: tx.product_code,
            product_name: tx.product_name,
          })),
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
  const renderCenterSection = (group: CenterGroup, showHeader: boolean, isLast: boolean, showSubtotal: boolean = true) => (
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

      {/* Center Subtotal (only when multiple centers within same produce) */}
      {showHeader && showSubtotal && (
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

  // Render a produce group section
  const renderProduceSection = (produce: ProduceGroup, isFirst: boolean, isLast: boolean) => (
    <div key={produce.productCode}>
      {/* Produce Header - shown when multiple produces */}
      {hasMultipleProduces && (
        <div className={`${!isFirst ? 'border-t-2 border-double mt-3 pt-2' : ''}`}>
          <p className="font-bold text-center uppercase">{produce.produceName}</p>
          <div className="text-center text-muted-foreground my-1">
            · · · · · · · · · · · · · · · · · ·
          </div>
        </div>
      )}
      
      {/* Centers within this produce */}
      {produce.centerGroups.length > 1 ? (
        // Multiple centers - show grouped with headers
        produce.centerGroups.map((group, idx) => 
          renderCenterSection(group, true, idx === produce.centerGroups.length - 1)
        )
      ) : produce.centerGroups.length === 1 ? (
        // Single center - just show center name once, then flat list
        <>
          {hasMultipleProduces && (
            <div className="flex pb-1">
              <span className="font-semibold">* {routeLabel.toUpperCase()}:</span>
              <span className="ml-2">{produce.centerGroups[0].centerName}</span>
            </div>
          )}
          {renderCenterSection(produce.centerGroups[0], false, true, false)}
        </>
      ) : null}
      
      {/* Produce Subtotal (only when multiple produces) */}
      {hasMultipleProduces && (
        <div className="border-t border-dashed pt-1 mt-1">
          <div className="flex justify-between text-sm font-bold">
            <span>{produce.produceName} TOTAL</span>
            <span>{produce.totalWeight.toFixed(2)} {weightUnit}</span>
          </div>
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

          {/* Center (displayed only when single produce & single center - otherwise shown per group) */}
          {!hasMultipleProduces && !hasMultipleCenters && singleCenterName && (
            <div className="flex pb-1">
              <span className="font-semibold">* {routeLabel.toUpperCase()}:</span>
              <span className="ml-2">{singleCenterName}</span>
            </div>
          )}

          {/* Produce (displayed only when single produce type - otherwise shown per group) */}
          {!hasMultipleProduces && (
            <div className="flex pb-2">
              <span className="font-semibold">* PRODUCE:</span>
              <span className="ml-2">{produceGroups.length > 0 ? produceGroups[0].produceName : (data.produceName || data.produceLabel.toUpperCase())}</span>
            </div>
          )}

          {/* Transaction List - grouped by produce then by center */}
          <div className="max-h-60 overflow-y-auto">
            {hasMultipleProduces || hasMultipleCenters ? (
              // Multiple produces or centers - show grouped
              produceGroups.map((produce, idx) => 
                renderProduceSection(produce, idx === 0, idx === produceGroups.length - 1)
              )
            ) : produceGroups.length > 0 && produceGroups[0].centerGroups.length > 0 ? (
              // Single produce, single center - flat list
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
                  {produceGroups[0].centerGroups[0].transactions.map((tx, index) => (
                    <div key={tx.transrefno || index} className="grid grid-cols-4 gap-1 text-center text-[11px]">
                      <span className="truncate">{tx.farmer_id}</span>
                      <span className="truncate">{tx.refno}</span>
                      <span>{tx.weight.toFixed(1)}</span>
                      <span>{tx.time}</span>
                    </div>
                  ))}
                  {produceGroups[0].centerGroups[0].transactions.length === 0 && (
                    <div className="text-center text-muted-foreground italic py-2">
                      No transactions
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center text-muted-foreground italic py-2">
                No transactions
              </div>
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
