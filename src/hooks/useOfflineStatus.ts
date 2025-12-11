import { useState, useEffect, useCallback } from 'react';

interface OfflineStatus {
  isOnline: boolean;
  isSlowConnection: boolean;
  connectionType: string;
  effectiveType: string;
}

export const useOfflineStatus = () => {
  const [status, setStatus] = useState<OfflineStatus>({
    isOnline: navigator.onLine,
    isSlowConnection: false,
    connectionType: 'unknown',
    effectiveType: '4g'
  });

  const updateConnectionInfo = useCallback(() => {
    const connection = (navigator as any).connection || 
                       (navigator as any).mozConnection || 
                       (navigator as any).webkitConnection;
    
    if (connection) {
      setStatus(prev => ({
        ...prev,
        isOnline: navigator.onLine,
        isSlowConnection: connection.effectiveType === '2g' || connection.effectiveType === 'slow-2g',
        connectionType: connection.type || 'unknown',
        effectiveType: connection.effectiveType || '4g'
      }));
    } else {
      setStatus(prev => ({
        ...prev,
        isOnline: navigator.onLine
      }));
    }
  }, []);

  useEffect(() => {
    updateConnectionInfo();
    
    const handleOnline = () => {
      setStatus(prev => ({ ...prev, isOnline: true }));
      updateConnectionInfo();
    };
    
    const handleOffline = () => {
      setStatus(prev => ({ ...prev, isOnline: false }));
    };
    
    const handleConnectionChange = (e: CustomEvent) => {
      setStatus(prev => ({ ...prev, isOnline: e.detail.online }));
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('connectionChange', handleConnectionChange as EventListener);
    
    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', updateConnectionInfo);
    }
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('connectionChange', handleConnectionChange as EventListener);
      if (connection) {
        connection.removeEventListener('change', updateConnectionInfo);
      }
    };
  }, [updateConnectionInfo]);

  return status;
};

export default useOfflineStatus;
