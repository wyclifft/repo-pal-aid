import { useState, useEffect, useCallback } from 'react';
import { mysqlApi, Route } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { Loader2, MapPin } from 'lucide-react';

interface RouteSelectorProps {
  selectedRoute: string;
  onRouteChange: (route: Route | null) => void;
  disabled?: boolean;
}

export const RouteSelector = ({ selectedRoute, onRouteChange, disabled }: RouteSelectorProps) => {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { getRoutes, saveRoutes, isReady } = useIndexedDB();

  // Load routes on mount
  const loadRoutes = useCallback(async () => {
    // First try to load from cache
    if (isReady) {
      try {
        const cachedRoutes = await getRoutes();
        if (cachedRoutes && cachedRoutes.length > 0) {
          setRoutes(cachedRoutes);
        }
      } catch (err) {
        console.error('Failed to load cached routes:', err);
      }
    }

    // Then sync from server if online
    if (navigator.onLine) {
      setIsLoading(true);
      try {
        const deviceFingerprint = await generateDeviceFingerprint();
        const response = await mysqlApi.routes.getByDevice(deviceFingerprint);
        
        if (response.success && response.data && response.data.length > 0) {
          setRoutes(response.data);
          if (isReady) {
            await saveRoutes(response.data);
          }
          console.log(`✅ Synced ${response.data.length} routes from fm_tanks`);
        }
      } catch (err) {
        console.error('Route sync error:', err);
      } finally {
        setIsLoading(false);
      }
    }
  }, [isReady, getRoutes, saveRoutes]);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  // Reload routes when coming back online
  useEffect(() => {
    const handleOnline = () => loadRoutes();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [loadRoutes]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const tcode = e.target.value;
    if (!tcode) {
      onRouteChange(null);
    } else {
      const route = routes.find(r => r.tcode === tcode);
      onRouteChange(route || null);
    }
  };

  return (
    <div className="relative">
      <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-[#667eea]" />
        Select Route <span className="text-red-500">*</span>
      </label>
      <div className="relative">
        <select
          value={selectedRoute}
          onChange={handleChange}
          disabled={disabled || isLoading}
          className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:border-[#667eea] appearance-none ${
            selectedRoute ? 'border-green-500 bg-green-50' : 'border-gray-300'
          } ${disabled || isLoading ? 'bg-gray-100 cursor-not-allowed' : ''}`}
        >
          <option value="">-- Select a Route --</option>
          {routes.map((route) => (
            <option key={route.tcode} value={route.tcode}>
              {route.descript} ({route.tcode})
            </option>
          ))}
        </select>
        {isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <Loader2 className="h-5 w-5 animate-spin text-[#667eea]" />
          </div>
        )}
      </div>
      {routes.length === 0 && !isLoading && (
        <p className="text-xs text-amber-600 mt-1">
          No routes available. Check device authorization.
        </p>
      )}
      {!selectedRoute && routes.length > 0 && (
        <p className="text-xs text-red-500 mt-1">
          Please select a route before searching farmers
        </p>
      )}
    </div>
  );
};
