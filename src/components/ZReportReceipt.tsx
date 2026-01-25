import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Printer, Download, X } from 'lucide-react';
import { printReceipt } from '@/services/bluetooth';
import { toast } from 'sonner';
import { generateZReportPDF } from '@/utils/pdfExport';
import type { ZReportData } from '@/services/mysqlApi';

interface ZReportReceiptProps {
  data: ZReportData | null;
  open: boolean;
  onClose: () => void;
  onPrint?: () => void;
  // Company info
  companyName?: string;
  // App settings
  produceLabel?: string;
  routeLabel?: string;
  periodLabel?: string;
  weightLabel?: string;
  weightUnit?: string;
  isCoffee?: boolean;
}

export const ZReportReceipt = ({ 
  data, 
  open, 
  onClose, 
  onPrint,
  companyName,
  produceLabel = 'MILK',
  routeLabel = 'Route',
  periodLabel = 'Session',
  weightLabel = 'Litres',
  weightUnit = 'L',
  isCoffee = false
}: ZReportReceiptProps) => {
  if (!data) return null;

  const formattedDate = new Date(data.date).toLocaleDateString('en-CA');
  const formattedTime = new Date().toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });

  const handlePrint = async () => {
    // Try thermal print first, then fallback to browser
    try {
      window.print();
      toast.success('Z-report printed');
      onPrint?.();
    } catch (err) {
      console.error('Print failed:', err);
      toast.error('Failed to print Z-report');
    }
  };

  const handleDownloadPDF = () => {
    if (data) {
      generateZReportPDF(data, produceLabel);
      toast.success('PDF downloaded');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm font-mono text-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-0">
          <DialogTitle className="sr-only">Z Report</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {/* Header */}
          <div className="text-center border-b border-dashed pb-2">
            <h3 className="font-bold text-base">{companyName || 'Z REPORT'}</h3>
            <p className="text-xs text-muted-foreground">{produceLabel.toUpperCase()} COLLECTION Z REPORT</p>
          </div>

          {/* Date/Time Info */}
          <div className="space-y-0.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="font-semibold">{formattedDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Time</span>
              <span className="font-medium">{formattedTime}</span>
            </div>
          </div>

          {/* Summary Totals */}
          <div className="border-t border-b border-dashed py-2 space-y-1">
            <div className="text-xs font-bold text-center mb-1">SUMMARY</div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total {weightLabel}</span>
              <span className="font-bold">{data.totals.liters.toFixed(2)} {weightUnit}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total Farmers</span>
              <span className="font-bold">{data.totals.farmers}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Total Entries</span>
              <span className="font-bold">{data.totals.entries}</span>
            </div>
          </div>

          {/* By Session - Only for dairy (non-coffee) */}
          {!isCoffee && (
            <div className="border-b border-dashed pb-2 space-y-1">
              <div className="text-xs font-bold">BY {periodLabel.toUpperCase()}</div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Morning (AM)</span>
                <span className="font-medium">
                  {data.bySession.AM.entries} ({data.bySession.AM.liters.toFixed(2)}{weightUnit})
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Evening (PM)</span>
                <span className="font-medium">
                  {data.bySession.PM.entries} ({data.bySession.PM.liters.toFixed(2)}{weightUnit})
                </span>
              </div>
            </div>
          )}

          {/* By Route/Center */}
          <div className="border-b border-dashed pb-2 space-y-1">
            <div className="text-xs font-bold">BY {routeLabel.toUpperCase()}</div>
            {Object.entries(data.byRoute).map(([route, routeData]) => (
              <div key={route} className="flex justify-between text-xs">
                <span className="text-muted-foreground truncate max-w-[60%]">{route}</span>
                <span className="font-medium">{routeData.total.toFixed(2)}{weightUnit}</span>
              </div>
            ))}
            {Object.keys(data.byRoute).length === 0 && (
              <div className="text-xs text-muted-foreground italic">No data</div>
            )}
          </div>

          {/* By Collector */}
          <div className="border-b border-dashed pb-2 space-y-1">
            <div className="text-xs font-bold">BY COLLECTOR</div>
            {Object.entries(data.byCollector).map(([collector, collectorData]) => (
              <div key={collector} className="flex justify-between text-xs">
                <span className="text-muted-foreground truncate max-w-[60%]">{collector}</span>
                <span className="font-medium">{collectorData.liters.toFixed(2)}{weightUnit}</span>
              </div>
            ))}
            {Object.keys(data.byCollector).length === 0 && (
              <div className="text-xs text-muted-foreground italic">No data</div>
            )}
          </div>

          {/* Footer */}
          <div className="text-center text-muted-foreground text-xs pt-1">
            Generated: {formattedDate} at {formattedTime}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handlePrint}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button
            onClick={handleDownloadPDF}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md font-medium hover:bg-secondary/80 transition-colors flex items-center justify-center gap-2"
          >
            <Download className="h-4 w-4" />
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
