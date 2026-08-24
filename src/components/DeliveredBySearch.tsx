import { useState, useEffect, useMemo, useRef, forwardRef } from 'react';
import { type Farmer } from '@/lib/supabase';

interface DeliveredBySearchProps {
  farmers: Farmer[];
  value: string;
  onChange: (value: string) => void;
  onSelectMember: (farmer: Farmer) => void;
  placeholder?: string;
}

export const DeliveredBySearch = forwardRef<HTMLInputElement, DeliveredBySearchProps>(({
  farmers,
  value,
  onChange,
  onSelectMember,
  placeholder = "Enter name or search member..."
}, ref) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter suggestions based on input
  const suggestions = useMemo(() => {
    if (!value.trim() || value.includes(' - ')) return [];

    const query = value.toLowerCase().trim();
    // Extract numeric portion if user entered numbers only
    const numericQuery = value.replace(/\D/g, '');

    return farmers.filter(f => {
      const farmerId = String(f.farmer_id || '').toLowerCase();
      const farmerName = String(f.name || '').toLowerCase();

      return (
        farmerId.startsWith(query) ||
        (numericQuery && farmerId.includes(numericQuery)) ||
        farmerName.includes(query)
      );
    }).slice(0, 10);
  }, [value, farmers]);

  // Handle clicking outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (farmer: Farmer) => {
    const displayValue = `${farmer.farmer_id} - ${farmer.name}`;
    onChange(displayValue);
    onSelectMember(farmer);
    setShowDropdown(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <input
        ref={ref}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => setShowDropdown(true)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:border-teal-500 focus:outline-none"
      />

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-[100] left-0 right-0 bottom-full mb-1 bg-white border-2 border-gray-800 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {suggestions.map((farmer) => (
            <button
              key={farmer.farmer_id}
              onClick={() => handleSelect(farmer)}
              className="w-full px-4 py-3 text-left hover:bg-teal-50 border-b border-gray-100 last:border-0 flex justify-between items-center"
            >
              <div>
                <div className="font-bold text-gray-900">{farmer.farmer_id}</div>
                <div className="text-sm text-gray-600">{farmer.name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

DeliveredBySearch.displayName = 'DeliveredBySearch';
