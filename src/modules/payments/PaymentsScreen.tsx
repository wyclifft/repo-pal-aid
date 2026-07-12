import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, Loader2, RefreshCw, WifiOff } from 'lucide-react';
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

  // Guard: redirect to dashboard if module is not visible.
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

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.farmer_code)));
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
      <div className="bg-[#26A69A] text-white px-4 py-3 flex items-center gap-3 flex-shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
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

      {/* Period picker */}
      <div className="bg-white border-b px-4 py-2 flex gap-2 overflow-x-auto flex-shrink-0">
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
              period === p.value
                ? 'bg-[#26A69A] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading payable farmers…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 px-6 text-gray-500">
            <CreditCard className="h-10 w-10 mx-auto mb-3 text-gray-400" />
            <p className="font-medium">No unpaid transactions</p>
            <p className="text-sm mt-1">
              All farmers for this period are settled, or the payments backend
              is not yet deployed. Pull to refresh.
            </p>
          </div>
        ) : (
          <div className="bg-white">
            <div className="flex items-center px-4 py-2 border-b bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
              <div className="w-8">
                <Checkbox
                  checked={selected.size > 0 && selected.size === rows.length}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </div>
              <div className="flex-1">Farmer</div>
              <div className="w-28 text-right">Payable</div>
              <div className="w-20 text-right">Status</div>
            </div>
            {rows.map(r => (
              <div
                key={r.farmer_code}
                className="flex items-center px-4 py-3 border-b hover:bg-gray-50"
              >
                <div className="w-8">
                  <Checkbox
                    checked={selected.has(r.farmer_code)}
                    onCheckedChange={() => toggle(r.farmer_code)}
                    aria-label={`Select ${r.farmer_code}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">{r.farmer_name}</div>
                  <div className="text-xs text-gray-500">
                    {r.farmer_code} · {r.unpaid_count} txn
                    {typeof r.total_qty === 'number' && (
                      <> · {r.total_qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} Kgs</>
                    )}
                  </div>
                  {typeof r.deductions === 'number' && r.deductions > 0 && (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      Gross {Number(r.gross_amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {' − '}Credit {Number(r.deductions).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
                <div className="w-28 text-right font-mono text-sm">
                  {Number(r.net_amount ?? r.total_payable).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="w-20 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    r.payment_status === 'partial'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {r.payment_status === 'partial' ? 'Partial' : 'Unpaid'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer action bar */}
      {rows.length > 0 && (
        <div className="bg-white border-t px-4 py-3 flex items-center gap-3 flex-shrink-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
          <div className="flex-1">
            <div className="text-xs text-gray-500">Selected</div>
            <div className="text-base font-semibold">
              {selected.size} farmer{selected.size === 1 ? '' : 's'} ·{' '}
              {selectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
      )}

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!processing) setConfirmOpen(o); if (!o) setResults(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Payment</DialogTitle>
            <DialogDescription>
              You are about to pay {selected.size} farmer{selected.size === 1 ? '' : 's'} for the
              selected period. Each payment gets a unique reference and the underlying
              transactions will be marked as paid.
            </DialogDescription>
          </DialogHeader>

          {!results ? (
            <div className="py-2">
              <div className="rounded border p-3 bg-gray-50 space-y-1 text-sm">
                <div className="flex justify-between"><span>Farmers</span><span>{selected.size}</span></div>
                <div className="flex justify-between"><span>Period</span><span>{PERIODS.find(p => p.value === period)?.label}</span></div>
                <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                  <span>Total</span>
                  <span>{selectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                    <div className={`text-xs ${r.status === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
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
                <Button onClick={doProcess} disabled={processing} className="bg-[#26A69A] hover:bg-[#1F857A]">
                  {processing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>) : 'Confirm & Pay'}
                </Button>
              </>
            ) : (
              <Button onClick={() => { setConfirmOpen(false); setResults(null); }} className="bg-[#26A69A] hover:bg-[#1F857A]">
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
