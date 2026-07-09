/**
 * MerchantCombobox — Farmer Boost v2.11.2
 *
 * Typeahead suggestions across merchant `mcode` OR `name` (description).
 * Data source: the already-fetched merchants list — no new endpoint.
 * Emits both the mcode and the resolved merchant object so callers can
 * gate on `status === 'ACTIVE'` before submitting a purchase.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Merchant } from '@/services/merchants';

interface Props {
  merchants: Merchant[];
  value: string;
  onChange: (mercode: string, merchant?: Merchant) => void;
  placeholder?: string;
  disabled?: boolean;
  /** When true, hide non-ACTIVE merchants entirely (Purchase tab). */
  activeOnly?: boolean;
}

export default function MerchantCombobox({
  merchants, value, onChange,
  placeholder = 'Type merchant code or name…',
  disabled, activeOnly,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pool = useMemo(
    () => activeOnly ? merchants.filter(m => m.status === 'ACTIVE') : merchants,
    [merchants, activeOnly]
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pool.slice(0, 12);
    return pool.filter(m =>
      m.mercode.toLowerCase().includes(q) ||
      (m.name || '').toLowerCase().includes(q)
    ).slice(0, 12);
  }, [pool, query]);

  const commit = (m: Merchant) => {
    setQuery(m.mercode);
    setOpen(false);
    onChange(m.mercode, m);
  };

  const currentMerchant = useMemo(
    () => merchants.find(m => m.mercode.toLowerCase() === query.trim().toLowerCase()),
    [merchants, query]
  );

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex items-center border border-gray-300 rounded px-2 focus-within:border-purple-500 bg-white">
        <Search className="h-4 w-4 text-gray-400 mr-1" />
        <input
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
      {currentMerchant && !open && (
        <div className="mt-1 text-xs text-gray-600">
          <span className="font-medium text-gray-800">{currentMerchant.name}</span>
          {currentMerchant.status !== 'ACTIVE' && (
            <span className="ml-2 text-red-600 font-semibold">· {currentMerchant.status}</span>
          )}
        </div>
      )}
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-64 overflow-y-auto">
          {suggestions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500">No merchants match.</div>
          ) : suggestions.map(m => (
            <button
              key={m.mercode}
              type="button"
              onClick={() => commit(m)}
              className="w-full text-left px-3 py-2 hover:bg-purple-50 border-b border-gray-100 last:border-b-0 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-mono text-gray-900">{m.mercode}</div>
                <div className="text-xs text-gray-600 truncate">{m.name}</div>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                m.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                m.status === 'SUSPENDED' ? 'bg-red-100 text-red-800' :
                'bg-gray-100 text-gray-700'
              }`}>{m.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
