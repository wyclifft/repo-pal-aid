/**
 * v2.12.0 — Yetu Sacco member portal API client.
 *
 * All endpoints are scoped SERVER-SIDE to the authenticated user's company
 * and linked Sacco account — the client cannot request another member's rows.
 */
import { API_CONFIG } from '@/config/api';
import { resilientFetch } from '@/utils/resilientFetch';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';

const BASE = `${API_CONFIG.MYSQL_API_URL}/api/yetu`;

export type SortField = 'transaction_date' | 'amount' | 'payer_name' | 'transaction_reference';
export type SortOrder = 'asc' | 'desc';

export interface SaccoTransaction {
  txn_id: number;
  transaction_reference: string;
  amount: number;
  payer_name: string | null;
  payer_mobile: string | null;
  transaction_date: string;
  channel: string;
  txn_type: string;
  allocation_status: 'allocated' | 'unallocated';
}

export interface SaccoTransactionPage {
  data: SaccoTransaction[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  filteredTotal: number;
  /** v2.12.8: account the server actually scoped the query to. */
  account_number?: string;
  /** v2.12.8: every account this user is allowed to view. */
  accounts?: string[];
}

export interface SaccoSummary {
  lifetime_total: number;
  lifetime_count: number;
  /** v2.12.6: total contributions received today. */
  today_total?: number;
  month_total: number;
  year_total: number;
  last_deposit_date: string | null;
  account_number: string;
  /** v2.12.8: every account this user is allowed to view. */
  accounts?: string[];
}

export interface SaccoQuery {
  page?: number;
  limit?: number;
  search?: string;
  from?: string;
  to?: string;
  sort?: SortField;
  order?: SortOrder;
  /** v2.12.8: active account when the user has several linked accounts. */
  account?: string;
}


async function accessParams(userid: string): Promise<URLSearchParams> {
  const fingerprint = await generateDeviceFingerprint();
  const params = new URLSearchParams();
  params.set('uniquedevcode', fingerprint);
  params.set('userid', userid);
  return params;
}

async function readJson(res: Response): Promise<any> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
}

function assertOnline() {
  if (!navigator.onLine) {
    throw new Error('You are offline. Connect to the internet to view your Sacco transactions.');
  }
}

export async function fetchSaccoTransactions(userid: string, query: SaccoQuery): Promise<SaccoTransactionPage> {
  assertOnline();
  const params = await accessParams(userid);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  if (query.search) params.set('search', query.search);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  if (query.account) params.set('account', query.account);

  const res = await resilientFetch(`${BASE}/transactions?${params.toString()}`, { method: 'GET' });
  const body = await readJson(res);
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `Could not load transactions (HTTP ${res.status})`);
  }
  return {
    data: body.data || [],
    page: body.page || 1,
    limit: body.limit || 20,
    total: body.total || 0,
    totalPages: body.totalPages || 1,
    filteredTotal: body.filteredTotal || 0,
    account_number: body.account_number,
    accounts: Array.isArray(body.accounts) ? body.accounts : undefined,
  };
}

export async function fetchSaccoSummary(userid: string, account?: string): Promise<SaccoSummary> {
  assertOnline();
  const params = await accessParams(userid);
  if (account) params.set('account', account);
  const res = await resilientFetch(`${BASE}/summary?${params.toString()}`, { method: 'GET' });
  const body = await readJson(res);
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `Could not load summary (HTTP ${res.status})`);
  }
  return body.data as SaccoSummary;
}


// ── Formatting helpers (shared by table, detail sheet, export, print) ────────

export const formatMoney = (value: number): string =>
  `KES ${(Number(value) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Local time formatting — never toISOString (see project date rules). */
export const formatDateTime = (value: string | null): string => {
  if (!value) return '—';
  const normalized = String(value).replace(' ', 'T');
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return String(value);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
