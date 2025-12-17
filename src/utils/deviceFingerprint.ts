/**
 * Device Fingerprinting Utilities
 * Generate unique device fingerprints and parse device information
 */

const DEVICE_ID_KEY = 'device_id';

/**
 * Generate a unique device fingerprint using SHA-256 hash
 * IMPORTANT: Always returns the same fingerprint for a device by using localStorage
 */
export const generateDeviceFingerprint = async (): Promise<string> => {
  // ALWAYS check stored ID first for consistency
  const storedId = localStorage.getItem(DEVICE_ID_KEY);
  if (storedId) {
    return storedId;
  }
  
  // Generate new fingerprint only if no stored ID exists
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (ctx) {
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Device fingerprint', 2, 2);
  }
  
  const canvasData = canvas.toDataURL();
  
  const fingerprint = {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvasFingerprint: canvasData,
    // Add random component for truly unique ID
    randomSeed: Math.random().toString(36).substring(2, 15),
  };
  
  // Convert fingerprint to string and hash it
  const fingerprintString = JSON.stringify(fingerprint);
  const encoder = new TextEncoder();
  const data = encoder.encode(fingerprintString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Store immediately for consistency
  localStorage.setItem(DEVICE_ID_KEY, hashHex);
  console.log('🔑 Generated and stored new device fingerprint:', hashHex.substring(0, 16) + '...');
  
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

  // Detect OS
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iOS')) os = 'iOS';

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
  return localStorage.getItem('device_id');
};

export const setStoredDeviceId = (deviceId: string): void => {
  localStorage.setItem('device_id', deviceId);
};
