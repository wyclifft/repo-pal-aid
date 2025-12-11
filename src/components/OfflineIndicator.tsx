import { useState, useEffect } from 'react';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { WifiOff, AlertTriangle, X } from 'lucide-react';

export const OfflineIndicator = () => {
  const { isOnline, isSlowConnection } = useOfflineStatus();
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  // Show indicator only when offline or slow, reset dismissed on status change
  useEffect(() => {
    if (!isOnline || isSlowConnection) {
      setVisible(true);
      setDismissed(false);
    } else {
      // Hide after coming online with a small delay
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, isSlowConnection]);

  // Auto-dismiss slow connection warning after 5 seconds
  useEffect(() => {
    if (isOnline && isSlowConnection && !dismissed) {
      const timer = setTimeout(() => setDismissed(true), 5000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, isSlowConnection, dismissed]);

  if (!visible || dismissed || (isOnline && !isSlowConnection)) return null;

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
            <span>Offline - Data saved locally</span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-4 w-4" />
            <span>Slow connection</span>
            <button 
              onClick={() => setDismissed(true)}
              className="ml-2 p-0.5 hover:bg-yellow-600 rounded"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default OfflineIndicator;
