import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { generateDeviceFingerprint, getDeviceName, getDeviceInfo } from '@/utils/deviceFingerprint';
import { API_CONFIG } from '@/config/api';

// App settings interface based on psettings table
// Maps exactly to database columns: printOptions, chkRoute, rdesc, stableOpt, 
// sessPrint, AutoW, onlinemode, orgtype, printcumm, zeroopt
export interface AppSettings {
  // Number of print copies per transaction (DB: printOptions, default: 1)
  printoptions: number;
  // Route filtering: 0 = by tank prefix only, 1 = by selected route (DB: chkRoute)
  chkroute: number;
  // Route label: "Route" (dairy) or "Center" (coffee) (DB: rdesc)
  rdesc: string;
  // Stable reading: 1 = wait for stable scale reading before capture (DB: stableOpt)
  stableopt: number;
  // Session print: 1 = print Z-reports only after successful sync (DB: sessPrint)
  sessprint: number;
  // Auto weight: 1 = restrict weight entry to digital scale only (DB: AutoW)
  autow: number;
  // Online mode: 1 = offline-first, 0 = background sync (DB: onlinemode)
  online: number;
  // Organization type: "D" = dairy, "C" = coffee (DB: orgtype)
  orgtype: string;
  // Print cumulative: 1 = show monthly cumulative on slips (DB: printcumm)
  printcumm: number;
  // Zero option: 1 = require scale to return to zero before new capture (DB: zeroopt)
  zeroOpt: number;
  // Company name (DB: cname)
  company_name: string | null;
  // Company address (DB: caddress)
  caddress: string | null;
  // Company telephone (DB: tel)
  tel: string | null;
  // Company email (DB: email)
  email: string | null;
  // Cumulative frequency status (DB: cumulative_frequency_status)
  cumulative_frequency_status: number;
}

