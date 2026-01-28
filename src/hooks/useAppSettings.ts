import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { Capacitor } from '@capacitor/core';
import { generateDeviceFingerprint, getDeviceName, getDeviceInfo } from '@/utils/deviceFingerprint';
import { API_CONFIG } from '@/config/api';

// App settings interface based on psettings table
// Maps exactly to database columns: printOptions, chkRoute, rdesc, stableOpt, 
// sessPrint, AutoW, onlinemode, orgtype, printcumm, zeroopt, sackTare, allowSackEdit
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
  // Period label: "Season" (coffee) or "Session" (dairy) - derived from orgtype
  periodLabel: string;
  // Sack tare weight in kg for coffee weighing (DB: sackTare, default: 1)
  sackTare: number;
  // Allow frontend users to edit sack weight: 0 = fixed/backend-controlled, 1 = editable (DB: allowSackEdit, default: 0)
  allowSackEdit: number;
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
  cumulative_frequency_status: 0,
  periodLabel: 'Session', // Default to Session (dairy)
  sackTare: 1, // Default 1 kg sack tare weight for coffee
  allowSackEdit: 0 // Default: sack weight is fixed/backend-controlled
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
  periodLabel: string;
  weightUnit: string;  // 'kg' for coffee, 'L' for dairy
  weightLabel: string; // 'Kilograms' for coffee, 'Liters' for dairy
  companyName: string; // Dynamic company name
  requireStableReading: boolean;
  requireZeroScale: boolean;
  autoWeightOnly: boolean;
  showCumulative: boolean;
  printCopies: number;
  offlineFirstMode: boolean;
  sessionPrintOnly: boolean;
  useRouteFilter: boolean;
  // Coffee sack weighing
  sackTareWeight: number; // Configurable sack tare weight in kg
  allowSackEdit: boolean; // Whether frontend users can edit sack weight
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

// Check if error is due to old backend with stale column references
const isStaleBackendError = (errorText: string | undefined): boolean => {
  if (!errorText) return false;
  return errorText.includes("Unknown column") || 
         errorText.includes("device_ref") ||
         errorText.includes("ER_BAD_FIELD_ERROR");
};

// Store pending registration for retry when backend is updated
const storePendingRegistration = (fingerprint: string, deviceInfo: string) => {
  try {
    const pending = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
    const exists = pending.some((p: { fingerprint: string }) => p.fingerprint === fingerprint);
    if (!exists) {
      pending.push({ 
        fingerprint, 
        deviceInfo, 
        timestamp: Date.now(),
        attempts: 1 
      });
      localStorage.setItem('pending_device_registrations', JSON.stringify(pending));
      console.log('💾 Stored pending registration for retry:', fingerprint.substring(0, 16) + '...');
    }
  } catch (e) {
    console.warn('Failed to store pending registration:', e);
  }
};

