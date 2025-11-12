import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e',
  appName: 'Milk Collection',
  webDir: 'dist',
  server: {
    url: 'https://a468e475-ee6a-4fda-9a7e-5e39ba8c375e.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  android: {
    minWebViewVersion: 55, // Chrome 55 (Android 7.0 compatible)
    allowMixedContent: true,
    captureInput: true
  }
};

export default config;
