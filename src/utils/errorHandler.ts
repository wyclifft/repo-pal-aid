// Global error handling utilities

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  
  // Prevent the default browser handling
  event.preventDefault();
  
  // You could send this to an error tracking service in production
  // e.g., Sentry, LogRocket, etc.
});

// Handle global errors
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  
  // Prevent the default browser handling
  event.preventDefault();
});

// Network error handling
window.addEventListener('offline', () => {
  console.warn('📡 Network offline - app will continue in offline mode');
});

window.addEventListener('online', () => {
  console.log('📡 Network online - syncing data...');
});

// Service worker error handling
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('🔄 Service worker updated - reload recommended');
  });
}

export const logError = (error: unknown, context?: string) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`Error${context ? ` in ${context}` : ''}:`, errorMessage);
  
  // In production, send to error tracking service
  // Example: Sentry.captureException(error);
};

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
