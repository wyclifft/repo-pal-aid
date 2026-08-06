/**
 * v2.12.0 — Yetu Sacco member portal.
 *
 * Dedicated experience for Sacco organisations (psettings.orgtype = 'S'):
 * a member logs in and reviews their own deposit history. No collection,
 * store, AI or reporting modules are reachable in this mode.
 *
 * Android 7 / WebView 51 safe: vh units only (no dvh), margin-based spacing,
 * no backdrop-filter, native date inputs.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import {
  AlertTriangle, Download, LogOut, RefreshCw, ShieldAlert, WifiOff,
} from 'lucide-react';
import { Login } from '@/components/Login';
import { useAuth } from '@/contexts/AuthContext';
import { useAppSettings } from '@/hooks/useAppSettings';
import { type AppUser } from '@/lib/supabase';
import { saveExportedFile } from '@/utils/nativeFileExport';
import { useSaccoAccess } from './useSaccoAccess';
import { useSaccoSummary, useSaccoTransactions } from './useSaccoTransactions';
import { formatDateTime, formatMoney, type SaccoTransaction, type SortField, type SortOrder } from './saccoApi';
import SummaryCards from './components/SummaryCards';
import TransactionFilters, { type FilterState } from './components/TransactionFilters';
import TransactionTable from './components/TransactionTable';
import TransactionDetailSheet from './components/TransactionDetailSheet';

const DEFAULT_FILTERS: FilterState = { search: '', from: '', to: '', limit: 20 };

/** Local HH:MM clock for the live-refresh indicator (never toISOString). */
const formatClock = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};


