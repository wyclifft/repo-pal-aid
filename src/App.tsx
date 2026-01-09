import React, { useState, useEffect, lazy, Suspense, useCallback, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { SplashScreen } from "@/components/SplashScreen";
import { useDataSync } from "@/hooks/useDataSync";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { BackendStatusBanner } from "@/components/BackendStatusBanner";
import { ServiceWorkerUpdateBanner } from "@/components/ServiceWorkerUpdateBanner";
import { preloadCriticalAssets } from "@/utils/precachePages";
import { requestAllPermissions } from "@/utils/permissionRequests";

// Lazy load route components for better performance
const Index = lazy(() => import("./pages/Index"));
const ZReport = lazy(() => import("./pages/ZReport"));
const Store = lazy(() => import("./pages/Store"));
const PeriodicReport = lazy(() => import("./pages/PeriodicReport"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Configure QueryClient with aggressive caching and better error handling
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      networkMode: 'offlineFirst',
    },
  },
});

// Create custom persister using localStorage with compression and error handling
const persister = {
  persistClient: async (client: any) => {
    try {
      const serialized = JSON.stringify(client);
      // Check storage quota before saving
      if (serialized.length > 4 * 1024 * 1024) {
        console.warn('Query cache too large, skipping persistence');
        return;
      }
      localStorage.setItem('REACT_QUERY_OFFLINE_CACHE', serialized);
    } catch (error) {
      console.warn('Failed to persist query cache:', error);
      // Try to clear old cache if storage is full
      try {
        localStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
      } catch (e) {
        console.error('Storage quota exceeded');
      }
    }
  },
  restoreClient: async () => {
    try {
      const cached = localStorage.getItem('REACT_QUERY_OFFLINE_CACHE');
      if (!cached) return undefined;
      const parsed = JSON.parse(cached);
      // Validate cache structure
      if (!parsed || typeof parsed !== 'object') {
        localStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
        return undefined;
      }
      return parsed;
    } catch (error) {
      console.warn('Failed to restore query cache:', error);
      localStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
      return undefined;
    }
  },
  removeClient: async () => {
    try {
      localStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
    } catch (error) {
      console.warn('Failed to remove query cache:', error);
    }
  },
};

// Loading skeleton component
const PageLoader = () => (
  <div className="h-full flex items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
      <span className="text-sm text-muted-foreground">Loading...</span>
    </div>
  </div>
);

// Page transition wrapper with fixed viewport
const PageWrapper = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  
  return (
    <div 
      key={location.pathname} 
      className="h-full overflow-y-auto overflow-x-hidden animate-fade-in gpu-accelerated"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {children}
    </div>
  );
};

// Wrapper component to use hooks inside context providers
const AppContent = () => {
  const mountedRef = useRef(true);
  
  // Initialize global data sync
  useDataSync();
  
  // Listen for app becoming visible to refresh data
  useEffect(() => {
    const handleVisible = () => {
      if (!mountedRef.current) return;
      // Trigger a soft refresh when app becomes visible
      queryClient.invalidateQueries({ refetchType: 'none' });
    };
    
    window.addEventListener('appVisible', handleVisible);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('appVisible', handleVisible);
    };
  }, []);
  
  // Listen for background sync events
  useEffect(() => {
    const handleBackgroundSync = () => {
      if (!mountedRef.current) return;
      console.log('🔄 Background sync triggered');
      queryClient.invalidateQueries();
    };
    
    window.addEventListener('backgroundSync', handleBackgroundSync);
    return () => window.removeEventListener('backgroundSync', handleBackgroundSync);
  }, []);
  
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ServiceWorkerUpdateBanner />
      <BackendStatusBanner />
      <OfflineIndicator />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<PageWrapper><Index /></PageWrapper>} />
          <Route path="/z-report" element={<PageWrapper><ZReport /></PageWrapper>} />
          <Route path="/store" element={<PageWrapper><Store /></PageWrapper>} />
          <Route path="/periodic-report" element={<PageWrapper><PeriodicReport /></PageWrapper>} />
          <Route path="/settings" element={<PageWrapper><Settings /></PageWrapper>} />
          <Route path="/data-management" element={<PageWrapper><Index /></PageWrapper>} />
          <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

const App = () => {
  const [showSplash, setShowSplash] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const mountedRef = useRef(true);
  const initTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Preload critical assets and request permissions on mount
  useEffect(() => {
    try {
      preloadCriticalAssets();
    } catch (error) {
      console.warn('Failed to preload assets:', error);
    }
    
    // Request Bluetooth and Camera permissions on app startup
    const requestPermissionsOnStartup = async () => {
      try {
        const permissions = await requestAllPermissions();
        console.log('📱 Permissions requested on startup:', permissions);
      } catch (error) {
        console.warn('Failed to request permissions:', error);
      }
    };
    requestPermissionsOnStartup();
  }, []);

  // Check if splash has been shown in this session with timeout safety
  useEffect(() => {
    mountedRef.current = true;
    
    try {
      const splashShown = sessionStorage.getItem('splashShown');
      if (splashShown) {
        setShowSplash(false);
        setIsReady(true);
      }
    } catch (error) {
      // sessionStorage may fail in some browsers
      console.warn('sessionStorage access failed:', error);
      setShowSplash(false);
      setIsReady(true);
    }
    
    // Safety timeout: if splash doesn't complete in 5 seconds, force proceed
    initTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current && showSplash) {
        console.warn('⚠️ Splash timeout - forcing app load');
        setShowSplash(false);
        setIsReady(true);
        try {
          sessionStorage.setItem('splashShown', 'true');
        } catch (e) {
          // Ignore storage errors
        }
      }
    }, 5000);
    
    return () => {
      mountedRef.current = false;
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
      }
    };
  }, []);

  const handleSplashComplete = useCallback(() => {
    if (!mountedRef.current) return;
    
    try {
      sessionStorage.setItem('splashShown', 'true');
    } catch (error) {
      console.warn('Failed to save splash state:', error);
    }
    
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
    }
    
    setShowSplash(false);
    setIsReady(true);
  }, []);

  // Handle critical errors
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Critical app error:', event.error);
      // Don't set hasError for minor errors that won't crash the app
      if (event.error?.message?.includes('ChunkLoadError') || 
          event.error?.message?.includes('Loading chunk')) {
        // Try to recover from chunk load errors by reloading
        console.log('Chunk load error detected, will reload...');
        setTimeout(() => window.location.reload(), 1000);
      }
    };
    
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-blue-50 p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Something went wrong</h1>
          <p className="text-gray-600 mb-6">The app encountered an error. Please reload.</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg font-semibold"
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }

  if (showSplash) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  if (!isReady) {
    return <PageLoader />;
  }

  return (
    <PersistQueryClientProvider 
      client={queryClient}
      persistOptions={{ 
        persister, 
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        buster: 'v2' // Change this to bust cache
      }}
    >
      <AuthProvider>
        <Toaster />
        <Sonner position="top-center" richColors closeButton />
        <AppContent />
      </AuthProvider>
    </PersistQueryClientProvider>
  );
};

export default App;
