import React, { createContext, useContext, ReactNode } from 'react';
import { useDataSync as useDataSyncHook } from '@/hooks/useDataSync';

type SyncContextType = ReturnType<typeof useDataSyncHook>;

const SyncContext = createContext<SyncContextType | null>(null);

export const SyncProvider = ({ children }: { children: ReactNode }) => {
  const sync = useDataSyncHook();

  return (
    <SyncContext.Provider value={sync}>
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = () => {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
};
