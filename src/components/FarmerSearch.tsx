import { useState, useEffect, useCallback, useRef } from 'react';
import { type Farmer } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';

interface FarmerSearchProps {
  onSelectFarmer: (farmer: Farmer) => void;
  value: string;
  selectedRoute?: string; // Route tcode to filter farmers
  disabled?: boolean;
}

export const FarmerSearch = ({ onSelectFarmer, value, selectedRoute, disabled }: FarmerSearchProps) => {
  const [searchQuery, setSearchQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Farmer[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cachedFarmers, setCachedFarmers] = useState<Farmer[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [farmerCount, setFarmerCount] = useState(0);
  const { getFarmers, saveFarmers } = useIndexedDB();
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync searchQuery with value prop when it changes (for Clear Farmer functionality)
  useEffect(() => {
    setSearchQuery(value);
  }, [value]);

  // Load cached farmers immediately on mount and when route changes
  useEffect(() => {
    const loadCached = async () => {
      try {
        const farmers = await getFarmers();
        // Filter by route if selected
        const filtered = selectedRoute 
          ? farmers.filter(f => f.route === selectedRoute)
          : farmers;
        setCachedFarmers(filtered);
      } catch (err) {
        console.error('Failed to load cached farmers:', err);
      }
    };
    loadCached();
  }, [getFarmers, selectedRoute]);

  const searchFarmers = useCallback((query: string, farmers: Farmer[]) => {
    // Show suggestions immediately on focus, even with empty query
    if (!query) {
      setSuggestions(farmers.slice(0, 10));
      return;
    }

    const lowerQuery = query.toLowerCase();
    const filtered = farmers.filter((f) => {
      const idMatch = String(f.farmer_id || '').toLowerCase().startsWith(lowerQuery);
      const nameMatch = String(f.name || '').toLowerCase().includes(lowerQuery);
      return idMatch || nameMatch;
    });
    
    setSuggestions(filtered.slice(0, 10));
  }, []);

  useEffect(() => {
    searchFarmers(searchQuery, cachedFarmers);
  }, [searchQuery, cachedFarmers, searchFarmers]);

  // Sync farmers from MySQL API (device-filtered) on mount, route change, and when online
  useEffect(() => {
    const syncFarmers = async () => {
      if (navigator.onLine) {
        setIsSyncing(true);
        setSyncProgress(0);
        setFarmerCount(0);
        
        try {
          setSyncProgress(20);
          
          // Generate device fingerprint for secure filtering
          const { generateDeviceFingerprint } = await import('@/utils/deviceFingerprint');
          const deviceFingerprint = await generateDeviceFingerprint();
          
          setSyncProgress(40);
          // Pass route filter to API if selected
          const response = await mysqlApi.farmers.getByDevice(deviceFingerprint, selectedRoute || undefined);
          setSyncProgress(70);
          
          if (response.success && response.data && response.data.length > 0) {
            setFarmerCount(response.data.length);
            setSyncProgress(90);
            // Only save all farmers if no route filter (to keep full cache)
            if (!selectedRoute) {
              await saveFarmers(response.data);
            }
            setCachedFarmers(response.data);
            setSyncProgress(100);
            console.log(`✅ Synced ${response.data.length} farmers${selectedRoute ? ` for route ${selectedRoute}` : ''} from MySQL`);
            
            // Keep success state visible for a moment
            setTimeout(() => {
              setIsSyncing(false);
              setSyncProgress(0);
            }, 1500);
          } else if (!response.success) {
            // Handle authorization errors - clear cached farmers
            console.error('❌ Device authorization error:', response.message || response.error);
            await saveFarmers([]); // Clear cached farmers
            setCachedFarmers([]); // Clear state
            const { toast } = await import('sonner');
            toast.error(response.message || 'Device not authorized');
            setIsSyncing(false);
            setSyncProgress(0);
          } else {
            // No farmers found for this route
            setCachedFarmers([]);
            setIsSyncing(false);
          }
        } catch (err) {
          console.error('Farmer sync error:', err);
          setIsSyncing(false);
          setSyncProgress(0);
        }
      }
    };

    syncFarmers();
    window.addEventListener('online', syncFarmers);
    return () => window.removeEventListener('online', syncFarmers);
  }, [saveFarmers, selectedRoute]);

  // Poll for farmers updates every 5 minutes when online (device-filtered)
  useEffect(() => {
    if (!navigator.onLine) return;

    const interval = setInterval(async () => {
      try {
        const { generateDeviceFingerprint } = await import('@/utils/deviceFingerprint');
        const deviceFingerprint = await generateDeviceFingerprint();
        
        const response = await mysqlApi.farmers.getByDevice(deviceFingerprint);
        if (response.success && response.data) {
          saveFarmers(response.data);
          console.log(`✅ Refreshed ${response.data.length} farmers for this device from MySQL`);
        }
      } catch (err) {
        console.error('Farmer refresh error:', err);
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [saveFarmers]);

  const handleSelect = (farmer: Farmer) => {
    setSearchQuery(`${farmer.farmer_id} - ${farmer.name}`);
    setSuggestions([]);
    setShowSuggestions(false);
    onSelectFarmer(farmer);
  };

  return (
    <div className="relative w-full">
      {/* Sync Loading Overlay */}
      {isSyncing && (
        <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-blue-50 border-2 border-purple-200 rounded-lg shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
            <span className="font-semibold text-purple-900">
              {syncProgress < 100 ? 'Syncing Farmers...' : '✓ Sync Complete!'}
            </span>
          </div>
          
          <Progress value={syncProgress} className="h-2 mb-2" />
          
          <div className="flex justify-between items-center text-sm">
            <span className="text-purple-700">
              {syncProgress < 100 ? 'Loading farmer data' : `${farmerCount} farmers synced`}
            </span>
            <span className="font-mono text-purple-600 font-semibold">
              {syncProgress}%
            </span>
          </div>
        </div>
      )}
      
      <input
        ref={inputRef}
        type="text"
        placeholder={selectedRoute ? "Search Farmer (ID or Name)" : "Select a route first"}
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => {
          if (selectedRoute) {
            setShowSuggestions(true);
            searchFarmers(searchQuery, cachedFarmers);
          }
        }}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:border-[#667eea] mb-3 ${
          !selectedRoute ? 'bg-gray-100 border-gray-300 cursor-not-allowed' : 'border-gray-300'
        }`}
        autoComplete="off"
        disabled={isSyncing || disabled || !selectedRoute}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-[9999] w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((farmer) => (
            <div
              key={farmer.farmer_id}
              className="px-4 py-3 cursor-pointer hover:bg-[#667eea] hover:text-white transition-colors"
              onClick={() => handleSelect(farmer)}
            >
              <div className="font-semibold">{farmer.name}</div>
              <div className="text-sm">ID: {farmer.farmer_id}</div>
              <div className="text-xs opacity-75">
                Route: {farmer.route || 'N/A'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
