import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Info, MoreVertical, Cpu, BarChart3, AlertTriangle, Loader2 } from 'lucide-react';
import { RouteSelector } from '@/components/RouteSelector';
import { SessionSelector } from '@/components/SessionSelector';
import { MemberSyncBanner } from '@/components/MemberSyncBanner';

import { type Route, type Session } from '@/services/mysqlApi';
import { useDataSync } from '@/hooks/useDataSync';
import { useSessionClose } from '@/hooks/useSessionClose';
import { useAppSettings } from '@/hooks/useAppSettings';
import { 
  quickReconnect, 
  quickReconnectPrinter, 
  getStoredDeviceInfo, 
  getStoredPrinterInfo,
  isScaleConnected,
  isPrinterConnected,
  type ScaleType 
} from '@/services/bluetooth';
import { toast } from 'sonner';

// Session persistence keys
const SESSION_STORAGE_KEY = 'active_session_data';

// Read session data once at module level to avoid re-reads
const getInitialSessionData = () => {
  try {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) { 
    console.error('Failed to restore session:', e); 
  }
  return null;
};

interface DashboardProps {
  userName: string;
  companyName: string;
  isOnline: boolean;
  pendingCount: number;
  onStartCollection: (route: Route, session: Session) => void;
  onStartSelling: (route: Route, session: Session) => void;
  onLogout: () => void;
  onOpenRecentReceipts?: () => void;
  allowZReport?: boolean; // From supervisor mode - controls Z report visibility
}

