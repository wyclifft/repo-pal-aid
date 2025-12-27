/**
 * Native Platform Initialization
 * Initializes Capacitor plugins and native platform features
 * Production-ready with timeout handling and retry logic
 */
import { Capacitor } from '@capacitor/core';
import { generateDeviceFingerprint, getDeviceName, getDeviceInfo } from './deviceFingerprint';
import { API_CONFIG } from '@/config/api';

// Initialization timeout (10 seconds)
const INIT_TIMEOUT = 10000;
// Device registration retry settings
const MAX_REGISTRATION_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Wrap async operations with timeout
 */
const withTimeout = <T>(promise: Promise<T>, ms: number, operation: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
    )
  ]);
};

/**
 * Sleep utility for retry delays
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Check if error indicates stale backend
 */
const isStaleBackendError = (errorText: string | undefined): boolean => {
  if (!errorText) return false;
  return errorText.includes("Unknown column") || 
         errorText.includes("device_ref") ||
         errorText.includes("ER_BAD_FIELD_ERROR");
};

/**
 * Store pending registration for retry
 */
const storePendingNativeRegistration = (fingerprint: string, deviceInfo: string) => {
  try {
    const pending = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
    const exists = pending.some((p: { fingerprint: string }) => p.fingerprint === fingerprint);
    if (!exists) {
      pending.push({ 
        fingerprint, 
        deviceInfo, 
        timestamp: Date.now(),
        platform: Capacitor.getPlatform(),
        attempts: 1 
      });
      localStorage.setItem('pending_device_registrations', JSON.stringify(pending));
      console.log('💾 [Native] Stored pending registration:', fingerprint.substring(0, 16) + '...');
    }
  } catch (e) {
    console.warn('[Native] Failed to store pending registration:', e);
  }
};

/**
 * Register device with backend for approval with retry logic
 */
const registerDeviceForApproval = async (fingerprint: string, attempt = 1): Promise<boolean> => {
  try {
    const deviceName = getDeviceName();
    const deviceInfo = getDeviceInfo();
    const platform = Capacitor.getPlatform();
    const deviceInfoString = `${deviceName} | ${deviceInfo.os} | ${deviceInfo.browser} | ${deviceInfo.screenResolution} | ${platform}`;
    
    const requestBody = {
      device_fingerprint: fingerprint,
      user_id: 'pending',
      device_info: deviceInfoString,
      approved: false
    };
    
    console.log(`📱 [Native] Registering device (attempt ${attempt}/${MAX_REGISTRATION_RETRIES}):`, fingerprint.substring(0, 16) + '...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(`${API_CONFIG.MYSQL_API_URL}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const responseText = await response.text();
    let data: { success?: boolean; error?: string };
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { success: false, error: responseText };
    }
    
    console.log('📱 [Native] Registration response:', response.status, data.success ? 'SUCCESS' : 'FAILED');
    
    // Check for stale backend
    if (response.status === 500 && isStaleBackendError(data.error || responseText)) {
      console.error('🚨 [Native] BACKEND OUTDATED: Server has stale column references.');
      storePendingNativeRegistration(fingerprint, deviceInfoString);
      window.dispatchEvent(new CustomEvent('backendOutdated', { 
        detail: { message: 'Backend needs update - device_ref column issue' }
      }));
      return false;
    }
    
    if (data.success) {
      // Clear from pending
      try {
        const pending = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
        const filtered = pending.filter((p: { fingerprint: string }) => p.fingerprint !== fingerprint);
        localStorage.setItem('pending_device_registrations', JSON.stringify(filtered));
      } catch { /* ignore */ }
      return true;
    }
    
    // Retry on failure
    if (attempt < MAX_REGISTRATION_RETRIES) {
      console.log(`⏳ [Native] Retrying registration in ${RETRY_DELAY_MS}ms...`);
      await sleep(RETRY_DELAY_MS);
      return registerDeviceForApproval(fingerprint, attempt + 1);
    }
    
    // Store for later retry
    storePendingNativeRegistration(fingerprint, deviceInfoString);
    return false;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('❌ [Native] Device registration request timed out');
    } else {
      console.error('❌ [Native] Device registration failed:', error);
    }
    
    // Retry on network errors
    if (attempt < MAX_REGISTRATION_RETRIES) {
      console.log(`⏳ [Native] Retrying registration in ${RETRY_DELAY_MS}ms...`);
      await sleep(RETRY_DELAY_MS);
      return registerDeviceForApproval(fingerprint, attempt + 1);
    }
    
    return false;
  }
};

/**
 * Check if device exists in backend and register if not
 */
