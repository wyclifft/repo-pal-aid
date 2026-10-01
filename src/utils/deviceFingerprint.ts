/**
 * Device Fingerprinting Utilities
 * Generate unique device fingerprints and parse device information
 *
 * v2.10.109: Added collectHardwareBundle() — returns stable hardware
 * identifiers (SSAID, model, manufacturer, OS version) that survive
 * uninstall/reinstall on Android. Used by the server-bound identity
 * resolution flow so devices recover their original devcode/uniquedevcode
 * and counters instead of being issued a fresh identity (which risked
 * TRNID/MILKID mixups). The legacy generateDeviceFingerprint() below is
 * UNCHANGED — still used as the back-compat `legacyFingerprint` match key.
 */

import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

const DEVICE_ID_KEY = 'device_id';
let cachedFingerprintMemory: string | null = null;
let hasLoggedDeviceDetails = false;

export interface DeviceHardwareBundle {
  ssaid?: string;                // Android SSAID — stable across reinstall (same signing key)
  model?: string;
  manufacturer?: string;
  osVersion?: string;
  platform: string;              // 'android' | 'ios' | 'web'
  isNative: boolean;
  legacyFingerprint: string;     // current generateDeviceFingerprint() output
}

/**
 * Collect a hardware fingerprint bundle. Best-effort — every field is
 * optional and any failure is swallowed so the caller can always send
 * something. The bundle is sent to POST /api/device/resolve-identity to
 * recover the device's original identity after a reinstall/clear-data.
 */
export const collectHardwareBundle = async (): Promise<DeviceHardwareBundle> => {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const legacyFingerprint = await generateDeviceFingerprint();

  const bundle: DeviceHardwareBundle = {
    platform,
    isNative,
    legacyFingerprint,
  };

  try {
    if (isNative) {
      const id = await Device.getId();
      // On Android this is Settings.Secure.ANDROID_ID (SSAID).
      // Same APK signing key + same user profile → stable across reinstall.
      if (id?.identifier) bundle.ssaid = String(id.identifier);
    }
  } catch (e) {
    console.error(
  '[HW-BUNDLE] Device.getId() failed:',
  e instanceof Error ? e.message : e
);  }

  try {
    const info = await Device.getInfo();
    if (info?.model) bundle.model = String(info.model).slice(0, 128);
    if (info?.manufacturer) bundle.manufacturer = String(info.manufacturer).slice(0, 128);
    if (info?.osVersion) bundle.osVersion = String(info.osVersion).slice(0, 64);
  } catch (e) {
    console.warn('[HW-BUNDLE] Device.getInfo() failed:', e);
  }

  return bundle;
};

/**
 * Simple hash function fallback for environments without crypto.subtle
 */
const simpleHash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to hex and pad to ensure consistent length
  const hex = Math.abs(hash).toString(16);
  // Create a longer hash by combining multiple parts
  const part1 = hex.padStart(8, '0');
  const part2 = Math.abs(hash * 31).toString(16).padStart(8, '0');
  const part3 = Math.abs(hash * 37).toString(16).padStart(8, '0');
  const part4 = Math.abs(hash * 41).toString(16).padStart(8, '0');
  const part5 = Math.abs(hash * 43).toString(16).padStart(8, '0');
  const part6 = Math.abs(hash * 47).toString(16).padStart(8, '0');
  const part7 = Math.abs(hash * 53).toString(16).padStart(8, '0');
  const part8 = Math.abs(hash * 59).toString(16).padStart(8, '0');
  return (part1 + part2 + part3 + part4 + part5 + part6 + part7 + part8).substring(0, 64);
};

/**
 * SHA-256 hex helper — crypto.subtle when available, simpleHash fallback.
 */
const sha256Hex = async (input: string): Promise<string> => {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const data = new TextEncoder().encode(input);
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {
    console.warn('[FP] crypto.subtle digest failed, using fallback:', e);
  }
  return simpleHash(input);
};

/**
 * Log full untruncated device fingerprint & hardware info for easy ADB/Logcat inspection.
 */
