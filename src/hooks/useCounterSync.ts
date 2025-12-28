import { useState, useEffect, useCallback } from 'react';
import { getDeviceConfig } from '@/utils/referenceGenerator';

export interface CounterState {
  trnid: number;
  milkId: number;
  storeId: number;
  aiId: number;
  devcode: string;
}

/**
 * Hook to subscribe to counter updates
 * Listens for counterUpdate events dispatched when milkid/storeid/aiid are synced from backend
 */
export const useCounterSync = () => {
  const [counters, setCounters] = useState<CounterState>({
    trnid: 0,
    milkId: 0,
    storeId: 0,
    aiId: 0,
    devcode: '',
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load initial counter values from IndexedDB/localStorage
  const loadCounters = useCallback(async () => {
    try {
      const config = await getDeviceConfig();
      const devcode = localStorage.getItem('devcode') || config?.devcode || '';
      
      setCounters({
        trnid: config?.lastTrnId || 0,
        milkId: config?.milkId || 0,
        storeId: config?.storeId || 0,
        aiId: config?.aiId || 0,
        devcode,
      });
    } catch (error) {
      console.error('Failed to load counters:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load initial values
    loadCounters();

    // Listen for counter update events
    const handleCounterUpdate = (event: CustomEvent<{ trnid: number; milkId: number; storeId: number; aiId: number }>) => {
      const { trnid, milkId, storeId, aiId } = event.detail;
      const devcode = localStorage.getItem('devcode') || '';
      
      setCounters({
        trnid,
        milkId,
        storeId,
        aiId,
        devcode,
      });
      
      console.log('📊 Counter state updated:', event.detail);
    };

    window.addEventListener('counterUpdate', handleCounterUpdate as EventListener);

    return () => {
      window.removeEventListener('counterUpdate', handleCounterUpdate as EventListener);
    };
  }, [loadCounters]);

  // Manually refresh counters
  const refreshCounters = useCallback(async () => {
    setIsLoading(true);
    await loadCounters();
  }, [loadCounters]);

  return {
    counters,
    isLoading,
    refreshCounters,
  };
};
