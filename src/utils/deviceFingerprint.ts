// Generate a unique device fingerprint
export const generateDeviceFingerprint = (): string => {
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
  };
  
  return btoa(JSON.stringify(fingerprint));
};

export const getStoredDeviceId = (): string | null => {
  return localStorage.getItem('device_id');
};

export const setStoredDeviceId = (deviceId: string): void => {
  localStorage.setItem('device_id', deviceId);
};