const SaccoPortal = () => {
  const { currentUser, isAuthenticated, login, logout } = useAuth();
  // v2.12.6: header text comes from psettings (company name), never hardcoded.
  const { companyName } = useAppSettings();
  const portalTitle = (companyName || '').trim()
    ? `${companyName.trim()} Payments`
    : 'Member Payments';
  const { isSacco, paymentsActive, canAccessPayments } = useSaccoAccess();

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortField>('transaction_date');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [selected, setSelected] = useState<SaccoTransaction | null>(null);
  // v2.12.8: '' means "let the server pick the first linked account".
  const [account, setAccount] = useState<string>('');

  const userid = currentUser?.user_id;
  const query = useMemo(
    () => ({
      page,
      limit: filters.limit,
      search: filters.search.trim(),
      from: filters.from || undefined,
      to: filters.to || undefined,
      sort,
      order,
      account: account || undefined,
    }),
    [page, filters, sort, order, account]
  );

  const summaryQuery = useSaccoSummary(isAuthenticated ? userid : undefined, account || undefined);
  const txnQuery = useSaccoTransactions(isAuthenticated ? userid : undefined, query);

  // v2.12.8: accounts the user may view (from Users.link_account, split on '#').
  const accounts: string[] =
    summaryQuery.data?.accounts || txnQuery.data?.accounts || [];
  const activeAccount =
    account || summaryQuery.data?.account_number || txnQuery.data?.account_number || '';

  const handleAccountChange = (next: string) => {
    setAccount(next);
    setPage(1);
    setSelected(null);
  };


  const handleLogin = (user: AppUser, offline: boolean, password?: string) => {
    login(user, offline, password);
  };

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  // Gate: company must be a Sacco with payments active, user must be permitted.
  if (!isSacco || !paymentsActive || !canAccessPayments) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center p-6">
        <Alert className="max-w-md">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Member portal unavailable</AlertTitle>
          <AlertDescription>
            {!isSacco
              ? 'This organisation is not configured as a Sacco.'
              : !paymentsActive
                ? 'The payments module is not active for this organisation.'
                : 'Your account does not have permission to view Sacco payments.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const rows = txnQuery.data?.data ?? [];
  const totalPages = txnQuery.data?.totalPages ?? 1;
  const total = txnQuery.data?.total ?? 0;
  const hasFilters = !!(filters.search.trim() || filters.from || filters.to);

  const handleSort = (field: SortField) => {
    if (field === sort) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field);
      setOrder('desc');
    }
    setPage(1);
  };

  const handleFilterChange = (next: FilterState) => {
    setFilters(next);
    setPage(1);
  };

  // v2.12.6: real export — writes the file through the cross-platform helper so
  // it works inside the Capacitor WebView (Documents + share sheet), not only
  // in a desktop browser.
  const handleExportCsv = async () => {
    if (rows.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    const header = ['Date', 'Reference', 'Payer name', 'Payer mobile', 'Amount', 'Channel'];
    const body = rows.map((r) => [
      formatDateTime(r.transaction_date),
      r.transaction_reference,
      r.payer_name || '',
      r.payer_mobile || '',
      String(r.amount),
      r.channel,
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    try {
      const filename = `sacco-transactions-${new Date().toLocaleDateString('en-CA')}.csv`;
      await saveExportedFile(filename, csv, 'text/csv;charset=utf-8;');
      console.log('[SACCO][EXPORT] rows=', rows.length, 'file=', filename);
      toast.success(`Exported ${rows.length} transaction${rows.length === 1 ? '' : 's'}`);
    } catch (e) {
      console.error('[SACCO][EXPORT] failed', e);
      toast.error('Export failed on this device');
    }
  };

  return (
    <div className="min-h-[100vh] bg-background">
      {/* Header — the only navigation in portal mode */}
      <header
        className="border-b border-border bg-card px-4 py-3 print:hidden"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{portalTitle}</h1>
            <p className="text-xs text-muted-foreground">
              {companyName || 'Member portal'}
              {/* Single linked account: shown inline, no picker. */}
              {activeAccount && accounts.length <= 1 ? ` • A/C ${activeAccount}` : ''}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {txnQuery.isFetching
                ? 'Updating…'
                : txnQuery.dataUpdatedAt
                  ? `Live • updated ${formatClock(txnQuery.dataUpdatedAt)}`
                  : 'Live'}
            </p>
            {/* v2.12.8: picker appears only when the user has several linked
                accounts. Native select — WebView 51 safe. */}
            {accounts.length > 1 && (
              <select
                aria-label="Select account"
                className="mt-1 h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                value={activeAccount}
                onChange={(e) => handleAccountChange(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a} value={a}>A/C {a}</option>
                ))}
              </select>
            )}
          </div>


          <div className="flex items-center">
            <Button
              variant="outline"
              size="sm"
              className="mr-2"
              onClick={() => { summaryQuery.refetch(); txnQuery.refetch(); }}
              disabled={txnQuery.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${txnQuery.isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { logout(); toast.success('Logged out successfully'); }}
            >
              <LogOut className="mr-1 h-4 w-4" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl p-3">
        {!navigator.onLine && (
          <Alert className="mb-3">
            <WifiOff className="h-4 w-4" />
            <AlertTitle>You are offline</AlertTitle>
            <AlertDescription>
              Sacco transactions are read from the server. Reconnect to see the latest deposits.
            </AlertDescription>
          </Alert>
        )}

        <SummaryCards summary={summaryQuery.data} isLoading={summaryQuery.isLoading} />

        <div className="mt-3 print:hidden">
          <TransactionFilters
            value={filters}
            onChange={handleFilterChange}
            onReset={() => { setFilters(DEFAULT_FILTERS); setPage(1); }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between print:hidden">
          <p className="text-sm text-muted-foreground">
            {total} transaction{total === 1 ? '' : 's'}
            {txnQuery.data ? ` • ${formatMoney(txnQuery.data.filteredTotal)} total` : ''}
          </p>
          <div className="flex items-center">
            {/* v2.12.6: print removed for Sacco orgs (orgtype='S'). */}
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="mr-1 h-4 w-4" /> Export
            </Button>
          </div>
        </div>

        {txnQuery.isError && (
          <Alert variant="destructive" className="mt-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Could not load transactions</AlertTitle>
            <AlertDescription>
              {(txnQuery.error as Error)?.message || 'Unexpected error.'}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => txnQuery.refetch()}>Retry</Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {!txnQuery.isError && (
          <div className="mt-3">
            <TransactionTable
              rows={rows}
              isLoading={txnQuery.isLoading}
              hasFilters={hasFilters}
              sort={sort}
              order={order}
              onSort={handleSort}
              onSelect={setSelected}
            />
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between print:hidden">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || txnQuery.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || txnQuery.isFetching}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        )}

        <div className="h-6" />
      </main>

      <TransactionDetailSheet
        txn={selected}
        open={!!selected}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
      />
    </div>
  );
};

export default SaccoPortal;
