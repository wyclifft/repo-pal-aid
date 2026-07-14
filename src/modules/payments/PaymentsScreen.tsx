import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, Loader2, RefreshCw, Search, WifiOff, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import { usePaymentsAccess } from './usePaymentsAccess';
import {
  getPayable,
  processPayments,
  type PayableFarmer,
  type PaymentPeriod,
  type PaymentResult,
} from './paymentsApi';

const PERIODS: { value: PaymentPeriod; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'season', label: 'This Season' },
];

const fmt = (n: number, min = 2, max = 2) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: min, maximumFractionDigits: max });

export default function PaymentsScreen() {
  const navigate = useNavigate();
  const { visible, paymentsActive, canAccessPayments } = usePaymentsAccess();
  const { currentUser } = useAuth();

  const [period, setPeriod] = useState<PaymentPeriod>('month');
  const [rows, setRows] = useState<PayableFarmer[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<PaymentResult[] | null>(null);

  // Search / autosuggest
  const [search, setSearch] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) {
      console.log('[PAY][GUARD] payments not visible', { paymentsActive, canAccessPayments });
      navigate('/', { replace: true });
    }
  }, [visible, paymentsActive, canAccessPayments, navigate]);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Close suggestion dropdown on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!searchWrapRef.current) return;
      if (!searchWrapRef.current.contains(e.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const load = async () => {
    if (!currentUser?.user_id) return;
    setLoading(true);
    setSelected(new Set());
    try {
      const data = await getPayable(period, { userid: currentUser.user_id });
      setRows(data);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load payable farmers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible && currentUser?.user_id) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, visible, currentUser?.user_id]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      r =>
        r.farmer_name?.toLowerCase().includes(q) ||
        r.farmer_code?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return rows
      .filter(
        r =>
          r.farmer_name?.toLowerCase().includes(q) ||
          r.farmer_code?.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [rows, search]);

  const selectedRows = useMemo(
    () => rows.filter(r => selected.has(r.farmer_code)),
    [rows, selected]
  );
  const selectedTotal = useMemo(
    () => selectedRows.reduce((s, r) => s + (Number(r.net_amount ?? r.total_payable) || 0), 0),
    [selectedRows]
  );

  const toggle = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const allSelectedInFilter =
    filteredRows.length > 0 && filteredRows.every(r => selected.has(r.farmer_code));

  const toggleAll = () => {
    if (allSelectedInFilter) {
      setSelected(prev => {
        const next = new Set(prev);
        filteredRows.forEach(r => next.delete(r.farmer_code));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        filteredRows.forEach(r => next.add(r.farmer_code));
        return next;
      });
    }
  };

  const pickSuggestion = (r: PayableFarmer) => {
    setSearch(r.farmer_name || r.farmer_code);
    setSuggestOpen(false);
    setActiveIdx(-1);
    // Scroll into view
    requestAnimationFrame(() => {
      const el = document.getElementById(`pay-row-${r.farmer_code}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('ring-2', 'ring-[#26A69A]');
      setTimeout(() => el?.classList.remove('ring-2', 'ring-[#26A69A]'), 1500);
    });
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = activeIdx >= 0 ? activeIdx : 0;
      if (suggestions[idx]) pickSuggestion(suggestions[idx]);
    } else if (e.key === 'Escape') {
      setSuggestOpen(false);
    }
  };

  const onPay = async () => {
    if (!isOnline) {
      toast.error('Payments require an internet connection.');
      return;
    }
    if (selected.size === 0) {
      toast.error('Select at least one farmer to pay.');
      return;
    }
    if (!currentUser?.user_id) {
      toast.error('Login session required for payments.');
      return;
    }
    setConfirmOpen(true);
  };

  const doProcess = async () => {
    setProcessing(true);
    setResults(null);
    try {
      if (!currentUser?.user_id) throw new Error('Login session required for payments.');
      const res = await processPayments(Array.from(selected), period, { userid: currentUser.user_id });
      setResults(res);
      const okCount = res.filter(r => r.status === 'success').length;
      const failCount = res.length - okCount;
      if (okCount > 0) toast.success(`${okCount} payment${okCount === 1 ? '' : 's'} completed`);
      if (failCount > 0) toast.error(`${failCount} payment${failCount === 1 ? '' : 's'} failed`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Payment processing failed');
    } finally {
      setProcessing(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div
        className="bg-[#26A69A] text-white px-4 py-3 flex items-center gap-3 flex-shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
      >
        <button
          onClick={() => navigate('/')}
          aria-label="Back to dashboard"
          className="p-1 rounded hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <CreditCard className="h-5 w-5" />
        <h1 className="text-lg font-semibold flex-1">Payments</h1>
        {!isOnline && (
          <span className="flex items-center gap-1 text-xs bg-red-500/90 px-2 py-1 rounded">
            <WifiOff className="h-3 w-3" /> Offline
          </span>
        )}
        <button
          onClick={load}
          disabled={loading}
          className="p-1 rounded hover:bg-white/10 disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Controls: period + search. Responsive: stacked on mobile, inline on md+ */}
      <div className="bg-white border-b flex-shrink-0">
        <div className="max-w-6xl mx-auto w-full px-3 sm:px-4 py-2 flex flex-col md:flex-row md:items-center gap-2">
          <div className="flex gap-2 overflow-x-auto md:flex-shrink-0">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition ${
                  period === p.value
                    ? 'bg-[#26A69A] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Search with autosuggest */}
          <div ref={searchWrapRef} className="relative flex-1 md:ml-2">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                inputMode="search"
                autoComplete="off"
                spellCheck={false}
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setSuggestOpen(true);
                  setActiveIdx(-1);
                }}
                onFocus={() => setSuggestOpen(true)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search farmer by name or code…"
                className="w-full pl-9 pr-9 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#26A69A] focus:bg-white"
                aria-label="Search farmers"
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch('');
                    setSuggestOpen(false);
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-200 text-gray-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {suggestOpen && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 max-h-72 overflow-y-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={s.farmer_code}
                    onMouseDown={e => {
                      e.preventDefault();
                      pickSuggestion(s);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm border-b last:border-b-0 ${
                      i === activeIdx ? 'bg-gray-100' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{s.farmer_name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {s.farmer_code} · {s.unpaid_count} txn
                        {typeof s.total_qty === 'number' && <> · {fmt(s.total_qty, 0, 2)} Kgs</>}
                      </div>
                    </div>
                    <div className="font-mono text-xs text-gray-700 flex-shrink-0">
                      {fmt(Number(s.net_amount ?? s.total_payable))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto w-full">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading payable farmers…
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-16 px-6 text-gray-500">
              <CreditCard className="h-10 w-10 mx-auto mb-3 text-gray-400" />
              <p className="font-medium">
                {search ? 'No farmers match your search' : 'No unpaid transactions'}
              </p>
              <p className="text-sm mt-1">
                {search
                  ? 'Try a different name or member code.'
                  : 'All farmers for this period are settled. Pull to refresh.'}
              </p>
            </div>
          ) : (
            <div className="bg-white md:mt-3 md:rounded-lg md:border md:shadow-sm overflow-hidden">
              {/* Header row */}
              <div className="grid grid-cols-[2rem_minmax(0,1fr)_6rem_5rem] sm:grid-cols-[2.5rem_minmax(0,1fr)_8rem_6rem] items-center px-3 sm:px-4 py-2 border-b bg-gray-50 text-[11px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wide">
                <div>
                  <Checkbox
                    checked={allSelectedInFilter}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </div>
                <div>Farmer</div>
                <div className="text-right">Payable</div>
                <div className="text-right">Status</div>
              </div>

              {filteredRows.map(r => (
                <div
                  key={r.farmer_code}
                  id={`pay-row-${r.farmer_code}`}
                  className="grid grid-cols-[2rem_minmax(0,1fr)_6rem_5rem] sm:grid-cols-[2.5rem_minmax(0,1fr)_8rem_6rem] items-center px-3 sm:px-4 py-3 border-b hover:bg-gray-50 transition"
                >
                  <div>
                    <Checkbox
                      checked={selected.has(r.farmer_code)}
                      onCheckedChange={() => toggle(r.farmer_code)}
                      aria-label={`Select ${r.farmer_code}`}
                    />
                  </div>
                  <div className="min-w-0 pr-2">
                    <div className="font-medium text-gray-900 truncate">{r.farmer_name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {r.farmer_code} · {r.unpaid_count} txn
                      {typeof r.total_qty === 'number' && (
                        <> · {fmt(r.total_qty, 0, 2)} Kgs</>
                      )}
                    </div>
                    {typeof r.deductions === 'number' && r.deductions > 0 && (
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                        Gross {fmt(Number(r.gross_amount ?? 0))} − Credit {fmt(r.deductions)}
                      </div>
                    )}
                  </div>
                  <div className="text-right font-mono text-sm tabular-nums">
                    {fmt(Number(r.net_amount ?? r.total_payable))}
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block text-[11px] px-2 py-0.5 rounded ${
                        r.payment_status === 'partial'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {r.payment_status === 'partial' ? 'Partial' : 'Unpaid'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer action bar */}
      {rows.length > 0 && (
        <div
          className="bg-white border-t flex-shrink-0"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
        >
          <div className="max-w-6xl mx-auto w-full px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-500">Selected</div>
              <div className="text-base font-semibold truncate">
                {selected.size} farmer{selected.size === 1 ? '' : 's'} ·{' '}
                {fmt(selectedTotal)}
              </div>
            </div>
            <Button
              onClick={onPay}
              disabled={selected.size === 0 || !isOnline}
              className="bg-[#26A69A] hover:bg-[#1F857A]"
            >
              Pay Selected
            </Button>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      <Dialog
        open={confirmOpen}
        onOpenChange={o => {
          if (!processing) setConfirmOpen(o);
          if (!o) setResults(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Payment</DialogTitle>
            <DialogDescription>
              You are about to pay {selected.size} farmer{selected.size === 1 ? '' : 's'} for the
              selected period. Each payment gets a unique reference and the underlying transactions
              will be marked as paid.
            </DialogDescription>
          </DialogHeader>

          {!results ? (
            <div className="py-2">
              <div className="rounded border p-3 bg-gray-50 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Farmers</span>
                  <span>{selected.size}</span>
                </div>
                <div className="flex justify-between">
                  <span>Period</span>
                  <span>{PERIODS.find(p => p.value === period)?.label}</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                  <span>Total</span>
                  <span>{fmt(selectedTotal)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-2 max-h-72 overflow-y-auto">
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between border-b py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{r.farmer_code}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {r.payment_reference || '—'}
                      {r.external_transaction_id ? ` · ${r.external_transaction_id}` : ''}
                    </div>
                    {r.error && <div className="text-xs text-red-600 truncate">{r.error}</div>}
                  </div>
                  <div className="text-right ml-2">
                    <div className="font-mono">{Number(r.amount).toFixed(2)}</div>
                    <div
                      className={`text-xs ${
                        r.status === 'success' ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {r.status.toUpperCase()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            {!results ? (
              <>
                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={processing}>
                  Cancel
                </Button>
                <Button
                  onClick={doProcess}
                  disabled={processing}
                  className="bg-[#26A69A] hover:bg-[#1F857A]"
                >
                  {processing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…
                    </>
                  ) : (
                    'Confirm & Pay'
                  )}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  setConfirmOpen(false);
                  setResults(null);
                }}
                className="bg-[#26A69A] hover:bg-[#1F857A]"
              >
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
