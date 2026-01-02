/**
 * Haptic Feedback Hook
 * Provides easy-to-use haptic feedback for Capacitor apps
 * Falls back silently on web platforms
 */
import { useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';

// Cache for loaded Haptics module
let hapticsCache: any = null;
let hapticsLoading: Promise<any> | null = null;

const loadHaptics = async () => {
  if (hapticsCache) return hapticsCache;
  if (hapticsLoading) return hapticsLoading;
  
  if (!Capacitor.isNativePlatform()) {
    return null;
  }
  
  hapticsLoading = import('@capacitor/haptics').then(module => {
    hapticsCache = module;
    return module;
  });
  
  return hapticsLoading;
};

/**
 * Trigger haptic feedback - standalone function for use outside React
 */
export const triggerHaptic = async (type: HapticType = 'light'): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  
  try {
    const module = await loadHaptics();
    if (!module) return;
    
    const { Haptics, ImpactStyle, NotificationType } = module;
    
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
      case 'selection':
        await Haptics.selectionStart();
        await Haptics.selectionEnd();
        break;
    }
  } catch (error) {
    // Silently fail - haptics not critical
    console.debug('Haptics unavailable:', error);
  }
};

/**
 * React hook for haptic feedback
 */
export const useHaptics = () => {
  const isNative = Capacitor.isNativePlatform();
  
  const haptic = useCallback(async (type: HapticType = 'light') => {
    await triggerHaptic(type);
  }, []);
  
  // Convenience methods
  const light = useCallback(() => haptic('light'), [haptic]);
  const medium = useCallback(() => haptic('medium'), [haptic]);
  const heavy = useCallback(() => haptic('heavy'), [haptic]);
  const success = useCallback(() => haptic('success'), [haptic]);
  const warning = useCallback(() => haptic('warning'), [haptic]);
  const error = useCallback(() => haptic('error'), [haptic]);
  const selection = useCallback(() => haptic('selection'), [haptic]);
  
  return {
    isNative,
    haptic,
    light,
    medium,
    heavy,
    success,
    warning,
    error,
    selection,
  };
};
