/**
 * Device Fingerprinting Utilities
 * Generate unique device fingerprints and parse device information
 */

const DEVICE_ID_KEY = 'device_id';

const getCapacitorContext = () => {
  try {
    const cap = (window as any)?.Capacitor;
    const platform = cap?.getPlatform?.() || cap?.platform || 'web';
    const isNative = typeof cap?.isNativePlatform === 'function'
      ? cap.isNativePlatform()
      : platform === 'android' || platform === 'ios';

    return { isNative, platform };
  } catch {
    return { isNative: false, platform: 'web' };
  }
};

const getNativeDeviceIdentifier = async (): Promise<string | null> => {
  const { isNative } = getCapacitorContext();
  if (!isNative) return null;

  try {
    const { Device } = await import('@capacitor/device');
    const info = await Device.getId();
    const identifier = typeof info?.identifier === 'string' ? info.identifier.trim() : '';
    return identifier || null;
  } catch (error) {
    console.warn('Native device identifier unavailable, using fallback fingerprinting:', error);
    return null;
  }
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
 * Generate a unique device fingerprint
 * Uses native Device.getId() on Capacitor first, then SHA-256/browser fallback
 * IMPORTANT: Always returns the same fingerprint for a device by using localStorage
 */
export const generateDeviceFingerprint = async (): Promise<string> => {
  const { isNative, platform } = getCapacitorContext();

  // ALWAYS check stored ID first for consistency
  try {
    const storedId = localStorage.getItem(DEVICE_ID_KEY);
    if (storedId && storedId.trim().length >= 16) {
      console.log('📱 Using stored device fingerprint:', storedId.substring(0, 16) + '...');
      return storedId;
    }
  } catch (e) {
    console.warn('📱 localStorage read failed:', e);
  }

  console.log('📱 Generating NEW device fingerprint - platform:', platform, 'isNative:', isNative);

  // Native-first identifier for Capacitor Android/iOS
  const nativeIdentifier = await getNativeDeviceIdentifier();

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

  const fingerprint = {
    nativeIdentifier,
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform || platform,
    nativePlatform: platform,
    isNative,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvasFingerprint: canvasData,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio || 1,
    // Add randomness ONLY when native identifier is unavailable
    randomSeed: nativeIdentifier ? undefined : Math.random().toString(36).substring(2, 15),
    createdAt: nativeIdentifier ? undefined : Date.now(),
  };

  const fingerprintString = JSON.stringify(fingerprint);
  let hashHex = '';

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

  // Safety fallback: guarantee a non-empty fingerprint
  if (!hashHex || hashHex.length < 16) {
    hashHex = simpleHash(`${nativeIdentifier || 'fallback'}|${navigator.userAgent}|${Date.now()}`);
  }

  // Store immediately for consistency
  try {
    localStorage.setItem(DEVICE_ID_KEY, hashHex);
    console.log('🔑 Generated and stored new device fingerprint:', hashHex.substring(0, 16) + '...');
  } catch (e) {
    console.error('❌ Failed to store fingerprint:', e);
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

export const getStoredDeviceId = (): string | null => {
  try {
    const value = localStorage.getItem(DEVICE_ID_KEY);
    if (!value) return null;

    const normalized = value.trim();
    if (!normalized || normalized === 'undefined' || normalized === 'null' || normalized.length < 16) {
      return null;
    }

    return normalized;
  } catch {
    return null;
  }
};

export const setStoredDeviceId = (deviceId: string): void => {
  if (!deviceId || !deviceId.trim()) return;
  try {
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  } catch (error) {
    console.warn('Failed to persist device fingerprint:', error);
  }
};
