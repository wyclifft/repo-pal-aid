import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e',
  appName: 'Milk Collection',
  webDir: 'dist',
  
  // Android configuration
  android: {
    minWebViewVersion: 55,
    allowMixedContent: true,
    captureInput: true,
    backgroundColor: '#1a1a2e',
    // Enable WebView debugging in development
    webContentsDebuggingEnabled: true,
  },
  
  // iOS configuration
  ios: {
    backgroundColor: '#1a1a2e',
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
  
  // Server configuration for development hot-reload
  server: {
    // Uncomment for development with hot-reload:
    // url: 'https://a468e475-ee6a-4fda-9a7e-5e39ba8c375e.lovableproject.com?forceHideBadge=true',
    // cleartext: true,
    
    // Production settings
    androidScheme: 'https',
    iosScheme: 'capacitor',
    hostname: 'app',
  },
  
  // Plugin configurations
  plugins: {
    // Splash screen
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#1a1a2e',
      showSpinner: true,
      spinnerColor: '#22c55e',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    
    // Status bar
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a2e',
    },
    
    // App state management
    App: {
      launchAutoHide: false,
    },
    
    // Network status monitoring
    Network: {},
    
    // Haptic feedback
    Haptics: {},
    
    // Bluetooth LE for scales and printers
    BluetoothLe: {
      displayStrings: {
        scanning: 'Searching for devices...',
        cancel: 'Cancel',
        availableDevices: 'Available Devices',
        noDeviceFound: 'No device found',
      },
    },
  },
  
  // Logging in production
  loggingBehavior: 'production',
};

export default config;
