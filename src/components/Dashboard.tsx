import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Info, MoreVertical, Square, BarChart3 } from 'lucide-react';
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
    <div className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-white">
      {/* Member Sync Banner */}
      <MemberSyncBanner 
        isVisible={isSyncingMembers} 
        syncedCount={memberSyncCount} 
      />

      {/* Header - Purple bar with company name */}
      <header className="bg-[#7B68A6] text-white px-4 py-3 flex items-center justify-between" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <h1 className="text-lg font-semibold tracking-wide truncate max-w-[80%]">{companyName}</h1>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors active:bg-white/20 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <MoreVertical className="h-6 w-6" />
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
                  await syncAllData(false, true); // Show member banner on manual sync
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

      {/* Purple Info Section */}
      <div className="bg-[#7B68A6] text-white text-center px-4 py-4">
        <h2 className="text-xl font-bold">{userName}</h2>
        {sessionActive && selectedSession && selectedRoute ? (
          <>
            <div className="flex items-center justify-center gap-2 mt-1">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              <p className="text-sm font-semibold">
                Active {selectedSession.descript?.trim()} Session {selectedRoute.tcode}#{selectedRoute.descript?.trim()}
              </p>
            </div>
            <p className="text-lg font-bold mt-1">{currentDate}</p>
          </>
        ) : (
          <>
            <p className="text-sm mt-1">Welcome</p>
          </>
        )}
        <p className="text-sm mt-1">--</p>
      </div>

      {/* Teal Curved Section with Icons */}
      <div className="relative">
        <div className="bg-[#4DB6AC] pt-6 pb-8 px-4" style={{ borderBottomLeftRadius: '50% 40px', borderBottomRightRadius: '50% 40px' }}>
          {/* Circular Icons Row */}
          <div className="flex justify-center items-end gap-6">
            {/* Store */}
            <button
              onClick={() => navigate('/store')}
              className="flex flex-col items-center active:scale-95 transition-transform"
            >
              <div className="w-20 h-20 rounded-full border-4 border-[#80CBC4] bg-white/20 flex items-center justify-center">
                <Store className="h-10 w-10 text-[#E91E63]" strokeWidth={1.5} />
              </div>
              <span className="mt-2 text-sm font-medium text-gray-800">Store</span>
            </button>

            {/* AI (center, larger) */}
            <button
              onClick={() => toast.info('AI Assistant - Coming Soon')}
              className="flex flex-col items-center active:scale-95 transition-transform -mt-4"
            >
              <div className="w-24 h-24 rounded-full border-4 border-[#80CBC4] bg-white/20 flex items-center justify-center">
                <Square className="h-12 w-12 text-[#E91E63] fill-[#E91E63]" strokeWidth={0} />
              </div>
              <span className="mt-2 text-sm font-medium text-gray-800">AI</span>
            </button>

            {/* About */}
            <button
              onClick={() => toast.info('MADDA SYSTEMS LTD - Milk Collection App v1.5')}
              className="flex flex-col items-center active:scale-95 transition-transform"
            >
              <div className="w-20 h-20 rounded-full border-4 border-[#80CBC4] bg-white/20 flex items-center justify-center">
                <BarChart3 className="h-10 w-10 text-[#E91E63]" strokeWidth={1.5} />
              </div>
              <span className="mt-2 text-sm font-medium text-gray-800">About</span>
            </button>
          </div>
        </div>
      </div>

      {/* White Bottom Section */}
      <div className="flex-1 bg-white px-4 pt-4 flex flex-col overflow-hidden" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {/* Sync Status */}
        <div className="flex justify-center mb-3">
          <p className="text-base font-bold text-gray-900">
            SYNC- {pendingCount > 0 ? `0/${pendingCount}` : '0/0'}
          </p>
        </div>

        {/* Reconnect Button */}
        <div className="flex justify-center mb-3">
          <button
            onClick={handleReconnect}
            disabled={isReconnecting}
            className="px-10 py-3 bg-[#7B68A6] text-white font-semibold rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors disabled:opacity-50 text-base"
          >
            {isReconnecting ? 'RECONNECTING...' : 'RECONNECT'}
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex justify-center gap-8 mb-4">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${printerConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-sm text-gray-700">
              {printerConnected ? 'Initialized' : 'Not Initialized'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${scaleConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-sm text-gray-700">
              {scaleConnected ? 'scale connected' : 'scale disconnected'}
            </span>
          </div>
        </div>

        {/* Session Active View */}
        {sessionActive ? (
          <div className="space-y-4">
            {/* Close Session Button */}
            <div className="flex justify-center">
              <button
                onClick={handleCloseSession}
                className="px-10 py-3 bg-[#7B68A6] text-white font-semibold rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors text-base"
              >
                Close Session
              </button>
            </div>

            {/* Buy/Sell Produce Buttons */}
            <div className="flex justify-center gap-4">
              <button
                onClick={handleBuyProduce}
                className="px-8 py-3 bg-[#7B68A6] text-white font-semibold italic rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors text-base"
              >
                Buy Produce
              </button>
              <button
                onClick={handleSellProduce}
                className="px-8 py-3 bg-[#7B68A6] text-white font-semibold italic rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors text-base"
              >
                Sell Produce
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Route Selector */}
            <div className="max-w-md mx-auto">
              <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
                <RouteSelector
                  selectedRoute={selectedRoute?.tcode || ''}
                  onRouteChange={handleRouteChange}
                  disabled={false}
                />
              </div>
            </div>

            {/* Session Selector */}
            <div className="max-w-md mx-auto">
              <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
                <SessionSelector
                  selectedSession={selectedSession?.descript || ''}
                  onSessionChange={handleSessionChange}
                  disabled={false}
                />
              </div>
            </div>

            {/* New Session Button */}
            <div className="flex justify-center pt-2">
              <button
                onClick={handleNewSession}
                disabled={!selectedRoute || !selectedSession}
                className="px-10 py-3 bg-[#7B68A6] text-white font-semibold rounded-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base"
              >
                NEW SESSION
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
