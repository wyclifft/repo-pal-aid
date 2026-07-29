import { useState, useEffect, useCallback } from 'react';
import { mysqlApi, Route } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { useAppSettings } from '@/hooks/useAppSettings';
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
  const { routeLabel, useRouteFilter } = useAppSettings();

  // Load routes on mount - cache-first for instant display
  const loadRoutes = useCallback(async () => {
    // Load from cache FIRST for instant display
    if (isReady) {
      try {
        const cachedRoutes = await getRoutes();
        if (cachedRoutes && cachedRoutes.length > 0) {
          setRoutes(cachedRoutes);
          console.log('[ROUTE] Loaded from cache:', cachedRoutes.length, 'routes');
        }
      } catch (err) {
        console.warn('[ROUTE] Cache load error:', err);
      }
    }

    // Then sync from server if online (non-blocking)
    if (navigator.onLine) {
      setIsLoading(true);
      try {
        const deviceFingerprint = await generateDeviceFingerprint();
        const response = await mysqlApi.routes.getByDevice(deviceFingerprint);
        
        if (response.success && response.data && response.data.length > 0) {
          setRoutes(response.data);
          if (isReady) {
            await saveRoutes(response.data);
            console.log('[ROUTE] Saved to cache:', response.data.length, 'routes');
          }
        } else {
          // No routes for this ccode - that's OK, not an error
          console.log('[ROUTE] No routes configured for this company code');
        }
      } catch (err) {
        console.warn('[ROUTE] Network sync skipped:', err);
        // Don't show error if we have cached data
      } finally {
        setIsLoading(false);
      }
    } else {
      console.log('[ROUTE] Offline - using cached routes');
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
    <div className="relative p-2">
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-[#667eea] flex-shrink-0" />
        Select {routeLabel} <span className="text-red-500">*</span>
      </label>
      <div className="relative">
        <select
          value={selectedRoute}
          onChange={handleChange}
          disabled={disabled || isLoading}
          className={`w-full px-3 py-2.5 border rounded-lg focus:outline-none focus:border-[#667eea] appearance-none bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 ${
            selectedRoute ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-gray-300 dark:border-gray-700'
          } ${disabled || isLoading ? 'bg-gray-100 dark:bg-gray-800 cursor-not-allowed' : ''}`}
        >
          <option value="">-- Select a {routeLabel} --</option>
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
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
          No {routeLabel.toLowerCase()}s available. Check device authorization.
        </p>
      )}
      {!selectedRoute && routes.length > 0 && (
        <p className="text-[10px] text-red-500 dark:text-red-400 mt-0.5">
          Please select a {routeLabel.toLowerCase()} before searching farmers
        </p>
      )}
    </div>
  );
};
