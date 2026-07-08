/**
 * FarmerEnrollCombobox — Farmer Boost v2.11.2
 *
 * Typeahead picker over the app's cached members (cm_members already scoped
 * to the operator's ccode via device auth). Reuses useFarmerResolution
 * semantics so "1" → "M00001", partial name matches live-filter, and
 * only members (M-prefix) are surfaced.
 *
 * Data source: IndexedDB `farmers` store (populated by the existing
 * members sync engine). No new backend endpoint — works offline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Farmer } from '@/lib/supabase';
import { useIndexedDB } from '@/hooks/useIndexedDB';

interface Props {
  value: string;
  onChange: (farmerId: string, farmer?: Farmer) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Optional: filter out already-enrolled farmer IDs */
  excludeIds?: Set<string>;
}

export default function FarmerEnrollCombobox({
  value, onChange, placeholder = 'Type member ID or name…',
  autoFocus, disabled, excludeIds,
}: Props) {
  const { getFarmers, isReady } = useIndexedDB();
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    getFarmers().then(rows => {
      if (cancelled) return;
      // Members only (M-prefix); trim to avoid whitespace surprises.
      const members = (rows || []).filter(f =>
        (f.farmer_id || '').trim().toUpperCase().startsWith('M')
      );
      setFarmers(members);
    }).catch(() => setFarmers([]));
    return () => { cancelled = true; };
  }, [isReady, getFarmers]);

  // close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const numeric = q.replace(/\D/g, '');
    const padded = numeric ? `m${numeric.padStart(5, '0')}` : '';
    const list = farmers.filter(f => {
      if (excludeIds && excludeIds.has(f.farmer_id.trim().toUpperCase())) return false;
      const id = f.farmer_id.toLowerCase();
      const name = (f.name || '').toLowerCase();
      return id.includes(q) || name.includes(q) || (padded && id === padded);
    });
    return list.slice(0, 12);
  }, [farmers, query, excludeIds]);

  const commit = (f: Farmer) => {
    const id = f.farmer_id.trim().toUpperCase();
    setQuery(id);
    setOpen(false);
    onChange(id, f);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex items-center border border-gray-300 rounded px-2 focus-within:border-purple-500 bg-white">
        <Search className="h-4 w-4 text-gray-400 mr-1" />
        <input
          autoFocus={autoFocus}
          disabled={disabled}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); onChange(e.target.value.trim().toUpperCase()); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 py-2 text-sm outline-none bg-transparent"
        />
        {query && !disabled && (
          <button type="button" onClick={() => { setQuery(''); onChange(''); }}
            className="text-gray-400 hover:text-gray-600" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-64 overflow-y-auto">
          {suggestions.map(f => (
            <button
              key={f.farmer_id}
              type="button"
              onClick={() => commit(f)}
              className="w-full text-left px-3 py-2 hover:bg-purple-50 border-b border-gray-100 last:border-b-0"
            >
              <div className="text-sm font-mono text-gray-900">{f.farmer_id}</div>
              <div className="text-xs text-gray-600 truncate">{f.name}{f.route ? ` · ${f.route}` : ''}</div>
            </button>
          ))}
        </div>
      )}
      {open && query.trim() && suggestions.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow px-3 py-2 text-xs text-gray-500">
          No members match — check the ID or sync members.
        </div>
      )}
    </div>
  );
}
