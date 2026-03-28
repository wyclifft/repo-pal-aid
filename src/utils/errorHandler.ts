// Global error handling utilities for production stability
import { Capacitor } from '@capacitor/core';

// Track errors to avoid duplicate logging
const errorLog = new Set<string>();
const MAX_ERROR_LOG_SIZE = 100;

// Error severity levels
type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

interface ErrorReport {
  message: string;
  stack?: string;
  context?: string;
  severity: ErrorSeverity;
  timestamp: number;
  platform: string;
  url: string;
  userAgent: string;
}

// Store errors for later analysis
const storedErrors: ErrorReport[] = [];
const MAX_STORED_ERRORS = 50;

/**
 * Determine error severity based on error type and context
 */
const getErrorSeverity = (error: unknown, context?: string): ErrorSeverity => {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  
  // Critical errors that affect core functionality
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
    return 'medium';
  }
  if (lowerMessage.includes('database') || lowerMessage.includes('indexeddb')) {
    return 'high';
  }
  if (lowerMessage.includes('auth') || lowerMessage.includes('login')) {
    return 'high';
  }
  if (context?.includes('bluetooth') || context?.includes('printer')) {
    return 'medium';
  }
  
  return 'low';
};

/**
 * Create error report object
 */
const createErrorReport = (error: unknown, context?: string): ErrorReport => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  return {
    message: errorMessage,
    stack: errorStack,
    context,
    severity: getErrorSeverity(error, context),
    timestamp: Date.now(),
    platform: Capacitor.getPlatform(),
    url: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };
};

/**
 * Store error for later analysis
 */
const storeError = (report: ErrorReport) => {
  storedErrors.push(report);
  if (storedErrors.length > MAX_STORED_ERRORS) {
    storedErrors.shift();
  }
  
  // Persist to localStorage for crash recovery
  try {
    localStorage.setItem('app_error_log', JSON.stringify(storedErrors.slice(-20)));
  } catch {
    // Storage full, ignore
  }
};

/**
 * Check if error should be logged (deduplicate)
 */
const shouldLogError = (error: unknown): boolean => {
  const key = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  
  if (errorLog.has(key)) {
    return false;
  }
  
  errorLog.add(key);
  if (errorLog.size > MAX_ERROR_LOG_SIZE) {
    const iterator = errorLog.values();
    errorLog.delete(iterator.next().value);
  }
  
  return true;
};

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  if (!shouldLogError(event.reason)) return;
  
  console.error('Unhandled promise rejection:', event.reason);
  
  const report = createErrorReport(event.reason, 'unhandledrejection');
  storeError(report);
  
  // Prevent the default browser handling
  event.preventDefault();
  
  // Dispatch custom event for app monitoring
  window.dispatchEvent(new CustomEvent('appError', { detail: report }));
});

// Handle global errors
window.addEventListener('error', (event) => {
  if (!shouldLogError(event.error || event.message)) return;
  
  console.error('Global error:', event.error || event.message);
  
  const report = createErrorReport(event.error || event.message, 'globalError');
  storeError(report);
  
  // Prevent the default browser handling
  event.preventDefault();
  
  // Dispatch custom event for app monitoring
  window.dispatchEvent(new CustomEvent('appError', { detail: report }));
});

// Network error handling
window.addEventListener('offline', () => {
  console.warn('📡 Network offline - app will continue in offline mode');
  window.dispatchEvent(new CustomEvent('networkStatusChange', { detail: { online: false } }));
});

window.addEventListener('online', () => {
  console.log('📡 Network online - syncing data...');
  window.dispatchEvent(new CustomEvent('networkStatusChange', { detail: { online: true } }));
});

// Service worker error handling
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('🔄 Service worker updated - reload recommended');
  });
  
  navigator.serviceWorker.addEventListener('error', (event) => {
    console.error('Service worker error:', event);
  });
}

/**
 * Log error with context
 */
export const logError = (error: unknown, context?: string): void => {
  if (!shouldLogError(error)) return;
  
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`Error${context ? ` in ${context}` : ''}:`, errorMessage);
  
  const report = createErrorReport(error, context);
  storeError(report);
  
  // In production on native, we could send to a crash reporting service
  if (Capacitor.isNativePlatform()) {
    // Future: Send to crash reporting service like Sentry, Crashlytics
  }
};

/**
 * Handle async errors with graceful fallback
 */
export const handleAsyncError = async <T>(
  promise: Promise<T>,
  context?: string
): Promise<T | null> => {
  try {
    return await promise;
  } catch (error) {
    logError(error, context);
    return null;
  }
};

/**
 * Wrap a function with error handling
 */
export const withErrorHandling = <T extends (...args: any[]) => any>(
  fn: T,
  context?: string
): ((...args: Parameters<T>) => ReturnType<T> | undefined) => {
  return (...args: Parameters<T>): ReturnType<T> | undefined => {
    try {
      const result = fn(...args);
      // Handle async functions
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          logError(error, context);
          return undefined;
        }) as ReturnType<T>;
      }
      return result;
    } catch (error) {
      logError(error, context);
      return undefined;
    }
  };
};

/**
 * Get stored errors for debugging
 */
export const getStoredErrors = (): ErrorReport[] => {
  return [...storedErrors];
};

/**
 * Clear stored errors
 */
export const clearStoredErrors = (): void => {
  storedErrors.length = 0;
  errorLog.clear();
  try {
    localStorage.removeItem('app_error_log');
  } catch {
    // Ignore
  }
};

/**
 * Get error summary for crash reports
 */
export const getErrorSummary = (): { total: number; critical: number; high: number; recent: ErrorReport[] } => {
  const critical = storedErrors.filter(e => e.severity === 'critical').length;
  const high = storedErrors.filter(e => e.severity === 'high').length;
  const recent = storedErrors.slice(-5);
  
  return {
    total: storedErrors.length,
    critical,
    high,
    recent,
  };
};

/**
 * Recover errors from previous session
 */
export const recoverStoredErrors = (): void => {
  try {
    const stored = localStorage.getItem('app_error_log');
    if (stored) {
      const errors = JSON.parse(stored) as ErrorReport[];
      if (errors.length > 0) {
        console.log(`📋 Recovered ${errors.length} errors from previous session`);
        storedErrors.push(...errors);
      }
    }
  } catch {
    // Ignore recovery errors
  }
};

// Recover errors on load
recoverStoredErrors();