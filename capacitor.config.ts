import { CapacitorConfig } from '@capacitor/cli';

const isProduction = process.env.NODE_ENV === 'production';

const config: CapacitorConfig = {
  appId: 'app.delicoop101',
  appName: 'DeliCoop101',
  webDir: 'dist',
  
  // Android configuration
  android: {
    minWebViewVersion: 55,
    allowMixedContent: false, // Disabled for production security
    captureInput: true,
    backgroundColor: '#1a1a2e',
    // Disable WebView debugging in production
    webContentsDebuggingEnabled: !isProduction,
    // Build type for optimizations
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  
  // iOS configuration
  ios: {
    backgroundColor: '#1a1a2e',
    contentInset: 'automatic',
    allowsLinkPreview: false,
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: true,
    preferredContentMode: 'mobile',
  },
  
  // Server configuration - production settings
  server: {
    // Production settings - serve from bundled assets
    androidScheme: 'https',
    iosScheme: 'capacitor',
    hostname: 'app',
    // Error handling
    errorPath: '/offline.html',
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
      layoutName: 'launch_screen',
      useDialog: true,
    },
    
    // Status bar
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a2e',
      overlaysWebView: false,
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
    
    // Preferences for secure storage
    Preferences: {
      // Use encrypted storage on Android
    },
  },
  
  // Production logging behavior
  loggingBehavior: isProduction ? 'none' : 'debug',
};

export default config;
