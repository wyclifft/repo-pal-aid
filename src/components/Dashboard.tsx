import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Info, MoreVertical, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { RouteSelector } from '@/components/RouteSelector';
import { SessionSelector } from '@/components/SessionSelector';
import { type Route, type Session } from '@/services/mysqlApi';
import { useDataSync } from '@/hooks/useDataSync';

interface DashboardProps {
  userName: string;
  companyName: string;
  isOnline: boolean;
  pendingCount: number;
  onStartCollection: (route: Route, session: Session) => void;
  onLogout: () => void;
}

export const Dashboard = ({
  userName,
  companyName,
  isOnline,
  pendingCount,
  onStartCollection,
  onLogout,
}: DashboardProps) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [scaleConnected, setScaleConnected] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const { syncAllData, isSyncing } = useDataSync();

  const handleRouteChange = (route: Route | null) => {
    setSelectedRoute(route);
  };

  const handleSessionChange = (session: Session | null) => {
    setSelectedSession(session);
  };

  const handleNewSession = () => {
    if (selectedRoute && selectedSession) {
      onStartCollection(selectedRoute, selectedSession);
    }
  };

  const handleReconnect = async () => {
    // Attempt to reconnect scale and initialize
    setInitialized(true);
    // Trigger sync
    await syncAllData(false);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-[#7B68A6] text-white px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-wide">{companyName}</h1>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          {menuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setMenuOpen(false)} 
              />
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg z-50 py-1">
                <button
                  onClick={() => {
                    navigate('/settings');
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Settings
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
                    navigate('/periodic-report');
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Periodic Report
                </button>
                <button
                  onClick={() => {
                    navigate('/device-approval');
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100"
                >
                  Device Approval
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
      <main className="flex-1 bg-gradient-to-b from-[#3CB4B4] to-[#E8F4F4] px-4 pt-6 pb-8">
        {/* Welcome Section */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">{userName}</h2>
          <p className="text-lg text-gray-700">Welcome</p>
          <p className="text-gray-600 mt-1">--</p>
          <p className="text-gray-600">--</p>
        </div>

        {/* Circular Icons */}
        <div className="flex justify-center items-center gap-6 mb-6">
          {/* Store */}
          <button
            onClick={() => navigate('/store')}
            className="flex flex-col items-center"
          >
            <div className="w-20 h-20 rounded-full border-2 border-[#3CB4B4] bg-white/50 flex items-center justify-center hover:bg-white/80 transition-colors">
              <Store className="h-10 w-10 text-[#E91E63]" />
            </div>
            <span className="mt-2 text-sm font-medium text-gray-700">Store</span>
          </button>

          {/* AI (Center - larger) */}
          <button
            onClick={handleNewSession}
            disabled={!selectedRoute || !selectedSession}
            className="flex flex-col items-center"
          >
            <div className={`w-24 h-24 rounded-full border-2 border-[#3CB4B4] bg-white/50 flex items-center justify-center transition-colors ${
              selectedRoute && selectedSession ? 'hover:bg-white/80' : 'opacity-60'
            }`}>
              <div className="w-12 h-12 bg-[#E91E63] rounded-sm" />
            </div>
            <span className="mt-2 text-sm font-medium text-gray-700">AI</span>
          </button>

          {/* About */}
          <button
            onClick={() => navigate('/settings')}
            className="flex flex-col items-center"
          >
            <div className="w-20 h-20 rounded-full border-2 border-[#3CB4B4] bg-white/50 flex items-center justify-center hover:bg-white/80 transition-colors">
              <Info className="h-10 w-10 text-[#E91E63]" />
            </div>
            <span className="mt-2 text-sm font-medium text-gray-700">About</span>
          </button>
        </div>

        {/* Sync Status */}
        <div className="text-center mb-4">
          <p className="text-lg font-bold text-gray-800">
            SYNC- {pendingCount > 0 ? `0/${pendingCount}` : '0/0'}
          </p>
        </div>

        {/* Reconnect Button */}
        <div className="flex justify-center mb-4">
          <button
            onClick={handleReconnect}
            disabled={isSyncing}
            className="px-8 py-2 bg-[#7B68A6] text-white font-semibold rounded-md hover:bg-[#6B5996] transition-colors disabled:opacity-50"
          >
            {isSyncing ? 'SYNCING...' : 'RECONNECT'}
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex justify-center gap-8 mb-6">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${initialized ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-700">
              {initialized ? 'Initialized' : 'Not Initialized'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${scaleConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-700">
              {scaleConnected ? 'scale connected' : 'scale disconnected'}
            </span>
          </div>
        </div>

        {/* Route Selector */}
        <div className="max-w-md mx-auto mb-4">
          <div className="bg-white rounded-lg border border-gray-300 overflow-hidden">
            <RouteSelector
              selectedRoute={selectedRoute?.tcode || ''}
              onRouteChange={handleRouteChange}
              disabled={false}
            />
          </div>
        </div>

        {/* Session Selector */}
        <div className="max-w-md mx-auto mb-6">
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
            className="px-8 py-2 bg-[#7B68A6] text-white font-semibold rounded-md hover:bg-[#6B5996] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            NEW SESSION
          </button>
        </div>
      </main>
    </div>
  );
};
