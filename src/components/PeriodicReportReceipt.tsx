import { useState, useEffect } from "react";
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
import { useIndexedDB } from "@/hooks/useIndexedDB";
import { buildFarmerDetailFromCache } from "@/utils/periodicReportLocal";
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
  // v2.10.53: optional route scope (tcode) to filter cross-device transactions
  route?: string;
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
  route,
}: PeriodicReportReceiptProps) {
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [data, setData] = useState<FarmerDetailReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load data when dialog opens
  useEffect(() => {
    if (open && deviceFingerprint && farmerId) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, farmerId, deviceFingerprint, route]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    
    try {
      const formattedStartDate = format(startDate, "yyyy-MM-dd");
      const formattedEndDate = format(endDate, "yyyy-MM-dd");
      
      console.log('📄 Fetching farmer detail:', { farmerId, formattedStartDate, formattedEndDate, route });
      
      const response = await mysqlApi.periodicReport.getFarmerDetail(
        formattedStartDate,
        formattedEndDate,
        farmerId,
        deviceFingerprint,
        route
      );

      console.log('📄 Farmer detail response:', response);

      if (response.success && response.data) {
        setData(response.data);
      } else {
        setError(response.error || "Failed to load farmer details");
        toast.error(response.error || "Failed to load farmer details");
      }
    } catch (err) {
      console.error("Error loading farmer detail:", err);
      setError("Failed to load farmer details");
      toast.error("Failed to load farmer details");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setData(null);
    setError(null);
    setLoading(true);
    onClose();
  };

  // v2.10.55: Resolve a CENTER name with priority:
  //   active dashboard route → backend transaction route name → backend transaction route code
  //   → farmer registered route name → farmer registered route code
  const resolveCenterName = (): string => {
    try {
      const raw = localStorage.getItem('active_session_data');
      if (raw) {
        const parsed = JSON.parse(raw);
        const r = parsed?.route;
        const active = (r?.descript || r?.tcode || '').toString().trim();
        if (active) return active;
      }
    } catch (e) {
      // ignore localStorage parse errors
    }
    if (data?.transaction_route_name?.trim()) return data.transaction_route_name.trim();
    if (data?.transaction_route?.trim()) return data.transaction_route.trim();
    if (data?.farmer_route_name?.trim()) return data.farmer_route_name.trim();
    if (data?.farmer_route?.trim()) return data.farmer_route.trim();
    return '';
  };

  const handlePrint = async () => {
    if (!data) return;
    
    setPrinting(true);
    try {
      const centerName = resolveCenterName();
      console.log('🖨️ Printing member statement:', { ...data, centerName });
      
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
        centerName,
      });

      console.log('🖨️ Print result:', result);

      if (result.success) {
        toast.success("Statement printed successfully");
      } else {
        toast.error(result.error || "Failed to print statement");
      }
    } catch (err) {
      console.error("Print error:", err);
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
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Member Produce Statement
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading statement...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <p className="text-destructive text-center">{error}</p>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* Receipt Preview */}
            <div className="bg-muted/50 rounded-lg p-4 font-mono text-xs space-y-2">
              {/* Header */}
              <div className="text-center font-bold">{data.company_name}</div>
              {/* v2.10.55: CENTER line (mirrors print output) */}
              {(() => {
                const centerName = resolveCenterName();
                return centerName ? (
                  <div className="text-center font-semibold">CENTER: {centerName.toUpperCase()}</div>
                ) : null;
              })()}
              <div className="border-t border-dashed border-muted-foreground/40" />
              
              <div className="text-center font-bold">MEMBER PRODUCE STATEMENT</div>
              <div className="text-center text-[11px]">
                From {formatDisplayDate(data.start_date)} — To {formatDisplayDate(data.end_date)}
              </div>
              <div className="border-t border-dashed border-muted-foreground/40" />
              
              {/* Produce Type — v2.10.55: enforce centered flex layout */}
              <div className="flex justify-center font-bold">
                <span>{data.produce_name.toUpperCase().trim()} RECORD</span>
              </div>
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
              
              {/* Transaction Header — v2.10.55: explicit columns to mirror print spacing */}
              <div className="grid font-bold text-[10px] pt-2" style={{ gridTemplateColumns: '12ch 7ch 1fr' }}>
                <span>DATE</span>
                <span>REC NO</span>
                <span className="text-right">QUANTITY</span>
              </div>
              <div className="border-t border-dashed border-muted-foreground/40" />
              
              {/* Transactions */}
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {data.transactions.length > 0 ? (
                  data.transactions.map((tx, idx) => (
                    <div key={idx} className="grid text-[10px]" style={{ gridTemplateColumns: '12ch 7ch 1fr' }}>
                      <span>{formatDisplayDate(tx.date)}</span>
                      <span>{tx.rec_no?.slice(-5) || '-----'}</span>
                      <span className="text-right">{Number(tx.quantity).toFixed(1)}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-muted-foreground py-2">
                    No transactions found
                  </div>
                )}
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
                onClick={handleClose}
              >
                <X className="h-4 w-4 mr-1" />
                Close
              </Button>
              <Button
                className="flex-1"
                onClick={handlePrint}
                disabled={printing || data.transactions.length === 0}
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
