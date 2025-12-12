/**
 * Native Platform Initialization
 * Initializes Capacitor plugins and native platform features
 */
import { Capacitor } from '@capacitor/core';

/**
 * Initialize native platform features
 * Call this early in app startup
 */
export const initializeNativePlatform = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) {
    console.log('📱 Running in web mode');
    return;
  }

  console.log('📱 Initializing native platform:', Capacitor.getPlatform());

  try {
    // Initialize Status Bar
    await initStatusBar();
    
    // Initialize Splash Screen
    await initSplashScreen();
    
    // Initialize Network listener
    await initNetworkListener();
    
    // Initialize App state listener
    await initAppStateListener();
    
    console.log('✅ Native platform initialized');
  } catch (error) {
    console.error('❌ Native initialization error:', error);
  }
};

/**
 * Initialize Status Bar
 */
const initStatusBar = async (): Promise<void> => {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#1a1a2e' });
    
    // Make status bar overlay content on iOS for edge-to-edge design
    if (Capacitor.getPlatform() === 'ios') {
      await StatusBar.setOverlaysWebView({ overlay: true });
    }
    
    console.log('✅ Status bar initialized');
  } catch (error) {
    console.warn('Status bar initialization failed:', error);
  }
};

/**
 * Initialize Splash Screen
 */
const initSplashScreen = async (): Promise<void> => {
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    
    // Auto-hide after app is ready
    // This is controlled by the app when it's fully loaded
    console.log('✅ Splash screen ready');
  } catch (error) {
    console.warn('Splash screen initialization failed:', error);
  }
};

/**
 * Initialize Network Listener
 */
const initNetworkListener = async (): Promise<void> => {
  try {
    const { Network } = await import('@capacitor/network');
    
    // Get initial status
    const status = await Network.getStatus();
    console.log('📶 Initial network status:', status.connected ? 'online' : 'offline');
    
    // Set up listener
    await Network.addListener('networkStatusChange', (status) => {
      console.log('📶 Network status changed:', status.connected ? 'online' : 'offline');
      
      // Dispatch custom event for app components
      window.dispatchEvent(new CustomEvent('nativeNetworkChange', {
        detail: { connected: status.connected, connectionType: status.connectionType }
      }));
      
      // Also dispatch standard events for compatibility
      if (status.connected) {
        window.dispatchEvent(new Event('online'));
      } else {
        window.dispatchEvent(new Event('offline'));
      }
    });
    
    console.log('✅ Network listener initialized');
  } catch (error) {
    console.warn('Network listener initialization failed:', error);
  }
};

/**
 * Initialize App State Listener
 */
const initAppStateListener = async (): Promise<void> => {
  try {
    const { App } = await import('@capacitor/app');
    
    // Listen for app state changes
    await App.addListener('appStateChange', ({ isActive }) => {
      console.log('📱 App state:', isActive ? 'active' : 'background');
      
      window.dispatchEvent(new CustomEvent('appStateChange', {
        detail: { isActive }
      }));
      
      // Trigger sync when app becomes active
      if (isActive) {
        window.dispatchEvent(new CustomEvent('appVisible'));
      }
    });
    
    // Listen for URL open (deep links)
    await App.addListener('appUrlOpen', ({ url }) => {
      console.log('🔗 App URL opened:', url);
      window.dispatchEvent(new CustomEvent('appUrlOpen', { detail: { url } }));
    });
    
    console.log('✅ App state listener initialized');
  } catch (error) {
    console.warn('App state listener initialization failed:', error);
  }
};

/**
 * Hide the splash screen
 * Call this when the app is fully loaded
 */
export const hideSplashScreen = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 300 });
    console.log('✅ Splash screen hidden');
  } catch (error) {
    console.warn('Failed to hide splash screen:', error);
  }
};

/**
 * Check if running on native platform
 */
export const isNative = (): boolean => {
  return Capacitor.isNativePlatform();
};

/**
 * Get current platform
 */
export const getPlatform = (): 'ios' | 'android' | 'web' => {
  return Capacitor.getPlatform() as 'ios' | 'android' | 'web';
};

/**
 * Get safe area insets for edge-to-edge design
 */
export const getSafeAreaInsets = (): { top: number; bottom: number; left: number; right: number } => {
  const style = getComputedStyle(document.documentElement);
  
  return {
    top: parseInt(style.getPropertyValue('--safe-area-inset-top') || '0', 10),
    bottom: parseInt(style.getPropertyValue('--safe-area-inset-bottom') || '0', 10),
    left: parseInt(style.getPropertyValue('--safe-area-inset-left') || '0', 10),
    right: parseInt(style.getPropertyValue('--safe-area-inset-right') || '0', 10),
  };
};
