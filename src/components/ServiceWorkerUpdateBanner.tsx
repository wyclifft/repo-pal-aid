import { useState, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UpdateState {
  updateAvailable: boolean;
  registration: ServiceWorkerRegistration | null;
}

export const ServiceWorkerUpdateBanner = () => {
  const [updateState, setUpdateState] = useState<UpdateState>({
    updateAvailable: false,
    registration: null,
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleUpdate = (registration: ServiceWorkerRegistration) => {
      const newWorker = registration.installing || registration.waiting;
      
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('🔄 New service worker ready');
            setUpdateState({ updateAvailable: true, registration });
          }
        });
      }
    };

    // Check for existing waiting service worker
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.waiting) {
        setUpdateState({ updateAvailable: true, registration });
      }

      // Listen for new updates
      registration.addEventListener('updatefound', () => {
        handleUpdate(registration);
      });
    });

    // Also check on registration
    navigator.serviceWorker.getRegistration().then((registration) => {
      if (registration?.waiting) {
        setUpdateState({ updateAvailable: true, registration });
      }
    });
  }, []);

  const handleUpdate = () => {
    const { registration } = updateState;
    
    if (registration?.waiting) {
      // Tell the waiting service worker to activate
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    
    // Reload after a short delay to ensure SW activates
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  if (!updateState.updateAvailable || dismissed) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-primary text-primary-foreground px-4 py-3 shadow-lg animate-in slide-in-from-top">
      <div className="flex items-center justify-between max-w-screen-xl mx-auto">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-5 w-5 animate-spin-slow" />
          <div className="text-sm">
            <span className="font-medium">New version available!</span>
            <span className="hidden sm:inline ml-1 opacity-90">
              Reload to get the latest features and fixes.
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleUpdate}
            className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Update Now
          </Button>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-primary-foreground/20 rounded"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
