import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Info, MoreVertical, Cpu, BarChart3 } from 'lucide-react';
import { RouteSelector } from '@/components/RouteSelector';
import { SessionSelector } from '@/components/SessionSelector';
import { MemberSyncBanner } from '@/components/MemberSyncBanner';

import { type Route, type Session } from '@/services/mysqlApi';
import { useDataSync } from '@/hooks/useDataSync';
import { 
  quickReconnect, 
  quickReconnectPrinter, 
  getStoredDeviceInfo, 
  getStoredPrinterInfo,
  type ScaleType 
} from '@/services/bluetooth';
import { toast } from 'sonner';

// Session persistence keys
const SESSION_STORAGE_KEY = 'active_session_data';

interface DashboardProps {
  userName: string;
  companyName: string;
  isOnline: boolean;
  pendingCount: number;
  onStartCollection: (route: Route, session: Session) => void;
  onStartSelling: (route: Route, session: Session) => void;
  onLogout: () => void;
  onOpenRecentReceipts?: () => void;
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
}: DashboardProps) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  
  // Restore session state from localStorage on mount
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        return data.route || null;
      }
    } catch (e) { console.error('Failed to restore route:', e); }
    return null;
  });
  
  const [selectedSession, setSelectedSession] = useState<Session | null>(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        return data.session || null;
      }
    } catch (e) { console.error('Failed to restore session:', e); }
    return null;
  });
  
  const [sessionActive, setSessionActive] = useState(() => {
    try {
      const saved = localStorage.getItem(SESSION_STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        return data.active === true;
      }
    } catch (e) { console.error('Failed to restore session active state:', e); }
    return false;
  });
  
  const [scaleConnected, setScaleConnected] = useState(false);
  const [printerConnected, setPrinterConnected] = useState(() => {
    const stored = getStoredPrinterInfo();
    return !!stored;
  });
  const [isReconnecting, setIsReconnecting] = useState(false);
  const { syncAllData, isSyncing, isSyncingMembers, memberSyncCount } = useDataSync();

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

  const handleCloseSession = () => {
    setSessionActive(false);
    setSelectedRoute(null);
    setSelectedSession(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  };

  const handleBuyProduce = () => {
    if (selectedRoute && selectedSession) {
      onStartCollection(selectedRoute, selectedSession);
    }
  };

  const handleSellProduce = () => {
    if (selectedRoute && selectedSession) {
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

  const currentDate = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  return (
    <div className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-white">
      {/* Member Sync Banner */}
      <MemberSyncBanner 
        isVisible={isSyncingMembers} 
        syncedCount={memberSyncCount} 
      />

      {/* ============ TOP SECTION - TEAL/BLUE CONTEXTUAL INFO ============ */}
      <div className="bg-[#26A69A] flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3 py-2">
          <h1 className="text-white text-base font-bold tracking-wide truncate max-w-[75%]">
            {companyName}
          </h1>
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1.5 hover:bg-white/10 rounded-full transition-colors active:bg-white/20 min-w-[40px] min-h-[40px] flex items-center justify-center"
            >
              <MoreVertical className="h-5 w-5 text-white" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-xl z-50 py-1 max-h-[70vh] overflow-y-auto">
                  <button onClick={() => { navigate('/settings'); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Settings</button>
                  <hr className="my-0.5 border-gray-200" />
                  <button onClick={async () => { setMenuOpen(false); await syncAllData(false, true); }} disabled={isSyncing} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50">{isSyncing ? 'Syncing...' : 'Sync Data'}</button>
                  <button onClick={() => { navigate('/z-report'); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Z Report</button>
                  <button onClick={() => { navigate('/z-report?generate=true'); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Generate Z Report</button>
                  <button onClick={() => { navigate('/z-report?reprint=true'); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Reprint Z Report</button>
                  <hr className="my-0.5 border-gray-200" />
                  <button onClick={() => { navigate('/periodic-report'); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Periodic Report</button>
                  <button onClick={() => { navigate('/periodic-report?sync=true'); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Sync Periodic Report</button>
                  <hr className="my-0.5 border-gray-200" />
                  <button onClick={() => { setMenuOpen(false); onOpenRecentReceipts?.(); }} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Recent Receipts</button>
                  <hr className="my-0.5 border-gray-200" />
                  <button onClick={() => { onLogout(); setMenuOpen(false); }} className="w-full text-left px-3 py-2.5 text-sm text-red-600 hover:bg-red-50">Logout</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* User Info & Session Status */}
        <div className="text-center px-3 pb-1">
          <h2 className="text-white text-xl font-bold">{userName}</h2>
          {sessionActive && selectedSession && selectedRoute ? (
            <div className="mt-1">
              <div className="inline-flex items-center gap-1.5 bg-white/15 px-3 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-medium">
                  Active {selectedSession.descript?.trim()} • {selectedRoute.descript?.trim()}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-white/80 text-xs mt-0.5">Welcome back</p>
          )}
        </div>

        {/* Date Display */}
        <div className="text-center py-1.5">
          <span className="text-white text-sm font-semibold">{currentDate}</span>
        </div>

        {/* Quick Action Icons */}
        <div className="flex justify-center gap-6 pb-3">
          <button onClick={() => navigate('/store')} className="flex flex-col items-center active:scale-95 transition-transform">
            <div className="w-14 h-14 rounded-full bg-teal-100/80 border-2 border-teal-200 flex items-center justify-center shadow-sm">
              <Store className="h-7 w-7" style={{ color: '#D81B60' }} strokeWidth={1.5} />
            </div>
            <span className="mt-1 text-xs font-medium text-gray-700">Store</span>
          </button>

          <button onClick={() => toast.info('AI Assistant - Coming Soon')} className="flex flex-col items-center active:scale-95 transition-transform">
            <div className="w-12 h-12 rounded-full bg-teal-100/80 border-2 border-teal-200 flex items-center justify-center shadow-sm">
              <div className="w-5 h-5 rounded-sm" style={{ backgroundColor: '#D81B60' }} />
            </div>
            <span className="mt-1 text-xs font-medium text-gray-700">AI</span>
          </button>

          <button onClick={() => toast.info('MADDA SYSTEMS LTD - Milk Collection App v1.5')} className="flex flex-col items-center active:scale-95 transition-transform">
            <div className="w-14 h-14 rounded-full bg-teal-100/80 border-2 border-teal-200 flex items-center justify-center shadow-sm">
              <BarChart3 className="h-7 w-7" style={{ color: '#D81B60' }} strokeWidth={1.5} />
            </div>
            <span className="mt-1 text-xs font-medium text-gray-700">About</span>
          </button>
        </div>
      </div>

      {/* ============ CURVED DIVIDER ============ */}
      <div className="relative h-5 flex-shrink-0">
        <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          <path d="M0,0 L0,8 Q50,20 100,8 L100,0 Z" fill="#26A69A" />
        </svg>
      </div>

      {/* ============ BOTTOM SECTION - WHITE ACTION AREA ============ */}
      <div className="flex-1 bg-white flex flex-col px-3 min-h-0" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        
        {/* Sync Status */}
        <div className="text-center py-2">
          <span className="text-gray-800 font-bold text-sm tracking-wide">
            SYNC- {pendingCount > 0 ? `0/${pendingCount}` : '0/0'}
          </span>
        </div>

        {/* Reconnect Button */}
        <div className="flex justify-center mb-2">
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="px-8 py-2 bg-[#7E57C2] text-white font-bold rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors disabled:opacity-50 text-sm shadow-md"
          >
            {isReconnecting ? 'RECONNECTING...' : 'RECONNECT'}
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex justify-center gap-6 mb-2">
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${printerConnected ? 'bg-green-500' : 'bg-red-500'} animate-[blink_1.5s_ease-in-out_infinite]`} />
            <span className="text-xs text-gray-600">{printerConnected ? 'Initialized' : 'Not Initialized'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${scaleConnected ? 'bg-green-500' : 'bg-red-500'} animate-[blink_1.5s_ease-in-out_infinite]`} />
            <span className="text-xs text-gray-600">{scaleConnected ? 'Scale connected' : 'Scale disconnected'}</span>
          </div>
        </div>

        {/* Dynamic Content Area */}
        <div className="flex-1 flex flex-col justify-center min-h-0">
          {sessionActive ? (
            <div className="space-y-3">
              {/* Close Session */}
              <div className="flex justify-center">
                <button
                  onClick={handleCloseSession}
                  className="px-8 py-2 bg-[#7E57C2] text-white font-bold rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors text-sm shadow-md"
                >
                  Close Session
                </button>
              </div>

              {/* Buy/Sell Buttons */}
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleBuyProduce}
                  className="flex-1 max-w-[140px] py-2.5 bg-[#7E57C2] text-white font-bold italic rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors text-sm shadow-md"
                >
                  Buy Produce
                </button>
                <button
                  onClick={handleSellProduce}
                  className="flex-1 max-w-[140px] py-2.5 bg-[#7E57C2] text-white font-bold italic rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors text-sm shadow-md"
                >
                  Sell Produce
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 max-w-xs mx-auto w-full">
              {/* Route Selector */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                <RouteSelector
                  selectedRoute={selectedRoute?.tcode || ''}
                  onRouteChange={handleRouteChange}
                  disabled={false}
                />
              </div>

              {/* Session Selector */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                <SessionSelector
                  selectedSession={selectedSession?.descript || ''}
                  onSessionChange={handleSessionChange}
                  disabled={false}
                />
              </div>

              {/* New Session Button */}
              <div className="flex justify-center pt-1">
                <button
                  onClick={handleNewSession}
                  disabled={!selectedRoute || !selectedSession}
                  className="px-8 py-2 bg-[#7E57C2] text-white font-bold rounded-lg hover:bg-[#6D47B1] active:bg-[#5C37A0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm shadow-md"
                >
                  NEW SESSION
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
