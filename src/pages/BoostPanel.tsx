/**
 * Boost Panel — Farmer Boost Phase 2 + 3 (v2.11.1)
 *
 * Officer-facing UI for the Farmer Boost feature. Everything on this page
 * is gated by psettings.boost_enabled (checked via /api/boost/policy). If
 * the feature is dormant for the current coop, we render a "not enabled"
 * card and never make any write call.
 *
 * Tabs:
 *   1. Accounts   — list enrolled farmers, set/adjust credit limits,
 *                    disburse cash advances.
 *   2. Merchants  — CRUD approved input suppliers.
 *   3. Purchase   — post a credit-funded input purchase (creates a
 *                    boost_purchases + boost_ledger PURCHASE row).
 *   4. Farmer 360 — read-only ledger + account snapshot per farmer.
 *
 * Notes:
 * - Every write requires an approved device — the server rejects with 401
 *   if the uniquedevcode is not authorized. That mirrors milk/store writes.
 * - No IndexedDB mirroring in this phase — officer flows require online.
 *   An offline queue is Phase 4 material.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Wallet, Store as StoreIcon, ShoppingCart, User,
  CheckCircle2, XCircle, Loader2, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { useAuth } from '@/contexts/AuthContext';
import {
  getBoostPolicy, getBoostAccount, type BoostPolicy, type BoostAccount,
} from '@/services/creditEngine';
import {
  listBoostAccounts, setCreditLimit, disburseCredit,
  getFarmerLedger, postBoostPurchase, generatePrefNo,
  type BoostAccountRow, type BoostLedgerEntry,
} from '@/services/boostLedger';
import { listMerchants, upsertMerchant, type Merchant } from '@/services/merchants';
import FarmerEnrollCombobox from '@/components/boost/FarmerEnrollCombobox';
import MerchantCombobox from '@/components/boost/MerchantCombobox';

type TabId = 'accounts' | 'merchants' | 'purchase' | 'farmer360';

const money = (n: number) =>
  `KSh ${(Number(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BoostPanel() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [uniquedevcode, setUniquedevcode] = useState<string>('');
  const [policy, setPolicy] = useState<BoostPolicy | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(true);
  const [tab, setTab] = useState<TabId>('accounts');

  useEffect(() => {
    (async () => {
      try {
        const fp = await generateDeviceFingerprint();
        setUniquedevcode(fp);
        const p = await getBoostPolicy(fp);
        setPolicy(p);
      } catch (e) {
        console.error('[BoostPanel] init failed:', e);
      } finally {
        setLoadingPolicy(false);
      }
    })();
  }, []);

  if (loadingPolicy) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (!policy?.boost_enabled) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => navigate('/')} className="mb-4 flex items-center gap-1 text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <Wallet className="h-10 w-10 mx-auto text-gray-400 mb-3" />
            <h2 className="text-lg font-bold text-gray-900 mb-2">Farmer Boost is not enabled</h2>
            <p className="text-sm text-gray-600">
              This cooperative has not opted into the Farm Input Credit feature.
              Ask the administrator to enable it in psettings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-700 to-purple-900 text-white p-4 shadow">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="p-1 rounded hover:bg-white/10">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-lg font-bold flex items-center gap-2">
                <Wallet className="h-5 w-5" /> Farmer Boost
              </h1>
              <p className="text-xs text-purple-100">
                Recovery cap {policy.recovery_cap_pct}% · Limits {policy.limit_mode}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex overflow-x-auto">
          {([
            { id: 'accounts',  label: 'Accounts',  icon: User },
            { id: 'merchants', label: 'Merchants', icon: StoreIcon },
            { id: 'purchase',  label: 'Purchase',  icon: ShoppingCart },
            { id: 'farmer360', label: 'Farmer 360', icon: RefreshCw },
          ] as const).map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id as TabId)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4">
        {tab === 'accounts'  && <AccountsTab   uniquedevcode={uniquedevcode} operator={currentUser?.username || ""} />}
        {tab === 'merchants' && <MerchantsTab  uniquedevcode={uniquedevcode} />}
        {tab === 'purchase'  && <PurchaseTab   uniquedevcode={uniquedevcode} operator={currentUser?.username || ""} />}
        {tab === 'farmer360' && <Farmer360Tab  uniquedevcode={uniquedevcode} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Accounts tab
// ---------------------------------------------------------------
function AccountsTab({ uniquedevcode, operator }: { uniquedevcode: string; operator: string }) {
  const [rows, setRows] = useState<BoostAccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<BoostAccountRow | null>(null);
  const [newFarmerId, setNewFarmerId] = useState('');
  const [newLimit, setNewLimit] = useState('');

  const reload = useCallback(async () => {
    if (!uniquedevcode) return;
    setLoading(true);
    setRows(await listBoostAccounts(uniquedevcode));
    setLoading(false);
  }, [uniquedevcode]);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.farmer_id.toLowerCase().includes(q));
  }, [rows, search]);

  const saveLimit = async (farmer_id: string, credit_limit: number) => {
    const r = await setCreditLimit({ uniquedevcode, farmer_id, credit_limit, operator });
    if (r.ok) { toast.success('Limit updated'); setEditing(null); reload(); }
    else toast.error(r.error || 'Failed');
  };

  const enroll = async () => {
    const id = newFarmerId.trim();
    const lim = Number(newLimit);
    if (!id || !(lim >= 0)) { toast.error('Enter farmer ID and a non-negative limit'); return; }
    const r = await setCreditLimit({ uniquedevcode, farmer_id: id, credit_limit: lim, operator });
    if (r.ok) { toast.success('Farmer enrolled'); setNewFarmerId(''); setNewLimit(''); reload(); }
    else toast.error(r.error || 'Failed');
  };

  const enrolledIds = useMemo(
    () => new Set(rows.map(r => r.farmer_id.trim().toUpperCase())),
    [rows]
  );

  return (
    <div className="space-y-4">
      {/* Enroll */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-900 mb-1">Enroll member / set limit</h3>
        <p className="text-xs text-gray-500 mb-3">
          Members are loaded from your cooperative directory. Type an ID (e.g. <code>1</code> → M00001) or a name.
        </p>
        <div className="flex flex-wrap gap-2 items-start">
          <div className="flex-1 min-w-[220px]">
            <FarmerEnrollCombobox
              value={newFarmerId}
              onChange={(id) => setNewFarmerId(id)}
              excludeIds={enrolledIds}
            />
          </div>
          <input
            type="number" inputMode="decimal" min={0}
            className="border border-gray-300 rounded px-3 py-2 text-sm w-40"
            placeholder="Credit limit (KSh)"
            value={newLimit}
            onChange={e => setNewLimit(e.target.value)}
          />
          <button onClick={enroll} className="bg-purple-600 text-white rounded px-4 py-2 text-sm font-semibold hover:bg-purple-700">
            Save
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-3 border-b border-gray-200 flex items-center gap-2">
          <input
            className="border border-gray-300 rounded px-3 py-2 text-sm flex-1"
            placeholder="Search farmer ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button onClick={reload} disabled={loading} className="p-2 text-gray-600 hover:text-gray-900 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Farmer</th>
                <th className="px-3 py-2 text-right">Limit</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">No enrolled farmers yet</td></tr>
              ) : filtered.map(r => {
                const available = Math.max(0, Number(r.credit_limit) - Number(r.outstanding) - Number(r.hold_amount));
                return (
                  <tr key={r.farmer_id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono">{r.farmer_id}</td>
                    <td className="px-3 py-2 text-right">{money(r.credit_limit)}</td>
                    <td className="px-3 py-2 text-right text-red-700">{money(r.outstanding)}</td>
                    <td className="px-3 py-2 text-right text-green-700 font-semibold">{money(available)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        r.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                        r.status === 'FROZEN' ? 'bg-yellow-100 text-yellow-800' :
                        r.status === 'WRITEOFF' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-700'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setEditing(r)} className="text-purple-700 hover:underline text-xs">Adjust / Disburse</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <AccountActionModal
          row={editing}
          uniquedevcode={uniquedevcode}
          operator={operator}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
          onSaveLimit={saveLimit}
        />
      )}
    </div>
  );
}

function AccountActionModal({
  row, uniquedevcode, operator, onClose, onSaved, onSaveLimit,
}: {
  row: BoostAccountRow;
  uniquedevcode: string;
  operator: string;
  onClose: () => void;
  onSaved: () => void;
  onSaveLimit: (farmer_id: string, credit_limit: number) => Promise<void>;
}) {
  const [limit, setLimit] = useState(String(row.credit_limit));
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const available = Math.max(0, Number(row.credit_limit) - Number(row.outstanding) - Number(row.hold_amount));

  const disburse = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) { toast.error('Amount required'); return; }
    if (amt > available + 0.01) { toast.error('Exceeds available credit'); return; }
    setBusy(true);
    const refNo = `DIS-${row.farmer_id}-${Date.now()}`;
    const r = await disburseCredit({ uniquedevcode, farmer_id: row.farmer_id, amount: amt, ref_no: refNo, operator, notes });
    setBusy(false);
    if (r.ok) { toast.success('Cash disbursed'); onSaved(); }
    else toast.error(r.error || 'Failed');
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">{row.farmer_id}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XCircle className="h-5 w-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-xs text-gray-500">Outstanding</div>
              <div className="font-bold text-red-700">{money(row.outstanding)}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-xs text-gray-500">Available</div>
              <div className="font-bold text-green-700">{money(available)}</div>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-600 block mb-1">Credit limit (KSh)</label>
            <div className="flex gap-2">
              <input type="number" min={0} value={limit} onChange={e => setLimit(e.target.value)}
                className="border border-gray-300 rounded px-3 py-2 text-sm flex-1" />
              <button
                disabled={busy || Number(limit) === Number(row.credit_limit)}
                onClick={async () => { setBusy(true); await onSaveLimit(row.farmer_id, Math.max(0, Number(limit) || 0)); setBusy(false); }}
                className="bg-purple-600 text-white rounded px-3 py-2 text-sm disabled:opacity-50">
                Save limit
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-600 block mb-1">Disburse cash (KSh)</label>
            <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm w-full" placeholder="Amount" />
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm w-full mt-2" placeholder="Notes (optional)" />
            <button disabled={busy || !amount} onClick={disburse}
              className="mt-2 w-full bg-green-600 text-white rounded py-2 text-sm font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Disburse
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Merchants tab
// ---------------------------------------------------------------
function MerchantsTab({ uniquedevcode }: { uniquedevcode: string }) {
  const [rows, setRows] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<Merchant> | null>(null);

  const reload = useCallback(async () => {
    if (!uniquedevcode) return;
    setLoading(true);
    setRows(await listMerchants(uniquedevcode));
    setLoading(false);
  }, [uniquedevcode]);
  useEffect(() => { reload(); }, [reload]);

  const save = async () => {
    if (!editing?.mcode || !editing?.name) { toast.error('mercode + name required'); return; }
    const r = await upsertMerchant(uniquedevcode, editing as Merchant);
    if (r.ok) { toast.success('Saved'); setEditing(null); reload(); }
    else toast.error(r.error || 'Failed');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-900">Approved input suppliers</h3>
        <button onClick={() => setEditing({ status: 'ACTIVE' })}
          className="bg-purple-600 text-white rounded px-3 py-1.5 text-sm font-semibold hover:bg-purple-700">
          + New merchant
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">Till / Paybill</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">
                {loading ? 'Loading…' : 'No merchants yet'}
              </td></tr>
            ) : rows.map(m => (
              <tr key={m.mercode} className="border-t border-gray-100">
                <td className="px-3 py-2 font-mono">{m.mercode}</td>
                <td className="px-3 py-2">{m.name}</td>
                <td className="px-3 py-2">{m.phone || '—'}</td>
                <td className="px-3 py-2">{m.till_paybill || '—'}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    m.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                    m.status === 'SUSPENDED' ? 'bg-red-100 text-red-800' :
                    'bg-gray-100 text-gray-700'
                  }`}>{m.status}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setEditing(m)} className="text-purple-700 hover:underline text-xs">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">{editing?.mercode ? 'Edit' : 'New'} merchant</h3>
              <button onClick={() => setEditing(null)}><XCircle className="h-5 w-5 text-gray-400" /></button>
            </div>
            <div className="p-4 space-y-2">
              {[
                { k: 'mercode', label: 'Merchant code *', disabled: !!rows.find(r => r.mercode === editing?.mercode) },
                { k: 'name', label: 'Business name *' },
                { k: 'phone', label: 'Phone' },
                { k: 'kra_pin', label: 'KRA PIN' },
                { k: 'till_paybill', label: 'Till / Paybill' },
                { k: 'bank_name', label: 'Bank name' },
                { k: 'bank_acc', label: 'Bank account' },
              ].map(f => (
                <div key={f.k}>
                  <label className="text-xs text-gray-600 block mb-0.5">{f.label}</label>
                  <input
                    disabled={(f as any).disabled}
                    value={(editing as any)[f.k] || ''}
                    onChange={e => setEditing({ ...editing, [f.k]: e.target.value })}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full disabled:bg-gray-100"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs text-gray-600 block mb-0.5">Status</label>
                <select value={editing.status || 'ACTIVE'} onChange={e => setEditing({ ...editing, status: e.target.value as any })}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full">
                  <option>ACTIVE</option><option>PENDING</option><option>SUSPENDED</option>
                </select>
              </div>
              <button onClick={save} className="mt-3 w-full bg-purple-600 text-white rounded py-2 text-sm font-semibold hover:bg-purple-700">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Purchase tab — post a boost-funded input purchase
// ---------------------------------------------------------------
function PurchaseTab({ uniquedevcode, operator }: { uniquedevcode: string; operator: string }) {
  const [farmerId, setFarmerId] = useState('');
  const [account, setAccount] = useState<BoostAccount | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [mcode, setMcode] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uniquedevcode) return;
    listMerchants(uniquedevcode).then(m => setMerchants(m.filter(x => x.status === 'ACTIVE')));
  }, [uniquedevcode]);

  const loadFarmer = async () => {
    const id = farmerId.trim();
    if (!id) return;
    const a = await getBoostAccount(id, uniquedevcode);
    setAccount(a);
    if (!a || a.status === 'INACTIVE') toast.error('Farmer not enrolled — set a credit limit first');
  };

  const submit = async () => {
    const amt = Number(amount);
    if (!account || !mcode || !(amt > 0)) { toast.error('Farmer, merchant and amount required'); return; }
    const chosen = merchants.find(m => m.mercode.toUpperCase() === mcode.toUpperCase());
    if (!chosen) { toast.error('Merchant not found or not active'); return; }
    if (amt > account.available + 0.01) { toast.error('Exceeds available credit'); return; }
    setBusy(true);
    const prefNo = generatePrefNo('BST', Date.now() % 10);
    const r = await postBoostPurchase({
      uniquedevcode, farmer_id: account.farmer_id, mcode, amount: amt,
      pref_no: prefNo, operator, notes,
    });
    setBusy(false);
    if (r.ok) {
      toast.success('Purchase posted');
      setAmount(''); setNotes('');
      loadFarmer();
    } else toast.error(r.error || 'Failed');
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <h3 className="font-semibold text-gray-900">Post credit-funded purchase</h3>
        <div>
          <label className="text-xs text-gray-600 block mb-1">Member</label>
          <div className="flex gap-2">
            <div className="flex-1"><FarmerEnrollCombobox value={farmerId} onChange={(id) => setFarmerId(id)} /></div>
            <button onClick={loadFarmer} className="bg-gray-800 text-white rounded px-4 py-2 text-sm">Load</button>
          </div>
        </div>

        {account && account.status !== 'INACTIVE' && (
          <div className="bg-purple-50 border border-purple-200 rounded p-3 text-sm space-y-1">
            <div className="flex justify-between"><span>Limit</span><span className="font-semibold">{money(account.credit_limit)}</span></div>
            <div className="flex justify-between"><span>Outstanding</span><span className="text-red-700 font-semibold">{money(account.outstanding)}</span></div>
            <div className="flex justify-between"><span>Available</span><span className="text-green-700 font-bold">{money(account.available)}</span></div>
          </div>
        )}

        <div>
          <label className="text-xs text-gray-600 block mb-1">Merchant</label>
          <MerchantCombobox merchants={merchants} value={mcode} onChange={(code) => setMcode(code)} activeOnly />
        </div>

        <div>
          <label className="text-xs text-gray-600 block mb-1">Amount (KSh)</label>
          <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm w-full" />
        </div>

        <div>
          <label className="text-xs text-gray-600 block mb-1">Notes</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm w-full" />
        </div>

        <button disabled={busy || !account || !mcode || !amount} onClick={submit}
          className="w-full bg-green-600 text-white rounded py-2.5 text-sm font-bold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Post purchase
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Farmer 360 tab — account + ledger snapshot
// ---------------------------------------------------------------
function Farmer360Tab({ uniquedevcode }: { uniquedevcode: string }) {
  const [farmerId, setFarmerId] = useState('');
  const [account, setAccount] = useState<BoostAccount | null>(null);
  const [ledger, setLedger] = useState<BoostLedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const id = farmerId.trim();
    if (!id) return;
    setLoading(true);
    const [a, l] = await Promise.all([
      getBoostAccount(id, uniquedevcode),
      getFarmerLedger(id, uniquedevcode, 100),
    ]);
    setAccount(a);
    setLedger(l);
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex gap-2">
          <div className="flex-1"><FarmerEnrollCombobox value={farmerId} onChange={(id) => setFarmerId(id)} /></div>
          <button onClick={load} disabled={loading} className="bg-purple-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50">
            {loading ? '…' : 'Load'}
          </button>
        </div>
      </div>

      {account && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-bold text-gray-900 mb-2">{account.farmer_id}</h3>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-xs text-gray-500">Limit</div>
              <div className="font-bold">{money(account.credit_limit)}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-xs text-gray-500">Outstanding</div>
              <div className="font-bold text-red-700">{money(account.outstanding)}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-xs text-gray-500">Available</div>
              <div className="font-bold text-green-700">{money(account.available)}</div>
            </div>
          </div>
        </div>
      )}

      {ledger.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Ref</th>
                <th className="px-3 py-2 text-left">Merchant</th>
                <th className="px-3 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map(e => (
                <tr key={e.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-xs">{new Date(e.ts).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold ${
                      e.entry_type === 'DISBURSE' || e.entry_type === 'PURCHASE' ? 'text-red-700' :
                      e.entry_type === 'RECOVER' || e.entry_type === 'SETTLE'   ? 'text-green-700' :
                      'text-gray-700'
                    }`}>{e.entry_type}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{money(Math.abs(Number(e.amount)))}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.ref_no}</td>
                  <td className="px-3 py-2 text-xs">{e.mcode || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{e.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
