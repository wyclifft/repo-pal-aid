import { useState } from "react";
import { format } from "date-fns";
import { Printer, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mysqlApi, type FarmerDetailReportData } from "@/services/mysqlApi";
import { printMemberProduceStatement } from "@/services/bluetooth";
import { toast } from "sonner";

interface PeriodicReportReceiptProps {
  open: boolean;
  onClose: () => void;
  farmerId: string;
  farmerName: string;
  startDate: Date;
  endDate: Date;
  deviceFingerprint: string;
  weightUnit: string;
}

export function PeriodicReportReceipt({
  open,
  onClose,
  farmerId,
  farmerName,
  startDate,
  endDate,
  deviceFingerprint,
  weightUnit,
}: PeriodicReportReceiptProps) {
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [data, setData] = useState<FarmerDetailReportData | null>(null);

  const loadData = async () => {
    if (!deviceFingerprint) return;
    
    setLoading(true);
    try {
      const formattedStartDate = format(startDate, "yyyy-MM-dd");
      const formattedEndDate = format(endDate, "yyyy-MM-dd");
      
      const response = await mysqlApi.periodicReport.getFarmerDetail(
        formattedStartDate,
        formattedEndDate,
        farmerId,
        deviceFingerprint
      );

      if (response.success && response.data) {
        setData(response.data);
      } else {
        toast.error(response.error || "Failed to load farmer details");
        onClose();
      }
    } catch (error) {
      console.error("Error loading farmer detail:", error);
      toast.error("Failed to load farmer details");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  // Load data when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      loadData();
    } else {
      setData(null);
      onClose();
    }
  };

  const handlePrint = async () => {
    if (!data) return;
    
    setPrinting(true);
    try {
      const result = await printMemberProduceStatement({
        companyName: data.company_name,
        farmerId: data.farmer_id,
        farmerName: data.farmer_name,
        produceName: data.produce_name,
        startDate: data.start_date,
        endDate: data.end_date,
        transactions: data.transactions.map(tx => ({
          date: tx.date,
          rec_no: tx.rec_no,
          quantity: tx.quantity,
        })),
        totalWeight: data.total_weight,
      });

      if (result.success) {
        toast.success("Statement printed successfully");
      } else {
        toast.error(result.error || "Failed to print statement");
      }
    } catch (error) {
      console.error("Print error:", error);
      toast.error("Failed to print statement");
    } finally {
      setPrinting(false);
    }
  };

  const formatDisplayDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Member Produce Statement
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* Receipt Preview */}
            <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs space-y-2">
              {/* Header */}
              <div className="text-center font-bold">{data.company_name}</div>
              <div className="border-t border-dashed border-muted-foreground/40" />
              
              <div className="text-center font-bold">MEMBER PRODUCE STATEMENT</div>
              <div className="text-center text-[11px]">
                From {formatDisplayDate(data.start_date)} — To {formatDisplayDate(data.end_date)}
              </div>
              <div className="border-t border-dashed border-muted-foreground/40" />
              
              {/* Produce Type */}
              <div className="text-center font-bold">{data.produce_name.toUpperCase()} RECORD</div>
              <div className="border-t border-dashed border-muted-foreground/40" />
              
              {/* Member Info */}
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>MEMBER NO:</span>
                  <span>{data.farmer_id}</span>
                </div>
                <div className="border-b border-dotted border-muted-foreground/30" />
                <div className="flex justify-between">
                  <span>MEMBER NAME:</span>
                  <span className="text-right max-w-[50%] truncate">{data.farmer_name}</span>
                </div>
                <div className="border-b border-dotted border-muted-foreground/30" />
              </div>
              
              {/* Transaction Header */}
              <div className="grid grid-cols-3 font-bold text-[10px] pt-2">
                <span>DATE</span>
                <span className="text-center">REC NO</span>
                <span className="text-right">QUANTITY</span>
              </div>
              <div className="border-t border-dashed border-muted-foreground/40" />
              
              {/* Transactions */}
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {data.transactions.map((tx, idx) => (
                  <div key={idx} className="grid grid-cols-3 text-[10px]">
                    <span>{formatDisplayDate(tx.date)}</span>
                    <span className="text-center">{tx.rec_no?.slice(-5) || '-----'}</span>
                    <span className="text-right">{Number(tx.quantity).toFixed(1)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-muted-foreground/40" />
              
              {/* Total */}
              <div className="flex justify-between font-bold pt-1">
                <span>TOTAL:</span>
                <span>{data.total_weight.toFixed(2)} {weightUnit}</span>
              </div>
              <div className="border-t border-dashed border-muted-foreground/40" />
              
              {/* Footer */}
              <div className="text-[10px] text-muted-foreground pt-1">
                Report printed on {format(new Date(), "dd/MM/yyyy HH:mm")}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={onClose}
              >
                <X className="h-4 w-4 mr-1" />
                Close
              </Button>
              <Button
                className="flex-1"
                onClick={handlePrint}
                disabled={printing}
              >
                {printing ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4 mr-1" />
                )}
                {printing ? "Printing..." : "Print"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
