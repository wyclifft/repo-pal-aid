/**
 * v2.12.0 — Yetu Sacco portal filters: search, date range, page size, reset.
 * Native date inputs are used deliberately: they behave reliably on
 * Android 7 / WebView 51 and never overlay other fields.
 */
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Search, X } from 'lucide-react';

export interface FilterState {
  search: string;
  from: string;
  to: string;
  limit: number;
}

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
  onReset: () => void;
}

export const TransactionFilters = ({ value, onChange, onReset }: Props) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="grid grid-cols-1 md:grid-cols-4">
      <div className="p-1 md:col-span-2">
        <Label htmlFor="sacco-search" className="text-xs text-muted-foreground">Search</Label>
        <div className="relative mt-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="sacco-search"
            className="pl-8"
            placeholder="Reference, payer name or mobile"
            value={value.search}
            onChange={(e) => onChange({ ...value, search: e.target.value })}
          />
        </div>
      </div>
      <div className="p-1">
        <Label htmlFor="sacco-from" className="text-xs text-muted-foreground">From</Label>
        <Input
          id="sacco-from"
          type="date"
          className="mt-1"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
      </div>
      <div className="p-1">
        <Label htmlFor="sacco-to" className="text-xs text-muted-foreground">To</Label>
        <Input
          id="sacco-to"
          type="date"
          className="mt-1"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </div>
    </div>
    <div className="mt-2 flex items-center justify-between">
      <div className="flex items-center">
        <Label htmlFor="sacco-limit" className="mr-2 text-xs text-muted-foreground">Rows</Label>
        <select
          id="sacco-limit"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={value.limit}
          onChange={(e) => onChange({ ...value, limit: Number(e.target.value) })}
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onReset}>
        <X className="mr-1 h-4 w-4" /> Clear filters
      </Button>
    </div>
  </div>
);

export default TransactionFilters;