export const logFullDeviceDetails = async (fp: string) => {
  try {
    const isNative = Capacitor.isNativePlatform();
    const platform = Capacitor.getPlatform();
    let ssaid = 'N/A';
    let model = 'N/A';
    let manufacturer = 'N/A';
    let osVersion = 'N/A';

    if (isNative) {
      try {
        const id = await Device.getId();
        if (id?.identifier) ssaid = String(id.identifier);
      } catch (e) { /* ignore */ }

      try {
        const info = await Device.getInfo();
        if (info?.model) model = String(info.model);
        if (info?.manufacturer) manufacturer = String(info.manufacturer);
        if (info?.osVersion) osVersion = String(info.osVersion);
      } catch (e) { /* ignore */ }
    }

    console.info(
      `\n================================================================\n` +
      `📱 [DEVICE IDENTIFICATION & FINGERPRINT]\n` +
      `FULL FINGERPRINT    : ${fp}\n` +
      `SSAID               : ${ssaid}\n` +
      `DEVICE MODEL        : ${model}\n` +
      `MANUFACTURER        : ${manufacturer}\n` +
      `OS VERSION          : ${osVersion}\n` +
      `PLATFORM            : ${platform} (Native: ${isNative})\n` +
      `================================================================`
    );
  } catch (e) {
    console.info('📱 [DEVICE FINGERPRINT]:', fp);
  }
};

export const getStoredDeviceId = (): string | null => {
  if (cachedFingerprintMemory && cachedFingerprintMemory.length >= 32) {
    return cachedFingerprintMemory;
  }
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored && stored.length >= 32) {
      cachedFingerprintMemory = stored;
      return stored;
    }
  } catch (e) {
    console.warn('localStorage read failed:', e);
  }
  return null;
};

export const setStoredDeviceId = (deviceId: string): void => {
  if (!deviceId) return;
  cachedFingerprintMemory = deviceId;
  try {
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch (e) {
    console.warn('localStorage write failed:', e);
  }
};

/**
 * Generate a unique device fingerprint.
 *
 * Priority:
 *   1) In-memory cached fingerprint or localStorage  — instant response.
 *   2) Native + SSAID available                      — deterministic SHA-256 over SSAID.
 *   3) Entropy fallback                              — original web/legacy behavior.
 */
export const generateDeviceFingerprint = async (): Promise<string> => {
  const existing = getStoredDeviceId();
  if (existing) {
    if (!hasLoggedDeviceDetails) {
      hasLoggedDeviceDetails = true;
      logFullDeviceDetails(existing).catch(() => {});
    }
    return existing;
  }

  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();

  // 2) Native: derive from SSAID. Stable across reinstall/clear-data when the
  //    APK signing key + user profile are the same.
  if (isNative) {
    try {
      const id = await Device.getId();
      const ssaid = id?.identifier ? String(id.identifier) : '';
      if (ssaid) {
        const fp = await sha256Hex('ssaid:' + ssaid);
        setStoredDeviceId(fp);
        if (!hasLoggedDeviceDetails) {
          hasLoggedDeviceDetails = true;
          logFullDeviceDetails(fp).catch(() => {});
        }
        return fp;
      }
      console.warn('[FP] Native but SSAID unavailable — falling back to entropy hash');
    } catch (e) {
      console.warn('[FP] Device.getId() failed, falling back to entropy hash:', e);
    }
  }

  console.log('📱 Generating NEW device fingerprint - platform:', platform, 'isNative:', isNative);
  
  // Generate new fingerprint only if no stored ID exists
  let canvasData = '';
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('Device fingerprint', 2, 2);
    }
    
    canvasData = canvas.toDataURL();
  } catch (e) {
    console.warn('Canvas fingerprint failed:', e);
    canvasData = 'canvas-not-available';
  }
  
  // For native apps, include more device-specific info
  const fingerprint = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform || platform,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvasFingerprint: canvasData,
    isNative: isNative,
    nativePlatform: platform,
    randomSeed: Math.random().toString(36).substring(2, 15) + Date.now().toString(36),
    timestamp: Date.now(),
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio || 1,
  };
  
  const fingerprintString = JSON.stringify(fingerprint);
  let hashHex: string;
  
  // Try to use crypto.subtle, fall back to simple hash
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const encoder = new TextEncoder();
      const data = encoder.encode(fingerprintString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      console.log('🔐 Used crypto.subtle for fingerprint');
    } else {
      throw new Error('crypto.subtle not available');
    }
  } catch (e) {
    console.warn('crypto.subtle not available, using fallback hash:', e);
    hashHex = simpleHash(fingerprintString);
    console.log('🔐 Used fallback hash for fingerprint');
  }
  
  // Store immediately for consistency
  setStoredDeviceId(hashHex);
  if (!hasLoggedDeviceDetails) {
    hasLoggedDeviceDetails = true;
    logFullDeviceDetails(hashHex).catch(() => {});
  }
  
  return hashHex;
};

