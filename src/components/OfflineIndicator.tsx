import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react';

export const OfflineIndicator = () => {
  const { isOnline, isSlowConnection } = useOfflineStatus();

  if (isOnline && !isSlowConnection) return null;

  return (
    <div 
      className={`fixed bottom-0 left-0 right-0 z-[100] px-4 py-2 text-center text-sm font-medium transition-all duration-300 ${
        !isOnline 
          ? 'bg-destructive text-destructive-foreground' 
          : 'bg-yellow-500 text-yellow-900'
      }`}
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center justify-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="h-4 w-4" />
            <span>You're offline. Data will sync when connected.</span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-4 w-4" />
            <span>Slow connection detected</span>
          </>
        )}
      </div>
    </div>
  );
};

export default OfflineIndicator;