const ensureDeviceRegistered = async (): Promise<void> => {
  try {
    // Generate or retrieve fingerprint with timeout
    const fingerprint = await withTimeout(
      generateDeviceFingerprint(),
      5000,
      'Device fingerprint generation'
    );
    console.log('📱 [Native] Device fingerprint:', fingerprint.substring(0, 16) + '...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    // Check if device exists in backend
    const response = await fetch(
      `${API_CONFIG.MYSQL_API_URL}/api/devices/fingerprint/${encodeURIComponent(fingerprint)}`,
      { 
        method: 'GET',
        signal: controller.signal
      }
    );
    
    clearTimeout(timeoutId);
    
    if (response.status === 404) {
      // Device not found - register it
      console.log('📱 [Native] Device not found, registering...');
      const registered = await registerDeviceForApproval(fingerprint);
      
      if (registered) {
        console.log('✅ [Native] Device registered successfully - waiting for admin approval');
      } else {
        console.log('❌ [Native] Device registration failed - will retry on next launch');
      }
    } else if (response.ok) {
      const data = await response.json();
      if (data.success && data.data) {
        const isApproved = data.data.approved === 1 || data.data.approved === true;
        const isAuthorized = data.data.authorized === 1 || data.data.authorized === true;
        console.log('📱 [Native] Device status - approved:', isApproved, 'authorized:', isAuthorized);
        
        if (!isApproved && !isAuthorized) {
          console.log('⏳ [Native] Device pending approval');
        }
      }
    } else if (response.status === 500) {
      // Server error - try to register anyway as device might not exist yet
      console.log('⚠️ [Native] Server error (500), attempting registration anyway...');
      await registerDeviceForApproval(fingerprint);
    } else {
      console.log('⚠️ [Native] Device check returned status:', response.status);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('❌ [Native] Device check request timed out');
    } else {
      console.error('❌ [Native] Device registration check failed:', error);
    }
    // Don't throw - allow app to continue and retry later
  }
};

/**
 * Initialize native platform features
 * Call this early in app startup
 */
export const initializeNativePlatform = async (): Promise<void> => {
  const isNativePlatform = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  
  console.log('📱 Platform detection - isNative:', isNativePlatform, 'platform:', platform);
  
  if (!isNativePlatform) {
    console.log('📱 Running in web mode');
    return;
  }

  console.log('📱 Initializing native platform:', platform);
  const startTime = Date.now();

  try {
    // Initialize all plugins with timeout protection
    await Promise.all([
      withTimeout(initStatusBar(), INIT_TIMEOUT, 'Status bar init'),
      withTimeout(initSplashScreen(), INIT_TIMEOUT, 'Splash screen init'),
      withTimeout(initNetworkListener(), INIT_TIMEOUT, 'Network listener init'),
      withTimeout(initAppStateListener(), INIT_TIMEOUT, 'App state listener init'),
    ]).catch(error => {
      console.warn('⚠️ Some native features failed to initialize:', error);
    });
    
    // Device registration runs separately - don't block app startup
    ensureDeviceRegistered().catch(error => {
      console.warn('⚠️ Device registration failed, will retry later:', error);
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`✅ Native platform initialized in ${elapsed}ms`);
    
    // Dispatch initialization complete event
    window.dispatchEvent(new CustomEvent('nativeInitComplete', { 
      detail: { platform, elapsed } 
    }));
    
  } catch (error) {
    console.error('❌ Native initialization error:', error);
    // Don't throw - app should still work with degraded native features
    window.dispatchEvent(new CustomEvent('nativeInitError', { 
      detail: { error: error instanceof Error ? error.message : String(error) } 
    }));
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
    
    // Configure splash screen behavior
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
    
    // Listen for back button - close app when pressed
    await App.addListener('backButton', ({ canGoBack }) => {
      console.log('📱 Back button pressed, canGoBack:', canGoBack);
      
      // Check if we're on the main/login page (no history to go back to)
      if (!canGoBack || window.location.pathname === '/') {
        // Exit the app
        App.exitApp();
      } else {
        // Go back in browser history
        window.history.back();
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

/**
 * Retry pending device registrations
 * Call this when network becomes available
 */
export const retryPendingRegistrations = async (): Promise<void> => {
  try {
    const pending = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
    if (pending.length === 0) return;
    
    console.log(`📱 [Native] Retrying ${pending.length} pending registrations...`);
    
    for (const registration of pending) {
      await registerDeviceForApproval(registration.fingerprint);
      // Small delay between retries
      await sleep(1000);
    }
  } catch (error) {
    console.error('Failed to retry pending registrations:', error);
  }
};

// Auto-retry pending registrations when network comes online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    setTimeout(() => retryPendingRegistrations(), 2000);
  });
}