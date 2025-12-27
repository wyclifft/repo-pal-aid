import React, { useState, useEffect, lazy, Suspense, useCallback } from "react";
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
import { preloadCriticalAssets } from "@/utils/precachePages";

// Lazy load route components for better performance
const Index = lazy(() => import("./pages/Index"));
const ZReport = lazy(() => import("./pages/ZReport"));
const Store = lazy(() => import("./pages/Store"));
const PeriodicReport = lazy(() => import("./pages/PeriodicReport"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Configure QueryClient with aggressive caching
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

// Create custom persister using localStorage with compression
const persister = {
  persistClient: async (client: any) => {
    try {
      const serialized = JSON.stringify(client);
      localStorage.setItem('REACT_QUERY_OFFLINE_CACHE', serialized);
    } catch (error) {
      console.warn('Failed to persist query cache:', error);
      // Try to clear old cache if storage is full
      try {
        localStorage.removeItem('REACT_QUERY_OFFLINE_CACHE');
        localStorage.setItem('REACT_QUERY_OFFLINE_CACHE', JSON.stringify(client));
      } catch (e) {
        console.error('Storage quota exceeded');
      }
    }
  },
  restoreClient: async () => {
    try {
      const cached = localStorage.getItem('REACT_QUERY_OFFLINE_CACHE');
      return cached ? JSON.parse(cached) : undefined;
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
  // Initialize global data sync
  useDataSync();
  
  // Listen for app becoming visible to refresh data
  useEffect(() => {
    const handleVisible = () => {
      // Trigger a soft refresh when app becomes visible
      queryClient.invalidateQueries({ refetchType: 'none' });
    };
    
    window.addEventListener('appVisible', handleVisible);
    return () => window.removeEventListener('appVisible', handleVisible);
  }, []);
  
  // Listen for background sync events
  useEffect(() => {
    const handleBackgroundSync = () => {
      console.log('🔄 Background sync triggered');
      queryClient.invalidateQueries();
    };
    
    window.addEventListener('backgroundSync', handleBackgroundSync);
    return () => window.removeEventListener('backgroundSync', handleBackgroundSync);
  }, []);
  
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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

  // Preload critical assets on mount
  useEffect(() => {
    preloadCriticalAssets();
  }, []);

  // Check if splash has been shown in this session
  useEffect(() => {
    const splashShown = sessionStorage.getItem('splashShown');
    if (splashShown) {
      setShowSplash(false);
      setIsReady(true);
    }
  }, []);

  const handleSplashComplete = useCallback(() => {
    sessionStorage.setItem('splashShown', 'true');
    setShowSplash(false);
    setIsReady(true); // Immediately ready - no transition delay
  }, []);

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
        buster: 'v1' // Change this to bust cache
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
