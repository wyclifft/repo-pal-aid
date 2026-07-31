/**
 * v2.12.0 — Full transaction record viewer.
 * Uses Dialog (already capped at 92vh with internal scrolling for WebView 51).
 */
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime, formatMoney, type SaccoTransaction } from '../saccoApi';

interface Props {
  txn: SaccoTransaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between border-b border-border py-2">
    <span className="mr-3 text-sm text-muted-foreground">{label}</span>
    <span className="text-right text-sm font-medium text-foreground break-all">{value}</span>
  </div>
);

export const TransactionDetailSheet = ({ txn, open, onOpenChange }: Props) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Transaction details</DialogTitle>
        <DialogDescription>Full record of this Yetu Sacco deposit.</DialogDescription>
      </DialogHeader>
      {txn && (
        <div>
          <Row label="Reference" value={txn.transaction_reference} />
          <Row label="Amount" value={formatMoney(txn.amount)} />
          <Row label="Date" value={formatDateTime(txn.transaction_date)} />
          <Row label="Payer name" value={txn.payer_name || '—'} />
          <Row label="Payer mobile" value={txn.payer_mobile || '—'} />
          <Row label="Channel" value={txn.channel} />
          <Row label="Type" value={txn.txn_type} />
          <Row label="Allocation" value={txn.allocation_status} />
        </div>
      )}
    </DialogContent>
  </Dialog>
);

export default TransactionDetailSheet;
