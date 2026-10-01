import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { mysqlApi, Route } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { useAppSettings } from '@/hooks/useAppSettings';
import { Loader2, MapPin, Search, ChevronDown, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface RouteSelectorProps {
  selectedRoute: string;
  onRouteChange: (route: Route | null) => void;
  disabled?: boolean;
}

/**
 * Alphanumeric natural sort for routes by descript (falling back to tcode)
 */
export const sortRoutes = (routeList: Route[]): Route[] => {
  if (!Array.isArray(routeList)) return [];
  return [...routeList].sort((a, b) => {
    const descA = String(a?.descript || a?.tcode || '').trim();
    const descB = String(b?.descript || b?.tcode || '').trim();
    const comp = descA.localeCompare(descB, undefined, { numeric: true, sensitivity: 'base' });
    if (comp !== 0) return comp;
    return String(a?.tcode || '').trim().localeCompare(String(b?.tcode || '').trim(), undefined, { numeric: true, sensitivity: 'base' });
  });
};

export const RouteSelector = ({ selectedRoute, onRouteChange, disabled }: RouteSelectorProps) => {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { getRoutes, saveRoutes, isReady } = useIndexedDB();
  const { routeLabel } = useAppSettings();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Currently selected route object
  const selectedRouteObj = useMemo(() => {
    if (!selectedRoute) return null;
    return routes.find(r => r.tcode === selectedRoute) || null;
  }, [routes, selectedRoute]);

  // Load routes on mount - cache-first for instant display
  const loadRoutes = useCallback(async () => {
    if (isReady) {
      try {
        const cachedRoutes = await getRoutes();
        if (cachedRoutes && cachedRoutes.length > 0) {
          const sortedCached = sortRoutes(cachedRoutes);
          setRoutes(sortedCached);
        }
      } catch (err) {
        console.warn('[ROUTE] Cache load error:', err);
      }
    }

    if (navigator.onLine) {
      setIsLoading(true);
      try {
        const deviceFingerprint = await generateDeviceFingerprint();
        const response = await mysqlApi.routes.getByDevice(deviceFingerprint);
        
        if (response.success && response.data && response.data.length > 0) {
          const sortedOnline = sortRoutes(response.data);
          setRoutes(sortedOnline);
          if (isReady) {
            await saveRoutes(sortedOnline);
          }
        }
      } catch (err) {
        console.warn('[ROUTE] Network sync skipped:', err);
      } finally {
        setIsLoading(false);
      }
    }
  }, [isReady, getRoutes, saveRoutes]);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  useEffect(() => {
    const handleOnline = () => loadRoutes();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [loadRoutes]);

  // Reset search query when modal opens (without auto-focusing to prevent keyboard popup)
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Filter routes based on search query
  const filteredRoutes = useMemo(() => {
    if (!searchQuery.trim()) return routes;
    const q = searchQuery.toLowerCase().trim();
    return routes.filter(
      r =>
        (r.descript && r.descript.toLowerCase().includes(q)) ||
        (r.tcode && r.tcode.toLowerCase().includes(q))
    );
  }, [routes, searchQuery]);

  const handleSelectRoute = (route: Route | null) => {
    onRouteChange(route);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="p-2">
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-[#667eea] flex-shrink-0" />
          Select {routeLabel} <span className="text-red-500">*</span>
        </span>
      </label>

      {/* Main Select Field */}
      <button
        type="button"
        onClick={() => !disabled && !isLoading && routes.length > 0 && setIsOpen(true)}
        disabled={disabled || isLoading || routes.length === 0}
        className={`w-full px-3 py-2.5 border rounded-lg focus:outline-none flex items-center justify-between bg-white dark:bg-gray-950 text-left ${
          selectedRoute ? 'border-green-500 bg-green-50 dark:bg-green-950/20 text-gray-900 dark:text-gray-100 font-semibold' : 'border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400'
        } ${disabled || isLoading || routes.length === 0 ? 'bg-gray-100 dark:bg-gray-800 cursor-not-allowed opacity-75' : 'cursor-pointer hover:border-[#667eea]'}`}
      >
        <span className="truncate pr-2">
          {routes.length === 0
            ? `-- No ${routeLabel.toLowerCase()}s available --`
            : selectedRouteObj
            ? `${selectedRouteObj.descript} (${selectedRouteObj.tcode})`
            : `-- Select a ${routeLabel} --`}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-[#667eea]" />}
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </div>
      </button>

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

      {/* Route Picker Modal */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 pb-3 border-b border-gray-100 dark:border-gray-800">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <MapPin className="h-5 w-5 text-[#667eea]" />
              Select {routeLabel}
            </DialogTitle>
          </DialogHeader>

          {/* Search Bar */}
          <div className="p-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#667eea]"
                autoComplete="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Options List */}
          <div className="flex-1 overflow-y-auto p-2 pb-32 sm:pb-8 space-y-1 min-h-0">
            <button
              type="button"
              onClick={() => handleSelectRoute(null)}
              className="w-full px-3 py-2.5 rounded-lg text-left text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              -- Select a {routeLabel} --
            </button>

            {filteredRoutes.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-500">
                No matching {routeLabel.toLowerCase()}s
              </div>
            ) : (
              filteredRoutes.map((route) => (
                <button
                  key={route.tcode}
                  type="button"
                  onClick={() => handleSelectRoute(route)}
                  className={`w-full px-3.5 py-2.5 rounded-lg text-left text-sm border flex items-center justify-between transition-colors ${
                    selectedRoute === route.tcode
                      ? 'bg-green-50 dark:bg-green-950/30 border-green-500 text-green-900 dark:text-green-200 font-semibold'
                      : 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200'
                  }`}
                >
                  <span>{route.descript} ({route.tcode})</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