// Auto-register device in approved_devices table with retry for native platforms
const registerDevice = async (fingerprint: string, retryCount = 0): Promise<boolean> => {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const maxRetries = isNative ? 3 : 1;
  
  try {
    const deviceName = getDeviceName();
    const deviceInfo = getDeviceInfo();
    // Simplified format: "Model (OS)" e.g. "HMD Pulse (Android)" or "Samsung A52 (Android)"
    const deviceInfoString = `${deviceName} (${deviceInfo.os})`;
    
    const requestBody = {
      device_fingerprint: fingerprint,
      user_id: 'pending', // Will be updated when user logs in
      device_info: deviceInfoString,
      approved: false // Always false for new devices
    };
    
    console.log(`📱 Registering device (attempt ${retryCount + 1}/${maxRetries}):`, fingerprint.substring(0, 16) + '...');
    console.log('📱 Request payload:', JSON.stringify(requestBody));
    console.log('📱 Platform:', platform, 'isNative:', isNative);
    
    const response = await fetch(`${API_CONFIG.MYSQL_API_URL}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    const responseText = await response.text();
    let data: { success?: boolean; error?: string; message?: string };
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { success: false, error: responseText };
    }
    
    console.log('📱 Device registration response:', response.status, data.success ? 'SUCCESS' : 'FAILED');
    console.log('📱 Response body:', responseText.substring(0, 200));
    
    // Check for stale backend error
    if (response.status === 500 && isStaleBackendError(data.error || responseText)) {
      console.error('🚨 BACKEND OUTDATED: Server has stale column references (device_ref). Contact admin to update server.js');
      storePendingRegistration(fingerprint, deviceInfoString);
      // Dispatch event so UI can show warning
      window.dispatchEvent(new CustomEvent('backendOutdated', { 
        detail: { message: 'Backend needs update - device_ref column issue' }
      }));
      return false;
    }
    
    if (data.success) {
      // Clear from pending if it was there
      try {
        const pending = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
        const filtered = pending.filter((p: { fingerprint: string }) => p.fingerprint !== fingerprint);
        localStorage.setItem('pending_device_registrations', JSON.stringify(filtered));
      } catch { /* ignore */ }
      return true;
    }
    
    // Retry on failure for native platforms
    if (!data.success && retryCount < maxRetries - 1) {
      console.log(`⏳ Retrying registration in ${(retryCount + 1) * 2}s...`);
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
      return registerDevice(fingerprint, retryCount + 1);
    }
    
    // Store for retry if all attempts failed
    storePendingRegistration(fingerprint, deviceInfoString);
    return false;
  } catch (error) {
    console.error('❌ Failed to register device:', error);
    
    // Retry on network error for native platforms
    if (retryCount < maxRetries - 1) {
      console.log(`⏳ Network error, retrying in ${(retryCount + 1) * 2}s...`);
      await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
      return registerDevice(fingerprint, retryCount + 1);
    }
    
    return false;
  }
};

// Standalone hook (can be used without context provider)
export const useAppSettingsStandalone = (): AppSettingsContextType => {
  const [settings, setSettings] = useState<AppSettings>(() => loadCachedSettings());
  const [isLoading, setIsLoading] = useState(true);
  const [isDeviceAuthorized, setIsDeviceAuthorized] = useState<boolean | null>(null);
  const [isPendingApproval, setIsPendingApproval] = useState(false);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(0);

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
          
          // CRITICAL: Check if device is authorized/approved
          // Device needs to be EITHER approved OR authorized to proceed
          const isApproved = deviceData.approved === 1 || deviceData.approved === true;
          const isAuthorizedFlag = deviceData.authorized === 1 || deviceData.authorized === true;
          
          // Block access only if device is NEITHER approved NOR authorized
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
          
          // Device is approved OR authorized - allow access
          console.log('✅ Device approved/authorized:', {
            approved: isApproved,
            authorized: isAuthorizedFlag
          });
          
          // Device is authorized - extract settings from response
          // CRITICAL: Parse all values as numbers to ensure proper comparison
          const newSettings: AppSettings = {
            printoptions: parseInt(String(deviceData.app_settings?.printoptions ?? DEFAULT_SETTINGS.printoptions), 10),
            chkroute: parseInt(String(deviceData.app_settings?.chkroute ?? DEFAULT_SETTINGS.chkroute), 10),
            rdesc: deviceData.app_settings?.rdesc ?? DEFAULT_SETTINGS.rdesc,
            stableopt: parseInt(String(deviceData.app_settings?.stableopt ?? DEFAULT_SETTINGS.stableopt), 10),
            sessprint: parseInt(String(deviceData.app_settings?.sessprint ?? DEFAULT_SETTINGS.sessprint), 10),
            autow: parseInt(String(deviceData.app_settings?.autow ?? DEFAULT_SETTINGS.autow), 10),
            online: parseInt(String(deviceData.app_settings?.online ?? DEFAULT_SETTINGS.online), 10),
            orgtype: deviceData.app_settings?.orgtype ?? DEFAULT_SETTINGS.orgtype,
            printcumm: parseInt(String(deviceData.app_settings?.printcumm ?? DEFAULT_SETTINGS.printcumm), 10),
            zeroOpt: parseInt(String(deviceData.app_settings?.zeroOpt ?? DEFAULT_SETTINGS.zeroOpt), 10),
            company_name: deviceData.company_name ?? DEFAULT_SETTINGS.company_name,
            caddress: deviceData.app_settings?.caddress ?? DEFAULT_SETTINGS.caddress,
            tel: deviceData.app_settings?.tel ?? DEFAULT_SETTINGS.tel,
            email: deviceData.app_settings?.email ?? DEFAULT_SETTINGS.email,
            cumulative_frequency_status: parseInt(String(deviceData.cumulative_frequency_status ?? DEFAULT_SETTINGS.cumulative_frequency_status), 10),
            periodLabel: deviceData.app_settings?.periodLabel ?? DEFAULT_SETTINGS.periodLabel,
            sackTare: parseFloat(String(deviceData.app_settings?.sackTare ?? DEFAULT_SETTINGS.sackTare)),
            allowSackEdit: parseInt(String(deviceData.app_settings?.sackEdit ?? deviceData.app_settings?.allowSackEdit ?? DEFAULT_SETTINGS.allowSackEdit), 10)
          };
          
          // Log settings changes for debugging
          console.log('🔄 Settings refreshed from server:', {
            autow: newSettings.autow,
            stableopt: newSettings.stableopt,
            sessprint: newSettings.sessprint
          });
          
          setSettings(newSettings);
          saveCachedSettings(newSettings, deviceData.ccode);
          setIsDeviceAuthorized(true);
          setIsPendingApproval(false);
          localStorage.setItem('device_authorized', 'true');
          setLastRefresh(Date.now());
          
          // Dispatch event to notify other components of settings update
          window.dispatchEvent(new CustomEvent('psettingsUpdated', { detail: newSettings }));
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
      } else if (response.status === 500) {
        // Server error - could be database issue or stale code
        // Try to register the device anyway as it might not exist
        console.log('⚠️ Server error (500), attempting device registration...');
        const registered = await registerDevice(fingerprint);
        
        if (registered) {
          console.log('✅ Device registered successfully despite server error');
          setIsPendingApproval(true);
        } else {
          console.log('❌ Device registration also failed');
          setIsPendingApproval(false);
        }
        
        // Block access until backend is fixed and device is approved
        setIsDeviceAuthorized(false);
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

  // Refresh on online event
  useEffect(() => {
    const handleOnline = () => {
      console.log('🌐 Network online - refreshing psettings');
      refreshSettings();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [refreshSettings]);

  // Refresh when app becomes visible (foreground)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        // Only refresh if last refresh was more than 30 seconds ago
        const now = Date.now();
        if (now - lastRefresh > 30000) {
          console.log('👁️ App visible - refreshing psettings');
          refreshSettings();
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshSettings, lastRefresh]);

  // Listen for manual settings refresh request
  useEffect(() => {
    const handleForceRefresh = () => {
      console.log('🔄 Force refresh psettings requested');
      refreshSettings();
    };
    
    window.addEventListener('refreshPsettings', handleForceRefresh);
    return () => window.removeEventListener('refreshPsettings', handleForceRefresh);
  }, [refreshSettings]);

  // Periodic refresh every 60 seconds when online (for live settings updates)
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (navigator.onLine && isDeviceAuthorized) {
        console.log('⏰ Periodic psettings refresh');
        refreshSettings();
      }
    }, 60000); // 60 seconds

    return () => clearInterval(intervalId);
  }, [refreshSettings, isDeviceAuthorized]);

  // Derived helper values - computed from current settings state
  // These will automatically update when settings state changes
  const isDairy = settings.orgtype === 'D';
  const isCoffee = settings.orgtype === 'C';
  // Trim rdesc since DB column may have trailing whitespace
  const trimmedRdesc = settings.rdesc?.trim();
  const routeLabel = trimmedRdesc || (isDairy ? 'Route' : 'Center');
  const centerLabel = isCoffee ? 'Center' : 'Route';
  const produceLabel = isDairy ? 'Milk' : 'Coffee';
  // Period label: use backend value if available, otherwise derive from orgtype
  const periodLabel = settings.periodLabel || (isCoffee ? 'Season' : 'Session');
  // Weight unit: kg for coffee, L for dairy
  const weightUnit = isCoffee ? 'kg' : 'L';
  const weightLabel = isCoffee ? 'Kilograms' : 'Liters';
  // CRITICAL: Use strict equality with number 1 for boolean conversion
  const requireStableReading = settings.stableopt === 1;
  const requireZeroScale = settings.zeroOpt === 1;
  const autoWeightOnly = settings.autow === 1;
  const showCumulative = settings.printcumm === 1 || settings.cumulative_frequency_status === 1;
  const printCopies = settings.printoptions ?? 1; // 0 = no print, 1+ = number of copies
  const offlineFirstMode = settings.online === 1;
  const sessionPrintOnly = settings.sessprint === 1;
  const useRouteFilter = settings.chkroute === 1;
  const companyName = settings.company_name || localStorage.getItem('device_company_name') || '';
  // Coffee sack weighing settings
  const sackTareWeight = settings.sackTare ?? 1; // Default 1 kg
  const allowSackEdit = settings.allowSackEdit === 1; // 0 = fixed, 1 = editable

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
    periodLabel,
    weightUnit,
    weightLabel,
    companyName,
    requireStableReading,
    requireZeroScale,
    autoWeightOnly,
    showCumulative,
    printCopies,
    offlineFirstMode,
    sessionPrintOnly,
    useRouteFilter,
    sackTareWeight,
    allowSackEdit
  };
};

// Export context provider
export { AppSettingsContext };