// Default settings - rdesc is empty to force use of dynamic DB value
export const DEFAULT_SETTINGS: AppSettings = {
  printoptions: 1,
  chkroute: 1,
  rdesc: '', // Empty - will be populated from DB; routeLabel computed dynamically
  stableopt: 0,
  sessprint: 0,
  autow: 0,
  online: 0,
  orgtype: 'D',
  printcumm: 0,
  zeroOpt: 0,
  company_name: null,
  caddress: null,
  tel: null,
  email: null,
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
  isDeviceAuthorized: boolean | null; // null = unknown/checking, false = not authorized, true = authorized
  isPendingApproval: boolean; // Device registered but not yet approved
  deviceFingerprint: string | null; // Device fingerprint for display
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

// Auto-register device in approved_devices table
const registerDevice = async (fingerprint: string): Promise<boolean> => {
  try {
    const deviceName = getDeviceName();
    const deviceInfo = getDeviceInfo();
    const deviceInfoString = `${deviceName} | ${deviceInfo.os} | ${deviceInfo.browser} | ${deviceInfo.screenResolution}`;
    
    const requestBody = {
      device_fingerprint: fingerprint,
      user_id: 'pending', // Will be updated when user logs in
      device_info: deviceInfoString,
      approved: false // Always false for new devices
    };
    
    console.log('📱 Registering device with fingerprint:', fingerprint.substring(0, 16) + '...');
    console.log('📱 Device info:', deviceInfoString);
    console.log('📱 Full request body:', JSON.stringify(requestBody));
    
    const response = await fetch(`${API_CONFIG.MYSQL_API_URL}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    console.log('📱 Device registration response status:', response.status);
    console.log('📱 Device registration response:', data);
    return data.success;
  } catch (error) {
    console.error('❌ Failed to register device:', error);
    return false;
  }
};

// Standalone hook (can be used without context provider)
export const useAppSettingsStandalone = (): AppSettingsContextType => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeviceAuthorized, setIsDeviceAuthorized] = useState<boolean | null>(null);
  const [isPendingApproval, setIsPendingApproval] = useState(false);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(null);

  const refreshSettings = useCallback(async () => {
    if (!navigator.onLine) {
      // Offline - check if we have cached authorization
      const cachedAuth = localStorage.getItem('device_authorized');
      if (cachedAuth === 'true') {
        // Device was previously authorized, allow cached settings
        const cached = loadCachedSettings();
        setSettings(cached);
        setIsDeviceAuthorized(true);
        setIsPendingApproval(false);
        console.log('📴 Offline - using cached settings (device was authorized)');
      } else {
        // Not authorized or unknown - block access
        setIsDeviceAuthorized(false);
        console.log('📴 Offline - device not authorized, blocking access');
      }
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const fingerprint = await generateDeviceFingerprint();
      setDeviceFingerprint(fingerprint);
      const apiUrl = API_CONFIG.MYSQL_API_URL;
      
      // Fetch device info which includes app_settings
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(
        `${apiUrl}/api/devices/fingerprint/${encodeURIComponent(fingerprint)}`,
        { signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const deviceData = data.data;
          
          // CRITICAL: Explicitly check if device is authorized/approved
          // The API might return 200 with data but approved=0 or authorized=0
          const isApproved = deviceData.approved === 1 || deviceData.approved === true;
          const isAuthorizedFlag = deviceData.authorized === 1 || deviceData.authorized === true;
          
          if (!isApproved && !isAuthorizedFlag) {
            // Device exists but NOT authorized - block access
            console.log('🚫 Device found but not approved/authorized:', {
              approved: deviceData.approved,
              authorized: deviceData.authorized
            });
            setIsDeviceAuthorized(false);
            setIsPendingApproval(true); // Already registered, waiting approval
            localStorage.setItem('device_authorized', 'false');
            localStorage.removeItem(SETTINGS_STORAGE_KEY);
            localStorage.removeItem(SETTINGS_CCODE_KEY);
            setSettings(DEFAULT_SETTINGS);
            return; // EXIT EARLY - do not proceed
          }
          
          // Device is authorized - extract settings from response
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
            caddress: deviceData.app_settings?.caddress ?? DEFAULT_SETTINGS.caddress,
            tel: deviceData.app_settings?.tel ?? DEFAULT_SETTINGS.tel,
            email: deviceData.app_settings?.email ?? DEFAULT_SETTINGS.email,
            cumulative_frequency_status: deviceData.cumulative_frequency_status ?? DEFAULT_SETTINGS.cumulative_frequency_status
          };
          
          setSettings(newSettings);
          saveCachedSettings(newSettings, deviceData.ccode);
          setIsDeviceAuthorized(true);
          setIsPendingApproval(false);
          localStorage.setItem('device_authorized', 'true');
          console.log('✅ App settings synced from authorized device:', newSettings);
        } else {
          // Response OK but no data - treat as unauthorized
          setIsDeviceAuthorized(false);
          setIsPendingApproval(false);
          localStorage.setItem('device_authorized', 'false');
          localStorage.removeItem(SETTINGS_STORAGE_KEY);
          localStorage.removeItem(SETTINGS_CCODE_KEY);
          setSettings(DEFAULT_SETTINGS);
          console.log('⚠️ Device response missing data - blocking access');
        }
      } else if (response.status === 404) {
        // Device not found - AUTO-REGISTER it for admin approval
        console.log('🆕 Device not found, auto-registering for admin approval...');
        const registered = await registerDevice(fingerprint);
        
        if (registered) {
          console.log('✅ Device registered successfully, waiting for admin approval');
          setIsPendingApproval(true);
        } else {
          console.log('❌ Device registration failed');
          setIsPendingApproval(false);
        }
        
        // Block access - device needs admin approval
        setIsDeviceAuthorized(false);
        localStorage.setItem('device_authorized', 'false');
        localStorage.removeItem(SETTINGS_STORAGE_KEY);
        localStorage.removeItem(SETTINGS_CCODE_KEY);
        setSettings(DEFAULT_SETTINGS);
      } else if (response.status === 401) {
        // Device found but not authorized (exists in devsettings but authorized=0)
        console.log('🚫 Device exists but not authorized');
        setIsDeviceAuthorized(false);
        setIsPendingApproval(true); // Already registered, waiting approval
        localStorage.setItem('device_authorized', 'false');
        localStorage.removeItem(SETTINGS_STORAGE_KEY);
        localStorage.removeItem(SETTINGS_CCODE_KEY);
        setSettings(DEFAULT_SETTINGS);
      } else {
        // Other error - treat as unauthorized for safety
        setIsDeviceAuthorized(false);
        setIsPendingApproval(false);
        localStorage.setItem('device_authorized', 'false');
        localStorage.removeItem(SETTINGS_STORAGE_KEY);
        localStorage.removeItem(SETTINGS_CCODE_KEY);
        setSettings(DEFAULT_SETTINGS);
        console.log('⚠️ Unexpected response status:', response.status, '- blocking access');
      }
    } catch (error) {
      const errorName = (error as Error).name;
      const errorMessage = (error as Error).message;
      
      if (errorName === 'AbortError') {
        // Timeout - treat as network error, check cached auth ONLY if previously authorized
        console.warn('⏱️ Request timeout - checking cached authorization');
      } else {
        console.warn('❌ Settings fetch failed:', errorMessage);
      }
      
      // Network error - ONLY allow cached auth if previously explicitly authorized
      const cachedAuth = localStorage.getItem('device_authorized');
      if (cachedAuth === 'true') {
        const cached = loadCachedSettings();
        setSettings(cached);
        setIsDeviceAuthorized(true);
        setIsPendingApproval(false);
        console.log('📴 Network error - using cached authorization');
      } else {
        // Not authorized or unknown - block access, clear any stale data
        setIsDeviceAuthorized(false);
        setIsPendingApproval(false);
        localStorage.setItem('device_authorized', 'false');
        localStorage.removeItem(SETTINGS_STORAGE_KEY);
        localStorage.removeItem(SETTINGS_CCODE_KEY);
        setSettings(DEFAULT_SETTINGS);
        console.log('📴 Network error - device not authorized, blocking access');
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
  // Trim rdesc since DB column may have trailing whitespace
  const trimmedRdesc = settings.rdesc?.trim();
  const routeLabel = trimmedRdesc || (isDairy ? 'Route' : 'Center');
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
    isDeviceAuthorized,
    isPendingApproval,
    deviceFingerprint,
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
