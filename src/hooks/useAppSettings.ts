import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { API_CONFIG } from '@/config/api';

// App settings interface based on psettings table
export interface AppSettings {
  // Number of print copies per transaction (default: 1)
  printoptions: number;
  // Route filtering: 0 = by tank prefix only, 1 = by selected route
  chkroute: number;
  // Route label: "Route" (dairy) or "Center" (coffee)
  rdesc: string;
  // Stable reading: 1 = wait for stable scale reading before capture
  stableopt: number;
  // Session print: 1 = print Z-reports only after successful sync
  sessprint: number;
  // Auto weight: 1 = restrict weight entry to digital scale only
  autow: number;
  // Online mode: 1 = offline-first, 0 = background sync
  online: number;
  // Organization type: "D" = dairy, "C" = coffee
  orgtype: string;
  // Print cumulative: 1 = show monthly cumulative on slips
  printcumm: number;
  // Zero option: 1 = require scale to return to zero before new capture
  zeroOpt: number;
  // Company name
  company_name: string | null;
  // Cumulative frequency status (legacy)
  cumulative_frequency_status: number;
}

// Default settings
export const DEFAULT_SETTINGS: AppSettings = {
  printoptions: 1,
  chkroute: 1,
  rdesc: 'Route',
  stableopt: 0,
  sessprint: 0,
  autow: 0,
  online: 0,
  orgtype: 'D',
  printcumm: 0,
  zeroOpt: 0,
  company_name: null,
  cumulative_frequency_status: 0
};

const SETTINGS_STORAGE_KEY = 'app_settings';
const SETTINGS_CCODE_KEY = 'app_settings_ccode';

// Load settings from localStorage
const loadCachedSettings = (): AppSettings => {
  try {
    const cached = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (cached) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(cached) };
    }
  } catch (e) {
    console.warn('Failed to load cached settings:', e);
  }
  return DEFAULT_SETTINGS;
};

// Save settings to localStorage
const saveCachedSettings = (settings: AppSettings, ccode?: string) => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    if (ccode) {
      localStorage.setItem(SETTINGS_CCODE_KEY, ccode);
    }
  } catch (e) {
    console.warn('Failed to cache settings:', e);
  }
};

// Create context for app-wide settings access
interface AppSettingsContextType {
  settings: AppSettings;
  isLoading: boolean;
  refreshSettings: () => Promise<void>;
  // Helper getters
  isDairy: boolean;
  isCoffee: boolean;
  routeLabel: string;
  centerLabel: string;
  produceLabel: string;
  requireStableReading: boolean;
  requireZeroScale: boolean;
  autoWeightOnly: boolean;
  showCumulative: boolean;
  printCopies: number;
  offlineFirstMode: boolean;
  sessionPrintOnly: boolean;
  useRouteFilter: boolean;
}

// React context
const AppSettingsContext = createContext<AppSettingsContextType | null>(null);

// Hook to use settings throughout the app
export const useAppSettings = (): AppSettingsContextType => {
  const context = useContext(AppSettingsContext);
  if (context) {
    return context;
  }
  
  // Fallback for components not wrapped in provider (uses standalone hook)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useAppSettingsStandalone();
};

// Standalone hook (can be used without context provider)
export const useAppSettingsStandalone = (): AppSettingsContextType => {
  const [settings, setSettings] = useState<AppSettings>(loadCachedSettings);
  const [isLoading, setIsLoading] = useState(false);

  const refreshSettings = useCallback(async () => {
    if (!navigator.onLine) {
      console.log('📴 Offline - using cached settings');
      return;
    }

    setIsLoading(true);
    try {
      const deviceFingerprint = await generateDeviceFingerprint();
      const apiUrl = API_CONFIG.MYSQL_API_URL;
      
      // Fetch device info which includes app_settings
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(
        `${apiUrl}/api/devices/fingerprint/${encodeURIComponent(deviceFingerprint)}`,
        { signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const deviceData = data.data;
          
          // Extract settings from response
          const newSettings: AppSettings = {
            printoptions: deviceData.app_settings?.printoptions ?? DEFAULT_SETTINGS.printoptions,
            chkroute: deviceData.app_settings?.chkroute ?? DEFAULT_SETTINGS.chkroute,
            rdesc: deviceData.app_settings?.rdesc ?? DEFAULT_SETTINGS.rdesc,
            stableopt: deviceData.app_settings?.stableopt ?? DEFAULT_SETTINGS.stableopt,
            sessprint: deviceData.app_settings?.sessprint ?? DEFAULT_SETTINGS.sessprint,
            autow: deviceData.app_settings?.autow ?? DEFAULT_SETTINGS.autow,
            online: deviceData.app_settings?.online ?? DEFAULT_SETTINGS.online,
            orgtype: deviceData.app_settings?.orgtype ?? DEFAULT_SETTINGS.orgtype,
            printcumm: deviceData.app_settings?.printcumm ?? DEFAULT_SETTINGS.printcumm,
            zeroOpt: deviceData.app_settings?.zeroOpt ?? DEFAULT_SETTINGS.zeroOpt,
            company_name: deviceData.company_name ?? DEFAULT_SETTINGS.company_name,
            cumulative_frequency_status: deviceData.cumulative_frequency_status ?? DEFAULT_SETTINGS.cumulative_frequency_status
          };
          
          setSettings(newSettings);
          saveCachedSettings(newSettings, deviceData.ccode);
          console.log('✅ App settings synced:', newSettings);
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.warn('Settings fetch failed, using cached:', error);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch settings on mount
  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  // Refresh on online
  useEffect(() => {
    const handleOnline = () => refreshSettings();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [refreshSettings]);

  // Derived helper values
  const isDairy = settings.orgtype === 'D';
  const isCoffee = settings.orgtype === 'C';
  const routeLabel = settings.rdesc || (isDairy ? 'Route' : 'Center');
  const centerLabel = isCoffee ? 'Center' : 'Route';
  const produceLabel = isDairy ? 'Milk' : 'Coffee';
  const requireStableReading = settings.stableopt === 1;
  const requireZeroScale = settings.zeroOpt === 1;
  const autoWeightOnly = settings.autow === 1;
  const showCumulative = settings.printcumm === 1 || settings.cumulative_frequency_status === 1;
  const printCopies = Math.max(1, settings.printoptions || 1);
  const offlineFirstMode = settings.online === 1;
  const sessionPrintOnly = settings.sessprint === 1;
  const useRouteFilter = settings.chkroute === 1;

  return {
    settings,
    isLoading,
    refreshSettings,
    isDairy,
    isCoffee,
    routeLabel,
    centerLabel,
    produceLabel,
    requireStableReading,
    requireZeroScale,
    autoWeightOnly,
    showCumulative,
    printCopies,
    offlineFirstMode,
    sessionPrintOnly,
    useRouteFilter
  };
};

// Export context provider
export { AppSettingsContext };
