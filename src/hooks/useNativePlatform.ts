/**
 * Native Platform Utilities Hook
 * Provides cross-platform functionality for Capacitor mobile apps
 */
import { useCallback, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

// Lazy-load native plugins to avoid errors on web
const loadHaptics = async () => {
  if (Capacitor.isNativePlatform()) {
    const { Haptics } = await import('@capacitor/haptics');
    return Haptics;
  }
  return null;
};

const loadNetwork = async () => {
  if (Capacitor.isNativePlatform()) {
    const { Network } = await import('@capacitor/network');
    return Network;
  }
  return null;
};

const loadApp = async () => {
  if (Capacitor.isNativePlatform()) {
    const { App } = await import('@capacitor/app');
    return App;
  }
  return null;
};

const loadStatusBar = async () => {
  if (Capacitor.isNativePlatform()) {
    const { StatusBar } = await import('@capacitor/status-bar');
    return StatusBar;
  }
  return null;
};

const loadSplashScreen = async () => {
  if (Capacitor.isNativePlatform()) {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    return SplashScreen;
  }
  return null;
};

export const useNativePlatform = () => {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  const networkListenerRef = useRef<any>(null);
  const backButtonListenerRef = useRef<any>(null);

  /**
   * Trigger haptic feedback
   */
  const triggerHaptic = useCallback(async (type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light') => {
    if (!isNative) return;
    
    try {
      const Haptics = await loadHaptics();
      if (!Haptics) return;
      
      const { ImpactStyle, NotificationType } = await import('@capacitor/haptics');
      
      switch (type) {
        case 'light':
          await Haptics.impact({ style: ImpactStyle.Light });
          break;
        case 'medium':
          await Haptics.impact({ style: ImpactStyle.Medium });
          break;
        case 'heavy':
          await Haptics.impact({ style: ImpactStyle.Heavy });
          break;
        case 'success':
          await Haptics.notification({ type: NotificationType.Success });
          break;
        case 'warning':
          await Haptics.notification({ type: NotificationType.Warning });
          break;
        case 'error':
          await Haptics.notification({ type: NotificationType.Error });
          break;
      }
    } catch (error) {
      console.warn('Haptics not available:', error);
    }
  }, [isNative]);

  /**
   * Vibrate for a duration (Android only)
   */
  const vibrate = useCallback(async (duration: number = 100) => {
    if (!isNative) return;
    
    try {
      const Haptics = await loadHaptics();
      if (Haptics) {
        await Haptics.vibrate({ duration });
      }
    } catch (error) {
      console.warn('Vibration not available:', error);
    }
  }, [isNative]);

  /**
   * Set up network status listener
   */
  const setupNetworkListener = useCallback(async (onChange: (connected: boolean) => void) => {
    if (!isNative) {
      // Fallback to web API
      const handleOnline = () => onChange(true);
      const handleOffline = () => onChange(false);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
    
    try {
      const Network = await loadNetwork();
      if (!Network) return () => {};
      
      // Get initial status
      const status = await Network.getStatus();
      onChange(status.connected);
      
      // Listen for changes
      const listener = await Network.addListener('networkStatusChange', (status) => {
        onChange(status.connected);
      });
      
      networkListenerRef.current = listener;
      
      return () => {
        listener?.remove();
      };
    } catch (error) {
      console.warn('Network listener setup failed:', error);
      return () => {};
    }
  }, [isNative]);

  /**
   * Set up back button handler (Android)
   */
  const setupBackButtonHandler = useCallback(async (onBackButton: () => boolean) => {
    if (!isNative || platform !== 'android') return () => {};
    
    try {
      const App = await loadApp();
      if (!App) return () => {};
      
      const listener = await App.addListener('backButton', ({ canGoBack }) => {
        const handled = onBackButton();
        if (!handled && canGoBack) {
          window.history.back();
        } else if (!handled) {
          App.exitApp();
        }
      });
      
      backButtonListenerRef.current = listener;
      
      return () => {
        listener?.remove();
      };
    } catch (error) {
      console.warn('Back button handler setup failed:', error);
      return () => {};
    }
  }, [isNative, platform]);

  /**
   * Hide splash screen
   */
  const hideSplashScreen = useCallback(async () => {
    if (!isNative) return;
    
    try {
      const SplashScreen = await loadSplashScreen();
      if (SplashScreen) {
        await SplashScreen.hide();
      }
    } catch (error) {
      console.warn('SplashScreen hide failed:', error);
    }
  }, [isNative]);

  /**
   * Set status bar style
   */
  const setStatusBarStyle = useCallback(async (dark: boolean = true) => {
    if (!isNative) return;
    
    try {
      const StatusBar = await loadStatusBar();
      if (!StatusBar) return;
      
      const { Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
      await StatusBar.setBackgroundColor({ color: '#1a1a2e' });
    } catch (error) {
      console.warn('StatusBar style change failed:', error);
    }
  }, [isNative]);

  /**
   * Get current network status
   */
  const getNetworkStatus = useCallback(async (): Promise<boolean> => {
    if (!isNative) {
      return navigator.onLine;
    }
    
    try {
      const Network = await loadNetwork();
      if (Network) {
        const status = await Network.getStatus();
        return status.connected;
      }
    } catch (error) {
      console.warn('Network status check failed:', error);
    }
    return navigator.onLine;
  }, [isNative]);

  /**
   * Exit the app (Android only)
   */
  const exitApp = useCallback(async () => {
    if (!isNative || platform !== 'android') return;
    
    try {
      const App = await loadApp();
      if (App) {
        await App.exitApp();
      }
    } catch (error) {
      console.warn('Exit app failed:', error);
    }
  }, [isNative, platform]);

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      networkListenerRef.current?.remove();
      backButtonListenerRef.current?.remove();
    };
  }, []);

  return {
    isNative,
    platform,
    triggerHaptic,
    vibrate,
    setupNetworkListener,
    setupBackButtonHandler,
    hideSplashScreen,
    setStatusBarStyle,
    getNetworkStatus,
    exitApp,
  };
};

// Standalone utility functions for use outside of React components
export const nativeUtils = {
  isNative: () => Capacitor.isNativePlatform(),
  getPlatform: () => Capacitor.getPlatform(),
  
  async triggerHaptic(type: 'light' | 'medium' | 'heavy' = 'light') {
    if (!Capacitor.isNativePlatform()) return;
    
    try {
      const Haptics = await loadHaptics();
      if (!Haptics) return;
      
      const { ImpactStyle } = await import('@capacitor/haptics');
      
      const styleMap = {
        light: ImpactStyle.Light,
        medium: ImpactStyle.Medium,
        heavy: ImpactStyle.Heavy,
      };
      
      await Haptics.impact({ style: styleMap[type] });
    } catch (error) {
      // Silently fail
    }
  },
  
  async getNetworkStatus(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return navigator.onLine;
    }
    
    try {
      const Network = await loadNetwork();
      if (Network) {
        const status = await Network.getStatus();
        return status.connected;
      }
    } catch (error) {
      // Fallback
    }
    return navigator.onLine;
  },
};
