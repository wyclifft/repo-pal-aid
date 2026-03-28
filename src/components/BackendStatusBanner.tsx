import { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { API_CONFIG } from '@/config/api';

/**
 * Banner that shows when the backend is outdated or has issues
 * Detects stale backend by checking /api/version endpoint
 */
export const BackendStatusBanner = () => {
  const [showBanner, setShowBanner] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Check backend version on mount
  useEffect(() => {
    const checkBackendVersion = async () => {
      try {
        const response = await fetch(`${API_CONFIG.MYSQL_API_URL}/api/version`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.status === 404 || !response.ok) {
          // Version endpoint missing = old backend
          setShowBanner(true);
          setErrorMessage('Backend is running an outdated version. New device registrations may fail.');
        }
      } catch {
        // Network error - don't show banner
      }
    };

    checkBackendVersion();

    // Listen for backend outdated events from registration attempts
    const handleBackendOutdated = (e: CustomEvent<{ message: string }>) => {
      setShowBanner(true);
      setErrorMessage(e.detail.message || 'Backend needs update');
    };

    window.addEventListener('backendOutdated', handleBackendOutdated as EventListener);
    return () => window.removeEventListener('backendOutdated', handleBackendOutdated as EventListener);
  }, []);

  // Check for pending registrations
  useEffect(() => {
    try {
      const pending = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
      if (pending.length > 0 && !showBanner) {
        setShowBanner(true);
        setErrorMessage(`${pending.length} device(s) pending registration due to backend issue.`);
      }
    } catch { /* ignore */ }
  }, [showBanner]);

  const retryPendingRegistrations = async () => {
    setIsChecking(true);
    try {
      const pending = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
      
      for (const device of pending) {
        const response = await fetch(`${API_CONFIG.MYSQL_API_URL}/api/devices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_fingerprint: device.fingerprint,
            user_id: 'pending',
            device_info: device.deviceInfo,
            approved: false
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            // Remove from pending
            const remaining = pending.filter((p: { fingerprint: string }) => p.fingerprint !== device.fingerprint);
            localStorage.setItem('pending_device_registrations', JSON.stringify(remaining));
            console.log('✅ Retry successful for:', device.fingerprint.substring(0, 16) + '...');
          }
        }
      }
      
      // Check if any remaining
      const remaining = JSON.parse(localStorage.getItem('pending_device_registrations') || '[]');
      if (remaining.length === 0) {
        setShowBanner(false);
      } else {
        setErrorMessage(`${remaining.length} device(s) still pending.`);
      }
    } catch (e) {
      console.error('Retry failed:', e);
    } finally {
      setIsChecking(false);
    }
  };

  if (!showBanner) return null;

  return (
    <div className="bg-amber-500/90 text-amber-950 px-4 py-2 text-sm flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span className="font-medium">{errorMessage}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={retryPendingRegistrations}
          disabled={isChecking}
          className="h-7 text-amber-950 hover:bg-amber-600/30"
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${isChecking ? 'animate-spin' : ''}`} />
          Retry
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowBanner(false)}
          className="h-7 w-7 text-amber-950 hover:bg-amber-600/30"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};
