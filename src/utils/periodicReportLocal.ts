/**
 * v2.10.75 — Offline Periodic Report builder.
 *
 * Reads from the IndexedDB `transactions_cache` store (rolling local mirror of
 * recent backend transactions, hydrated by useDataSync from the device Z-Report
 * endpoint) and produces the same row shape the online API returns.
 *
 * Falls back gracefully when the cache is empty — never throws.
 */

import type { PeriodicReportData, FarmerDetailReportData } from '@/services/mysqlApi';

export interface CachedTxRow {
  transrefno: string;
  farmer_id: string;
  farmer_name?: string;
  tcode?: string;
  route_name?: string;
  transdate: string; // YYYY-MM-DD or ISO
  quantity: number;
  transtype?: number;
  product_name?: string;
  product_code?: string;
  time?: string;
  refno?: string;
}

const dateOnly = (s: string): string => {
  if (!s) return '';
  // Accept YYYY-MM-DD or ISO; never use toISOString.
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(s).slice(0, 10);
};

/**
 * Build the periodic report aggregate (one row per farmer with totals) from
 * the local cache. Only BUY (transtype===1 or undefined) rows count.
 */
export function buildPeriodicReportFromCache(
  rows: CachedTxRow[],
  opts: { startDate: string; endDate: string; route?: string; farmerSearch?: string }
): PeriodicReportData[] {
  const { startDate, endDate, route, farmerSearch } = opts;
  const routeNorm = (route || '').trim().toUpperCase();
  const search = (farmerSearch || '').trim().toLowerCase();

  type Acc = PeriodicReportData;
  const map = new Map<string, Acc>();

  for (const r of rows) {
    const tt = Number(r.transtype || 1);
    if (tt !== 1) continue; // BUY only — periodic report tracks deliveries
    const d = dateOnly(r.transdate);
    if (!d || d < startDate || d > endDate) continue;
    if (routeNorm && (r.tcode || '').toUpperCase() !== routeNorm) continue;
    if (search) {
      const id = (r.farmer_id || '').toLowerCase();
      const nm = (r.farmer_name || '').toLowerCase();
      if (!id.includes(search) && !nm.includes(search)) continue;
    }
    const key = r.farmer_id;
    if (!key) continue;
    const cur = map.get(key) || {
      farmer_id: key,
      farmer_name: r.farmer_name || key,
      route: r.tcode || route || '',
      total_weight: 0,
      collection_count: 0,
    };
    cur.total_weight += Number(r.quantity || 0);
    cur.collection_count += 1;
    if (!cur.farmer_name && r.farmer_name) cur.farmer_name = r.farmer_name;
    if (!cur.route && r.tcode) cur.route = r.tcode;
    map.set(key, cur);
  }

  return Array.from(map.values()).sort((a, b) => a.farmer_name.localeCompare(b.farmer_name));
}

/**
 * Build the per-farmer detailed transaction list (used by the printed statement)
 * from the local cache.
 */
export function buildFarmerDetailFromCache(
  rows: CachedTxRow[],
  opts: {
    startDate: string;
    endDate: string;
    farmerId: string;
    route?: string;
    companyName: string;
    produceName: string;
  }
): FarmerDetailReportData {
  const { startDate, endDate, farmerId, route, companyName, produceName } = opts;
  const routeNorm = (route || '').trim().toUpperCase();
  const fid = (farmerId || '').replace(/^#/, '').trim();

  const filtered = rows
    .filter(r => {
      const tt = Number(r.transtype || 1);
      if (tt !== 1) return false;
      if ((r.farmer_id || '') !== fid) return false;
      const d = dateOnly(r.transdate);
      if (!d || d < startDate || d > endDate) return false;
      if (routeNorm && (r.tcode || '').toUpperCase() !== routeNorm) return false;
      return true;
    })
    .sort((a, b) => dateOnly(a.transdate).localeCompare(dateOnly(b.transdate)));

  const transactions = filtered.map(r => ({
    date: dateOnly(r.transdate),
    rec_no: r.refno || (r.transrefno || '').slice(-5),
    quantity: Number(r.quantity || 0),
    time: r.time || '',
  }));

  const total_weight = filtered.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const farmer_name = filtered[0]?.farmer_name || fid;
  const transaction_route = filtered[0]?.tcode || route || '';
  const transaction_route_name = filtered[0]?.route_name || '';

  return {
    company_name: companyName,
    farmer_id: fid,
    farmer_name,
    farmer_route: transaction_route,
    farmer_route_name: transaction_route_name,
    transaction_route,
    transaction_route_name,
    produce_name: produceName,
    start_date: startDate,
    end_date: endDate,
    total_weight,
    transactions,
  };
}
