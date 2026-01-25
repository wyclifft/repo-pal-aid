/**
 * Device-specific Z Report Receipt Component
 * Matches handwritten layout: Company → Summary → Season/Date → Factory → Produce →
 * Transaction List (MNO, REFNO, QTY, TIME) → Total → Clerk → Print Time → Device Code
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Printer, Download, X, Loader2 } from 'lucide-react';
import { isPrinterConnected, verifyPrinterConnection } from '@/services/bluetooth';
import { toast } from 'sonner';
import { generateDeviceZReportPDF } from '@/utils/pdfExport';
import type { DeviceZReportData } from '@/services/mysqlApi';

interface DeviceZReportReceiptProps {
  data: DeviceZReportData | null;
  open: boolean;
  onClose: () => void;
  onPrint?: () => void;
}

export const DeviceZReportReceipt = ({ 
  data, 
  open, 
  onClose, 
  onPrint
}: DeviceZReportReceiptProps) => {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  if (!data) return null;

  const formattedDate = new Date(data.date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  
  const formattedTime = new Date().toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true
  }).toUpperCase();

  const handlePrint = async () => {
    setIsPrinting(true);
    
    try {
      const printerConnected = isPrinterConnected();
      
      if (printerConnected) {
        const verified = await verifyPrinterConnection();
        if (verified) {
          window.print();
          toast.success('Z-report sent to printer');
          onPrint?.();
        } else {
          window.print();
          toast.info('Sent to system print dialog');
          onPrint?.();
        }
      } else {
        window.print();
        toast.info('Opened print dialog');
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
      const success = await generateDeviceZReportPDF(data);
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

  const weightUnit = data.isCoffee ? 'KG' : 'L';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md font-mono text-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-0">
          <DialogTitle className="sr-only">Device Z Report</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 text-xs">
          {/* Header - Company Name */}
          <div className="text-center border-b border-dashed pb-2">
            <h3 className="font-bold text-base uppercase">{data.companyName}</h3>
          </div>

          {/* Summary Type */}
          <div className="text-center">
            <p className="font-semibold">* {data.produceLabel.toUpperCase()} SUMMARY</p>
          </div>

          {/* Season/Session & Date */}
          <div className="space-y-0.5">
            <div className="flex">
              <span className="font-semibold">* {data.periodLabel.toUpperCase()}:</span>
              <span className="ml-2">{data.seasonName}</span>
            </div>
            <div className="flex">
              <span className="font-semibold">* DATE:</span>
              <span className="ml-2">{formattedDate}</span>
            </div>
          </div>

          {/* Factory/Route */}
          <div className="space-y-0.5">
            <div className="flex">
              <span className="font-semibold">* {data.routeLabel.toUpperCase()} FACTORY</span>
            </div>
          </div>

          {/* Produce */}
          <div className="flex">
            <span className="font-semibold">* PRODUCE:</span>
            <span className="ml-2">{data.produceName || data.produceLabel.toUpperCase()}</span>
          </div>

          {/* Transaction List Header */}
          <div className="border-t border-b border-dashed py-1 mt-2">
            <div className="grid grid-cols-4 gap-1 font-bold text-center">
              <span>MNO</span>
              <span>REFNO</span>
              <span>QTY</span>
              <span>TIME</span>
            </div>
          </div>

          {/* Transaction List */}
          <div className="space-y-0.5 max-h-60 overflow-y-auto">
            {data.transactions.map((tx, index) => (
              <div key={tx.transrefno || index} className="grid grid-cols-4 gap-1 text-center">
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

          {/* Totals */}
          <div className="border-t border-dashed pt-2 mt-2">
            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL</span>
              <span>{data.totals.weight.toFixed(2)} {weightUnit}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Entries</span>
              <span>{data.totals.entries}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Farmers</span>
              <span>{data.totals.farmers}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-dashed pt-2 mt-2 space-y-0.5">
            <div className="flex">
              <span className="font-semibold">CLERK:</span>
              <span className="ml-2">{data.clerkName}</span>
            </div>
            <div className="flex">
              <span className="font-semibold">PRINTED ON:</span>
              <span className="ml-2">{formattedDate} - {formattedTime}</span>
            </div>
            <div className="flex font-bold">
              <span>DEVICE CODE:</span>
              <span className="ml-2">{data.deviceCode}</span>
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
