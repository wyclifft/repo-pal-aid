 import { useState, useEffect, useCallback } from 'react';
import { supabase, type Farmer } from '@/lib/supabase';
import { useIndexedDB } from '@/hooks/useIndexedDB';

interface FarmerSearchProps {
  onSelectFarmer: (farmer: Farmer) => void;
  value: string;
}

export const FarmerSearch = ({ onSelectFarmer, value }: FarmerSearchProps) => {
  const [searchQuery, setSearchQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Farmer[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { getFarmers, saveFarmers } = useIndexedDB();

  const searchFarmers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const lowerQuery = query.toLowerCase();

    if (navigator.onLine) {
      try {
        const { data, error } = await supabase
          .from('farmers')
          .select('farmer_id, name, route, route_name')
          .or(`farmer_id.ilike.%${query}%,name.ilike.%${query}%`)
          .limit(10);

        if (error) throw error;
        setSuggestions(data || []);
      } catch (err) {
        console.error('Farmer search error:', err);
      }
    } else {
      try {
        const farmers = await getFarmers();
        const filtered = farmers.filter(
          (f) =>
            f.farmer_id.toLowerCase().includes(lowerQuery) ||
            f.name.toLowerCase().includes(lowerQuery)
        );
        setSuggestions(filtered.slice(0, 10));
      } catch (err) {
        console.error('Offline farmer search error:', err);
      }
    }
  }, [getFarmers]);

  useEffect(() => {
    searchFarmers(searchQuery);
  }, [searchQuery, searchFarmers]);

  // Sync farmers to local on mount and when online
  useEffect(() => {
    const syncFarmers = async () => {
      if (navigator.onLine) {
        try {
          const { data, error } = await supabase.from('farmers').select('*');
          if (error) throw error;
          if (data) {
            saveFarmers(data);
            console.log(`✅ Synced ${data.length} farmers locally`);
          }
        } catch (err) {
          console.error('Farmer sync error:', err);
        }
      }
    };

    syncFarmers();
    window.addEventListener('online', syncFarmers);
    return () => window.removeEventListener('online', syncFarmers);
  }, [saveFarmers]);

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('farmers-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'farmers' },
        (payload) => {
          const farmer = payload.new || payload.old;
          if (farmer) {
            console.log(`✅ Farmer updated (${payload.eventType}): ${(farmer as Farmer).name}`);
            // Refresh local cache
            if (navigator.onLine) {
              supabase.from('farmers').select('*').then(({ data }) => {
                if (data) saveFarmers(data);
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [saveFarmers]);

  const handleSelect = (farmer: Farmer) => {
    setSearchQuery(`${farmer.farmer_id} - ${farmer.name}`);
    setSuggestions([]);
    setShowSuggestions(false);
    onSelectFarmer(farmer);
  };

  return (
    <div className="relative w-full">
      <input
        type="text"
        placeholder="Search Farmer (ID or Name)"
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#667eea] mb-3"
        autoComplete="off"
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-[9999] w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((farmer) => (
            <div
              key={farmer.farmer_id}
              className="px-4 py-3 cursor-pointer hover:bg-[#667eea] hover:text-white transition-colors"
              onClick={() => handleSelect(farmer)}
            >
              <div className="font-semibold">{farmer.farmer_id}</div>
              <div className="text-sm">{farmer.name}</div>
              <div className="text-xs opacity-75">
                Route: {farmer.route || 'N/A'}
                {farmer.route_name ? ` - ${farmer.route_name}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
