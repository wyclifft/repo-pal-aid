import { useState, useEffect, useRef, useCallback } from 'react';

interface OfflineStatus {
  isOnline: boolean;
  isSlowConnection: boolean;
  connectionType: string;
  effectiveType: string;
}

export const useOfflineStatus = () => {
  const [status, setStatus] = useState<OfflineStatus>(() => ({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSlowConnection: false,
    connectionType: 'unknown',
    effectiveType: '4g'
  }));
  
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const updateStatus = useCallback((updates: Partial<OfflineStatus>) => {
    // Debounce rapid updates
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setStatus(prev => {
        const newStatus = { ...prev, ...updates };
        // Only update if something actually changed
        if (JSON.stringify(prev) === JSON.stringify(newStatus)) {
          return prev;
        }
        return newStatus;
      });
    }, 100);
  }, []);

  useEffect(() => {
    const connection = (navigator as any).connection || 
                       (navigator as any).mozConnection || 
                       (navigator as any).webkitConnection;

    const checkConnection = () => {
      const isOnline = navigator.onLine;
      const isSlowConnection = connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g';
      
      updateStatus({
        isOnline,
        isSlowConnection,
        connectionType: connection?.type || 'unknown',
        effectiveType: connection?.effectiveType || '4g'
      });
    };

    // Initial check
    checkConnection();
    
    const handleOnline = () => updateStatus({ isOnline: true });
    const handleOffline = () => updateStatus({ isOnline: false });
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    if (connection) {
      connection.addEventListener('change', checkConnection);
    }
    
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (connection) {
        connection.removeEventListener('change', checkConnection);
      }
    };
  }, [updateStatus]);

  return status;
};

export default useOfflineStatus;
