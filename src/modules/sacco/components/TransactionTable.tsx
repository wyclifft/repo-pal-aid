/**
 * v2.12.0 — Yetu Sacco transaction table with sortable headers, loading
 * skeletons, empty states and row selection for the detail sheet.
 */
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ArrowDown, ArrowUp, Inbox, SearchX } from 'lucide-react';
import { formatDateTime, formatMoney, type SaccoTransaction, type SortField, type SortOrder } from '../saccoApi';

interface Props {
  rows: SaccoTransaction[];
  isLoading: boolean;
  hasFilters: boolean;
  sort: SortField;
  order: SortOrder;
  onSort: (field: SortField) => void;
  onSelect: (txn: SaccoTransaction) => void;
}

const HEADERS: { field: SortField; label: string; className?: string }[] = [
  { field: 'transaction_date', label: 'Date' },
  { field: 'transaction_reference', label: 'Reference' },
  { field: 'payer_name', label: 'Payer' },
  { field: 'amount', label: 'Amount', className: 'text-right' },
];

export const TransactionTable = ({
  rows, isLoading, hasFilters, sort, order, onSort, onSelect,
}: Props) => {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border p-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="mb-2 h-10 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        {hasFilters ? (
          <>
            <SearchX className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-foreground">No results for this filter</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a different search term or date range.</p>
          </>
        ) : (
          <>
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-foreground">No contributions yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Deposits confirmed by Yetu Sacco will appear here automatically.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {HEADERS.map((h) => (
              <TableHead
                key={h.field}
                className={`cursor-pointer select-none whitespace-nowrap ${h.className || ''}`}
                onClick={() => onSort(h.field)}
              >
                <span className="inline-flex items-center">
                  {h.label}
                  {sort === h.field && (
                    order === 'asc'
                      ? <ArrowUp className="ml-1 h-3 w-3" />
                      : <ArrowDown className="ml-1 h-3 w-3" />
                  )}
                </span>
              </TableHead>
            ))}
            <TableHead className="whitespace-nowrap">Channel</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.txn_id}
              className="cursor-pointer"
              onClick={() => onSelect(r)}
            >
              <TableCell className="whitespace-nowrap">{formatDateTime(r.transaction_date)}</TableCell>
              <TableCell className="font-mono text-xs">{r.transaction_reference}</TableCell>
              <TableCell>
                <div className="font-medium text-foreground">{r.payer_name || '—'}</div>
                <div className="text-xs text-muted-foreground">{r.payer_mobile || ''}</div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-semibold">
                {formatMoney(r.amount)}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{r.channel}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default TransactionTable;