// Extract actual device name from user agent
export const getDeviceName = (): string => {
  const ua = navigator.userAgent;
  
  // Samsung devices
  const samsungMatch = ua.match(/SM-[A-Z0-9]+|Samsung[- ]([A-Za-z0-9 ]+)/i);
  if (samsungMatch) {
    const model = samsungMatch[1] || samsungMatch[0];
    return `Samsung ${model.replace(/SM-/i, '').replace(/_/g, ' ').trim()}`;
  }
  
  // Infinix devices
  const infinixMatch = ua.match(/Infinix[- ]([A-Za-z0-9 ]+)/i);
  if (infinixMatch) {
    return `Infinix ${infinixMatch[1].trim()}`;
  }
  
  // Tecno devices
  const tecnoMatch = ua.match(/TECNO[- ]([A-Za-z0-9 ]+)/i);
  if (tecnoMatch) {
    return `Tecno ${tecnoMatch[1].trim()}`;
  }
  
  // Xiaomi/Redmi devices
  const xiaomiMatch = ua.match(/(Redmi|Mi|Xiaomi)[- ]?([A-Za-z0-9 ]+)/i);
  if (xiaomiMatch) {
    return `${xiaomiMatch[1]} ${xiaomiMatch[2].trim()}`;
  }
  
  // Oppo devices
  const oppoMatch = ua.match(/OPPO[- ]([A-Za-z0-9 ]+)/i);
  if (oppoMatch) {
    return `Oppo ${oppoMatch[1].trim()}`;
  }
  
  // Vivo devices
  const vivoMatch = ua.match(/vivo[- ]([A-Za-z0-9 ]+)/i);
  if (vivoMatch) {
    return `Vivo ${vivoMatch[1].trim()}`;
  }
  
  // Huawei devices
  const huaweiMatch = ua.match(/HUAWEI[- ]([A-Za-z0-9 ]+)/i);
  if (huaweiMatch) {
    return `Huawei ${huaweiMatch[1].trim()}`;
  }
  
  // iPhone models
  const iphoneMatch = ua.match(/iPhone(\d+[,\d]*)?/i);
  if (iphoneMatch) {
    return iphoneMatch[1] ? `iPhone ${iphoneMatch[1].replace(',', '.')}` : 'iPhone';
  }
  
  // iPad models
  const ipadMatch = ua.match(/iPad(\d+[,\d]*)?/i);
  if (ipadMatch) {
    return ipadMatch[1] ? `iPad ${ipadMatch[1].replace(',', '.')}` : 'iPad';
  }
  
  // Generic Android device
  if (ua.includes('Android')) {
    const androidMatch = ua.match(/Android[^;]*; ([^)]+)\)/i);
    if (androidMatch) {
      const device = androidMatch[1].trim();
      // Clean up common patterns
      const cleanDevice = device
        .replace(/Build\/.*/i, '')
        .replace(/^\s*;\s*/, '')
        .trim();
      if (cleanDevice && cleanDevice !== 'Android' && !cleanDevice.includes('Linux')) {
        return cleanDevice;
      }
    }
    return 'Android Device';
  }
  
  // Desktop devices
  if (ua.includes('Windows')) return 'Windows PC';
  if (ua.includes('Mac')) return 'Mac';
  if (ua.includes('Linux')) return 'Linux PC';
  
  return 'Unknown Device';
};

// Parse device information for display
export const getDeviceInfo = () => {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  let os = 'Unknown';
  let deviceType = 'Desktop';

  // Detect browser
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';

  // Detect OS - Check Android BEFORE Linux (Android reports as Linux in UA)
  if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';

  // Detect device type
  if (/Mobile|Android|iPhone/i.test(ua)) deviceType = 'Mobile';
  else if (/Tablet|iPad/i.test(ua)) deviceType = 'Tablet';

  return {
    browser,
    os,
    deviceType,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
};

