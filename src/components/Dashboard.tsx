import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Info, MoreVertical, Receipt } from 'lucide-react';
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
    // Check if there's a stored printer on mount
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
    // Clear persisted session
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

    // Try to reconnect scale
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

    // Try to reconnect printer
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

  const currentDate = new Date().toISOString().split('T')[0];

  return (
    <div className="h-screen h-[100dvh] flex flex-col overflow-hidden">
      {/* Member Sync Banner */}
      <MemberSyncBanner 
        isVisible={isSyncingMembers} 
        syncedCount={memberSyncCount} 
      />

      {/* Header - with safe area */}
      <header className="bg-[#7B68A6] text-white px-4 py-3 flex items-center justify-between sticky top-0 z-40" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <h1 className="text-base sm:text-lg font-semibold tracking-wide truncate max-w-[70%]">{companyName}</h1>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-3 -m-1 hover:bg-white/10 rounded-full transition-colors active:bg-white/20 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          {menuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setMenuOpen(false)} 
              />
              <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg z-50 py-1 max-h-[70vh] overflow-y-auto">
                <button
                  onClick={() => {
                    navigate('/settings');
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Settings
                </button>
                <hr className="my-1 border-gray-200" />
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    await syncAllData();
                  }}
                  disabled={isSyncing}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {isSyncing ? 'Syncing...' : 'Sync Data'}
                </button>
                <button
                  onClick={() => {
                    navigate('/z-report');
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Z Report
                </button>
                <button
                  onClick={() => {
                    navigate('/z-report?generate=true');
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Generate Z Report
                </button>
                <button
                  onClick={() => {
                    navigate('/z-report?reprint=true');
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Reprint Z Report
                </button>
                <hr className="my-1 border-gray-200" />
                <button
                  onClick={() => {
                    navigate('/periodic-report');
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Periodic Report
                </button>
                <button
                  onClick={() => {
                    navigate('/periodic-report?sync=true');
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Sync Periodic Report
                </button>
                <hr className="my-1 border-gray-200" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenRecentReceipts?.();
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Recent Receipts
                </button>
                <hr className="my-1 border-gray-200" />
                <button
                  onClick={() => {
                    onLogout();
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50"
                >
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 bg-gradient-to-b from-[#3CB4B4] to-[#E8F4F4] px-4 pt-3 pb-4 overflow-hidden flex flex-col" style={{ paddingBottom: 'max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem))' }}>
        {/* Welcome Section */}
        <div className="text-center mb-2 flex-shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-gray-800 truncate px-2">{userName}</h2>
          {sessionActive && selectedSession && selectedRoute ? (
            <>
              <div className="flex items-center justify-center gap-2 flex-wrap px-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <p className="text-xs sm:text-sm font-semibold text-gray-800 break-words">
                  Active {selectedSession.descript?.trim()} Session {selectedRoute.tcode}#{selectedRoute.descript?.trim()}
                </p>
              </div>
              <p className="text-sm sm:text-base font-bold text-gray-800">{currentDate}</p>
            </>
          ) : (
            <>
              <p className="text-sm sm:text-base text-gray-700">Welcome</p>
              <p className="text-gray-600 text-sm">--</p>
            </>
          )}
        </div>

        {/* Circular Icons */}
        <div className="flex justify-center items-center gap-3 mb-2 flex-shrink-0">
          {/* Store */}
          <button
            onClick={() => navigate('/store')}
            className="flex flex-col items-center active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 border-[#3CB4B4] bg-white/50 flex items-center justify-center hover:bg-white/80 active:bg-white/90 transition-colors">
              <Store className="h-5 w-5 sm:h-6 sm:w-6 text-[#E91E63]" />
            </div>
            <span className="mt-0.5 text-xs font-medium text-gray-700">Store</span>
          </button>

          {/* Recent Receipts */}
          <button
            onClick={() => onOpenRecentReceipts?.()}
            className="flex flex-col items-center active:scale-95 transition-transform"
          >
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-[#3CB4B4] bg-white/50 flex items-center justify-center hover:bg-white/80 active:bg-white/90 transition-colors">
              <Receipt className="h-6 w-6 sm:h-8 sm:w-8 text-[#E91E63]" />
            </div>
            <span className="mt-0.5 text-xs font-medium text-gray-700">Receipts</span>
          </button>

          {/* About */}
          <button
            onClick={() => toast.info('MADDA SYSTEMS LTD - Milk Collection App v1.5')}
            className="flex flex-col items-center active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 border-[#3CB4B4] bg-white/50 flex items-center justify-center hover:bg-white/80 active:bg-white/90 transition-colors">
              <Info className="h-5 w-5 sm:h-6 sm:w-6 text-[#E91E63]" />
            </div>
            <span className="mt-0.5 text-xs font-medium text-gray-700">About</span>
          </button>
        </div>

        {/* Sync Status & Reconnect Row */}
        <div className="flex justify-center items-center gap-4 mb-2 flex-shrink-0">
          <p className="text-sm font-bold text-gray-800">
            SYNC- {pendingCount > 0 ? `0/${pendingCount}` : '0/0'}
          </p>
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="px-4 py-2 bg-[#7B68A6] text-white font-semibold rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors disabled:opacity-50 min-h-[40px] text-xs sm:text-sm"
          >
            {isReconnecting ? 'RECONNECTING...' : 'RECONNECT'}
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex justify-center gap-4 mb-2 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${scaleConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-700">
              {scaleConnected ? 'Scale' : 'No Scale'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${printerConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-700">
              {printerConnected ? 'Printer' : 'No Printer'}
            </span>
          </div>
        </div>

        {/* Session Active View */}
        {sessionActive ? (
          <div className="max-w-md mx-auto space-y-3 px-2 flex-shrink-0">
            {/* Close Session Button */}
            <div className="flex justify-center">
              <button
                onClick={handleCloseSession}
                className="px-5 py-2.5 bg-[#7B68A6] text-white font-semibold rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors min-h-[44px] text-sm"
              >
                Close Session
              </button>
            </div>

            {/* Buy/Sell Produce Buttons */}
            <div className="flex justify-center gap-3">
              <button
                onClick={handleBuyProduce}
                className="flex-1 max-w-[140px] py-2.5 bg-[#7B68A6] text-white font-semibold rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors min-h-[44px] text-sm"
              >
                Buy Produce
              </button>
              <button
                onClick={handleSellProduce}
                className="flex-1 max-w-[140px] py-2.5 bg-[#7B68A6] text-white font-semibold rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors min-h-[44px] text-sm"
              >
                Sell Produce
              </button>
            </div>
          </div>
        ) : (
          <div className="px-2 flex-shrink-0">
            {/* Route Selector */}
            <div className="max-w-md mx-auto mb-2">
              <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
                <RouteSelector
                  selectedRoute={selectedRoute?.tcode || ''}
                  onRouteChange={handleRouteChange}
                  disabled={false}
                />
              </div>
            </div>

            {/* Session Selector */}
            <div className="max-w-md mx-auto mb-3">
              <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
                <SessionSelector
                  selectedSession={selectedSession?.descript || ''}
                  onSessionChange={handleSessionChange}
                  disabled={false}
                />
              </div>
            </div>

            {/* New Session Button */}
            <div className="flex justify-center">
              <button
                onClick={handleNewSession}
                disabled={!selectedRoute || !selectedSession}
                className="px-5 py-2.5 bg-[#7B68A6] text-white font-semibold rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] text-sm"
              >
                NEW SESSION
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