export const Dashboard = ({
  userName,
  companyName,
  isOnline,
  pendingCount,
  onStartCollection,
  onStartSelling,
  onLogout,
  onOpenRecentReceipts,
  allowZReport = true,
}: DashboardProps) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const initialDataRef = useRef(getInitialSessionData());
  
  // Restore session state from localStorage on mount (read once)
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(() => {
    return initialDataRef.current?.route || null;
  });
  
  const [selectedSession, setSelectedSession] = useState<Session | null>(() => {
    return initialDataRef.current?.session || null;
  });
  
  const [sessionActive, setSessionActive] = useState(() => {
    return initialDataRef.current?.active === true;
  });
  
  // Initialize connection status from actual bluetooth state
  const [scaleConnected, setScaleConnected] = useState(() => isScaleConnected());
  const [printerConnected, setPrinterConnected] = useState(() => isPrinterConnected());
  const [isReconnecting, setIsReconnecting] = useState(false);
  const { syncAllData, isSyncing, isSyncingMembers, memberSyncCount } = useDataSync();
  const { sessionPrintOnly, periodLabel } = useAppSettings();
  
  // Listen for connection state changes from Settings or other components
  useEffect(() => {
    const handleScaleChange = (e: CustomEvent<{ connected: boolean }>) => {
      setScaleConnected(e.detail.connected);
    };
    const handlePrinterChange = (e: CustomEvent<{ connected: boolean }>) => {
      setPrinterConnected(e.detail.connected);
    };
    
    window.addEventListener('scaleConnectionChange', handleScaleChange as EventListener);
    window.addEventListener('printerConnectionChange', handlePrinterChange as EventListener);
    
    return () => {
      window.removeEventListener('scaleConnectionChange', handleScaleChange as EventListener);
      window.removeEventListener('printerConnectionChange', handlePrinterChange as EventListener);
    };
  }, []);
  
  // Session close handler that respects sessPrint setting
  const handleSessionCloseSuccess = useCallback(() => {
    setSessionActive(false);
    setSelectedRoute(null);
    setSelectedSession(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);
  
  const {
    canClose,
    isClosing,
    isSyncingForClose,
    pendingSyncCount: sessionPendingCount,
    isSyncComplete,
    closeButtonLabel,
    closeSession,
    confirmZReportPrinted,
    cancelZReportModal
  } = useSessionClose(handleSessionCloseSuccess);

  // Listen for session close events from Z-report page
  useEffect(() => {
    const handleSessionCloseComplete = () => {
      console.log('📝 Session close complete event received');
      handleSessionCloseSuccess();
    };
    
    const handleSessionCloseCancelled = () => {
      console.log('📝 Session close cancelled event received');
      cancelZReportModal();
    };
    
    window.addEventListener('sessionCloseComplete', handleSessionCloseComplete);
    window.addEventListener('sessionCloseCancelled', handleSessionCloseCancelled);
    
    return () => {
      window.removeEventListener('sessionCloseComplete', handleSessionCloseComplete);
      window.removeEventListener('sessionCloseCancelled', handleSessionCloseCancelled);
    };
  }, [handleSessionCloseSuccess, cancelZReportModal]);

  // Memoize date to prevent recalculation on every render
  const currentDate = useMemo(() => {
    return new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }, []);

  // Persist session state to localStorage whenever it changes
  useEffect(() => {
    const sessionData = {
      route: selectedRoute,
      session: selectedSession,
      active: sessionActive,
      timestamp: Date.now()
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
  }, [selectedRoute, selectedSession, sessionActive]);

  const handleRouteChange = (route: Route | null) => {
    setSelectedRoute(route);
  };

  const handleSessionChange = (session: Session | null) => {
    setSelectedSession(session);
  };

  const handleNewSession = () => {
    if (selectedRoute && selectedSession) {
      setSessionActive(true);
    }
  };

  // Legacy handler removed - now using useSessionClose hook
  const handleCloseSession = () => {
    closeSession();
  };

  const handleBuyProduce = () => {
    if (selectedRoute && selectedSession) {
      // Check clientFetch permissions
      if (selectedRoute.allowBuy === false) {
        toast.error('Buy Produce is not enabled for this route');
        return;
      }
      onStartCollection(selectedRoute, selectedSession);
    }
  };

  const handleSellProduce = () => {
    if (selectedRoute && selectedSession) {
      // Check clientFetch permissions
      if (selectedRoute.allowSell === false) {
        toast.error('Sell Produce is not enabled for this route');
        return;
      }
      onStartSelling(selectedRoute, selectedSession);
    }
  };

  const handleReconnect = async () => {
    setIsReconnecting(true);
    let scaleSuccess = false;
    let printerSuccess = false;

    const storedScale = getStoredDeviceInfo();
    if (storedScale) {
      const scaleResult = await quickReconnect(storedScale.deviceId, (weight: number, type: ScaleType) => {
        console.log(`Scale weight: ${weight} kg (${type})`);
      });
      scaleSuccess = scaleResult.success;
      setScaleConnected(scaleResult.success);
      if (scaleResult.success) {
        toast.success(`Scale connected: ${storedScale.deviceName}`);
      } else {
        toast.error(`Scale reconnect failed: ${scaleResult.error}`);
      }
    } else {
      toast.info('No previously connected scale found');
    }

    const storedPrinter = getStoredPrinterInfo();
    if (storedPrinter) {
      const printerResult = await quickReconnectPrinter(storedPrinter.deviceId);
      printerSuccess = printerResult.success;
      setPrinterConnected(printerResult.success);
      if (printerResult.success) {
        toast.success(`Printer connected: ${storedPrinter.deviceName}`);
      } else {
        toast.error(`Printer reconnect failed: ${printerResult.error}`);
      }
    } else {
      toast.info('No previously connected printer found');
    }

    setIsReconnecting(false);
  };


  return (
    <div className="h-screen h-[100dvh] flex flex-col overflow-y-auto overflow-x-hidden bg-white">
      {/* Member Sync Banner */}
      <MemberSyncBanner 
        isVisible={isSyncingMembers} 
        syncedCount={memberSyncCount} 
      />
      
      {/* Session Close Sync Banner */}
      <MemberSyncBanner 
        isVisible={isSyncingForClose} 
        syncedCount={sessionPendingCount}
        message="Syncing Transactions..."
      />

      {/* ============ TOP SECTION - TEAL/BLUE CONTEXTUAL INFO ============ */}
      <div className="bg-[#26A69A] flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3 py-2">
          <h1 className="text-white font-bold tracking-wide truncate max-w-[75%]" style={{ fontSize: 'clamp(0.875rem, 4vw, 1.125rem)' }}>
            {companyName}
          </h1>
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 hover:bg-white/10 rounded-full transition-colors active:bg-white/20 min-w-[2.75rem] min-h-[2.75rem] flex items-center justify-center"
            >
              <MoreVertical className="h-5 w-5 text-white flex-shrink-0" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-xl z-50 py-1 max-h-[70vh] overflow-y-auto">
                  <button onClick={() => { navigate('/settings'); setMenuOpen(false); }} className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100">Settings</button>
                  <hr className="my-0.5 border-gray-200" />
                  <button onClick={async () => { setMenuOpen(false); await syncAllData(false, true); }} disabled={isSyncing} className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100 disabled:opacity-50">{isSyncing ? 'Syncing...' : 'Sync Data'}</button>
                  {allowZReport && (
                    <>
                      <button onClick={() => { navigate('/z-report'); setMenuOpen(false); }} className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100">Z Report</button>
                      <button onClick={() => { navigate('/z-report?generate=true'); setMenuOpen(false); }} className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100">Generate Z Report</button>
                      <button onClick={() => { navigate('/z-report?reprint=true'); setMenuOpen(false); }} className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100">Reprint Z Report</button>
                    </>
                  )}
                  <hr className="my-0.5 border-gray-200" />
                  <button onClick={() => { navigate('/periodic-report'); setMenuOpen(false); }} className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100">Periodic Report</button>
                  <button onClick={() => { navigate('/periodic-report?sync=true'); setMenuOpen(false); }} className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100">Sync Periodic Report</button>
                  <hr className="my-0.5 border-gray-200" />
                  <button onClick={() => { setMenuOpen(false); onOpenRecentReceipts?.(); }} className="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100">Recent Receipts</button>
                  <hr className="my-0.5 border-gray-200" />
                  <button onClick={() => { onLogout(); setMenuOpen(false); }} className="w-full text-left px-4 py-3 text-red-600 hover:bg-red-50">Logout</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* User Info & Session Status */}
        <div className="text-center px-3 pb-1">
          <h2 className="text-white font-bold" style={{ fontSize: 'clamp(1.125rem, 5vw, 1.5rem)' }}>{userName}</h2>
          {sessionActive && selectedSession && selectedRoute ? (
            <div className="mt-1">
              <div className="inline-flex items-center gap-1.5 bg-white/15 px-3 py-1.5 rounded-full flex-wrap justify-center">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                <span className="text-white font-medium" style={{ fontSize: 'clamp(0.625rem, 2.5vw, 0.875rem)' }}>
                  Active {selectedSession.descript?.trim()} • {selectedRoute.descript?.trim()}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-white/80 mt-0.5" style={{ fontSize: 'clamp(0.625rem, 2.5vw, 0.875rem)' }}>Welcome back</p>
          )}
        </div>

        {/* Date Display */}
        <div className="text-center py-1.5">
          <span className="text-white font-semibold" style={{ fontSize: 'clamp(0.75rem, 3vw, 1rem)' }}>{currentDate}</span>
        </div>

        {/* Quick Action Icons */}
        <div className="flex justify-center gap-4 pb-3 flex-wrap px-2">
          <button 
            onClick={() => {
              // Only allow Store navigation when a route is selected
              if (!selectedRoute) {
                toast.error('Please select a route first');
                return;
              }
              // Check if Store is allowed based on selected route's clientFetch
              if (selectedRoute.allowStore === false) {
                toast.error('Store is not enabled for this route');
                return;
              }
              navigate('/store');
            }} 
            className={`flex flex-col items-center active:scale-95 transition-transform ${
              !selectedRoute || selectedRoute.allowStore === false ? 'opacity-50' : ''
            }`}
          >
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-teal-100/80 border-2 border-teal-200 flex items-center justify-center shadow-sm flex-shrink-0">
              <Store className="h-6 w-6 sm:h-7 sm:w-7 flex-shrink-0" style={{ color: '#D81B60' }} strokeWidth={1.5} />
            </div>
            <span className="mt-1 font-medium text-gray-700" style={{ fontSize: 'clamp(0.625rem, 2.5vw, 0.75rem)' }}>Store</span>
          </button>

          <button 
            onClick={() => {
              // Only allow AI navigation when a route is selected
              if (!selectedRoute) {
                toast.error('Please select a route first');
                return;
              }
              toast.info('AI Assistant - Coming Soon');
            }} 
            className={`flex flex-col items-center active:scale-95 transition-transform ${!selectedRoute ? 'opacity-50' : ''}`}
          >
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-teal-100/80 border-2 border-teal-200 flex items-center justify-center shadow-sm flex-shrink-0">
              <div className="w-4 h-4 sm:w-5 sm:h-5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#D81B60' }} />
            </div>
            <span className="mt-1 font-medium text-gray-700" style={{ fontSize: 'clamp(0.625rem, 2.5vw, 0.75rem)' }}>AI</span>
          </button>

          <button onClick={() => toast.info('MADDA SYSTEMS LTD - Milk Collection App v1.5')} className="flex flex-col items-center active:scale-95 transition-transform">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-teal-100/80 border-2 border-teal-200 flex items-center justify-center shadow-sm flex-shrink-0">
              <BarChart3 className="h-6 w-6 sm:h-7 sm:w-7 flex-shrink-0" style={{ color: '#D81B60' }} strokeWidth={1.5} />
            </div>
            <span className="mt-1 font-medium text-gray-700" style={{ fontSize: 'clamp(0.625rem, 2.5vw, 0.75rem)' }}>About</span>
          </button>
        </div>
      </div>

      {/* ============ CURVED DIVIDER ============ */}
      <div className="relative h-4 flex-shrink-0">
        <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          <path d="M0,0 L0,8 Q50,20 100,8 L100,0 Z" fill="#26A69A" />
        </svg>
      </div>

      {/* ============ BOTTOM SECTION - WHITE ACTION AREA ============ */}
      <div className="flex-1 bg-white flex flex-col px-3 py-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        
        {/* Sync Status */}
        <div className="text-center py-1.5">
          <span className="text-gray-800 font-bold tracking-wide" style={{ fontSize: 'clamp(0.75rem, 3vw, 0.875rem)' }}>
            SYNC- {pendingCount > 0 ? `0/${pendingCount}` : '0/0'}
          </span>
        </div>

        {/* Reconnect Button */}
        <div className="flex justify-center mb-2">
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="px-6 py-2.5 bg-[#7E57C2] text-white font-bold rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors disabled:opacity-50 shadow-md min-h-[2.75rem]"
            style={{ fontSize: 'clamp(0.75rem, 3vw, 0.875rem)' }}
          >
            {isReconnecting ? 'RECONNECTING...' : 'RECONNECT'}
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex justify-center gap-4 mb-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${printerConnected ? 'bg-green-500' : 'bg-red-500'} animate-[blink_1.5s_ease-in-out_infinite]`} />
            <span className="text-gray-600" style={{ fontSize: 'clamp(0.625rem, 2.5vw, 0.75rem)' }}>{printerConnected ? 'Printer connected' : 'Printer disconnected'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${scaleConnected ? 'bg-green-500' : 'bg-red-500'} animate-[blink_1.5s_ease-in-out_infinite]`} />
            <span className="text-gray-600" style={{ fontSize: 'clamp(0.625rem, 2.5vw, 0.75rem)' }}>{scaleConnected ? 'Scale connected' : 'Scale disconnected'}</span>
          </div>
        </div>

        {/* Dynamic Content Area */}
        <div className="flex-1 flex flex-col justify-center">
          {sessionActive ? (
            <div className="space-y-3">
              {/* Sync Warning Banner when sessPrint=1 and sync incomplete */}
              {sessionPrintOnly && !isSyncComplete && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-amber-800 font-semibold text-sm">Sync Required</p>
                    <p className="text-amber-700 text-xs">
                      {sessionPendingCount} transaction{sessionPendingCount !== 1 ? 's' : ''} pending sync. 
                      Session close will sync and print Z-report.
                    </p>
                  </div>
                </div>
              )}
              
              {/* Close Session */}
              <div className="flex justify-center">
                <button
                  onClick={handleCloseSession}
                  disabled={!canClose}
                  className="px-6 py-2.5 bg-[#7E57C2] text-white font-bold rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors shadow-md min-h-[2.75rem] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  style={{ fontSize: 'clamp(0.75rem, 3vw, 0.875rem)' }}
                >
                  {(isClosing || isSyncing) && (
                    <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                  )}
                  {closeButtonLabel}
                </button>
              </div>

              {/* Buy/Sell Buttons */}
              <div className="flex justify-center gap-3 flex-wrap">
                <button
                  onClick={handleBuyProduce}
                  disabled={selectedRoute?.allowBuy === false}
                  className={`flex-1 max-w-[10rem] py-2.5 bg-[#7E57C2] text-white font-bold italic rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors shadow-md min-h-[2.75rem] disabled:opacity-50 disabled:cursor-not-allowed`}
                  style={{ fontSize: 'clamp(0.75rem, 3vw, 0.875rem)' }}
                >
                  Buy Produce
                </button>
                <button
                  onClick={handleSellProduce}
                  disabled={selectedRoute?.allowSell === false}
                  className={`flex-1 max-w-[10rem] py-2.5 bg-[#7E57C2] text-white font-bold italic rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors shadow-md min-h-[2.75rem] disabled:opacity-50 disabled:cursor-not-allowed`}
                  style={{ fontSize: 'clamp(0.75rem, 3vw, 0.875rem)' }}
                >
                  Sell Produce
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 max-w-sm mx-auto w-full">
              {/* Route Selector */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden min-h-[2.75rem]">
                <RouteSelector
                  selectedRoute={selectedRoute?.tcode || ''}
                  onRouteChange={handleRouteChange}
                  disabled={false}
                />
              </div>

              {/* Session Selector */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden min-h-[2.75rem]">
                <SessionSelector
                  selectedSession={selectedSession?.descript || ''}
                  onSessionChange={handleSessionChange}
                  disabled={false}
                  periodLabel={periodLabel}
                />
              </div>

              {/* New Session Button */}
              <div className="flex justify-center pt-1">
                <button
                  onClick={handleNewSession}
                  disabled={!selectedRoute || !selectedSession}
                  className="px-6 py-2.5 bg-[#7E57C2] text-white font-bold rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md min-h-[2.75rem]"
                  style={{ fontSize: 'clamp(0.75rem, 3vw, 0.875rem)' }}
                >
                  NEW {periodLabel.toUpperCase()}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
