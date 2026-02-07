import { useState, useEffect, useCallback, useRef } from 'react';
import { mysqlApi, type Session, type SessionsResponse } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { Clock, AlertCircle, CheckCircle, Calendar } from 'lucide-react';

interface SessionSelectorProps {
  selectedSession: string;
  onSessionChange: (session: Session | null) => void;
  disabled?: boolean;
  periodLabel?: string; // Fallback only - prefer backend value
}

export const SessionSelector = ({ 
  selectedSession, 
  onSessionChange, 
  disabled = false,
  periodLabel: propPeriodLabel = 'Session'
}: SessionSelectorProps) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [periodLabel, setPeriodLabel] = useState(propPeriodLabel);
  const [orgtype, setOrgtype] = useState<string>('D');
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const { saveSessions, getSessions, isReady } = useIndexedDB();
  const { isOnline } = useOfflineStatus();
  
  // Track if we've already loaded data to prevent flickering
  const hasLoadedRef = useRef(false);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Convert time_from/time_to to integer hour
  const toHour = (value: any): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  // Check if a session/season is enabled based on date range (current date within range)
  // Uses backend-provided dateEnabled flag for accurate validation
  const isDateEnabled = useCallback((session: Session): boolean => {
    // Backend provides dateEnabled flag - use it directly (most reliable)
    if (session.dateEnabled !== undefined) {
      return session.dateEnabled;
    }
    
    // Fallback: If no date fields, assume enabled (regular sessions)
    if (!session.datefrom || !session.dateto) {
      return true;
    }
    
    // Manual date check as fallback for seasons
    const today = new Date().toISOString().split('T')[0];
    return today >= session.datefrom && today <= session.dateto;
  }, []);

  // Check if a session/season is a PAST season (date range has ended)
  // Past seasons should be selectable for historical data entry
  const isPastSeason = useCallback((session: Session): boolean => {
    // No date fields = regular session, not a past season
    if (!session.datefrom || !session.dateto) {
      return false;
    }
    
    const today = new Date().toISOString().split('T')[0];
    return session.dateto < today;
  }, []);

  // Check if a session/season is a FUTURE season (hasn't started yet)
  // Future seasons should be disabled
  const isFutureSeason = useCallback((session: Session): boolean => {
    // No date fields = regular session, not a future season
    if (!session.datefrom || !session.dateto) {
      return false;
    }
    
    const today = new Date().toISOString().split('T')[0];
    return session.datefrom > today;
  }, []);

  // Check if a session is active based on current hour AND date range
  const isSessionActive = useCallback((session: Session): boolean => {
    // First check date range (for seasons with datefrom/dateto)
    if (!isDateEnabled(session)) {
      return false;
    }
    
    const timeFrom = toHour(session.time_from);
    const timeTo = toHour(session.time_to);
    
    if (timeFrom === null || timeTo === null) {
      console.log('Session time validation failed:', { timeFrom, timeTo, session });
      return false;
    }
    
    const currentHour = currentTime.getHours();
    
    // Handle sessions that span midnight (e.g., 22-6)
    if (timeTo < timeFrom) {
      return currentHour >= timeFrom || currentHour < timeTo;
    }
    
    return currentHour >= timeFrom && currentHour < timeTo;
  }, [currentTime, isDateEnabled]);

  // Check if a session is SELECTABLE (can be chosen by user)
  // When OFFLINE: allow selecting any non-future cached session (expired sessions remain selectable)
  // When ONLINE: allows current active sessions AND past seasons, disables future seasons only
  const isSessionSelectable = useCallback((session: Session): boolean => {
    // Future seasons are always disabled (online or offline)
    if (isFutureSeason(session)) {
      return false;
    }
    
    // OFFLINE: allow selecting ANY non-future session from cache
    // This prevents "No session available" when offline and all sessions are time-closed
    if (!isOnline) {
      return true;
    }
    
    // Past seasons are always selectable (for historical data entry)
    if (isPastSeason(session)) {
      return true;
    }
    
    // For current/regular sessions, check if active (date + time)
    return isSessionActive(session);
  }, [isFutureSeason, isPastSeason, isSessionActive, isOnline]);

  // Find the currently active session from loaded sessions
  const findActiveSession = useCallback((sessionList: Session[]): Session | null => {
    return sessionList.find(s => isSessionActive(s)) || null;
  }, [isSessionActive]);

  // Process and update sessions without flickering
  const processSessionData = useCallback((
    data: Session[], 
    backendPeriodLabel?: string, 
    backendOrgtype?: string,
    isFromNetwork = false
  ) => {
    // Update period label and orgtype from backend
    if (backendPeriodLabel) {
      setPeriodLabel(backendPeriodLabel);
    }
    if (backendOrgtype) {
      setOrgtype(backendOrgtype);
    }
    
    setSessions(data);
    
    const active = findActiveSession(data);
    setActiveSession(active);
    
    // Auto-select active session if none selected
    if (active && !selectedSession) {
      onSessionChange(active);
    }
    
    if (isFromNetwork) {
      hasLoadedRef.current = true;
      setInitialLoadComplete(true);
    }
  }, [findActiveSession, selectedSession, onSessionChange]);

  // Load sessions - cache-first with non-blocking network refresh
  useEffect(() => {
    let isMounted = true;
    
    const loadSessions = async () => {
      // Try to load from cache FIRST for instant display
      if (isReady && !hasLoadedRef.current) {
        try {
          const cached = await getSessions();
          if (cached && cached.length > 0 && isMounted) {
            console.log('[SESSION] Loaded from cache:', cached.length, 'sessions');
            processSessionData(cached);
            hasLoadedRef.current = true;
            setInitialLoadComplete(true);
            setLoading(false);
          }
        } catch (cacheErr) {
          console.warn('[SESSION] Cache read error:', cacheErr);
        }
      }
      
      // Only show loading if we have no cached data
      if (!hasLoadedRef.current && isMounted) {
        setLoading(true);
      }
      setError(null);
      
      // Try to fetch fresh data from network (non-blocking)
      if (navigator.onLine) {
        try {
          const deviceFingerprint = await generateDeviceFingerprint();
          const response = await mysqlApi.sessions.getByDevice(deviceFingerprint) as SessionsResponse;
          
          if (!isMounted) return;
          
          if (response.success && response.data && response.data.length > 0) {
            processSessionData(
              response.data, 
              response.periodLabel, 
              response.orgtype, 
              true
            );
            
            // Save to cache for future offline use
            if (isReady) {
              try {
                await saveSessions(response.data);
                console.log('[SESSION] Saved to cache:', response.data.length, 'sessions');
              } catch (saveErr) {
                console.warn('[SESSION] Cache save error:', saveErr);
              }
            }
          } else if (response.success) {
            // No sessions found but request succeeded
            if (response.periodLabel) {
              setPeriodLabel(response.periodLabel);
            }
            if (response.orgtype) {
              setOrgtype(response.orgtype);
            }
            if (!hasLoadedRef.current) {
              setSessions([]);
              setInitialLoadComplete(true);
              hasLoadedRef.current = true;
            }
          }
        } catch (fetchErr) {
          console.warn('[SESSION] Network fetch error (using cache):', fetchErr);
          // Don't show error if we have cached data
          if (!hasLoadedRef.current && isMounted) {
            // Try loading from cache as fallback
            if (isReady) {
              try {
                const cached = await getSessions();
                if (cached && cached.length > 0) {
                  processSessionData(cached);
                  hasLoadedRef.current = true;
                  setInitialLoadComplete(true);
                }
              } catch (cacheErr) {
                console.warn('[SESSION] Fallback cache error:', cacheErr);
              }
            }
          }
        }
      } else {
        // Offline - rely on cached data
        console.log('[SESSION] Offline - using cached sessions');
        if (!hasLoadedRef.current && isReady) {
          try {
            const cached = await getSessions();
            if (cached && cached.length > 0 && isMounted) {
              processSessionData(cached);
              hasLoadedRef.current = true;
              setInitialLoadComplete(true);
            }
          } catch (cacheErr) {
            console.warn('[SESSION] Offline cache error:', cacheErr);
          }
        }
      }
      
      if (isMounted) {
        setLoading(false);
      }
    };

    loadSessions();
    
    return () => {
      isMounted = false;
    };
  }, [isReady, processSessionData, getSessions, saveSessions]);

  // Re-check active session when time changes
  useEffect(() => {
    if (sessions.length > 0) {
      const active = findActiveSession(sessions);
      setActiveSession(active);
    }
  }, [currentTime, sessions, findActiveSession]);

  // Format hour for display (12-hour format)
  const formatTime = (time: any) => {
    const hour = toHour(time);
    if (hour === null) return 'N/A';
    
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:00 ${ampm}`;
  };

  // Format date for display (e.g., 01 Mar 2025)
  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Get session status text
  const getSessionStatus = (session: Session): string => {
    // Check if future (not started yet)
    if (isFutureSeason(session)) {
      return '- Not started';
    }
    
    // Check if past season (already ended)
    if (isPastSeason(session)) {
      return '○ Past';
    }
    
    const dateOk = isDateEnabled(session);
    const timeOk = isSessionActive(session);
    
    if (!dateOk) {
      return '- Date closed';
    }
    if (!timeOk) {
      // When offline, show "Expired" instead of "Time closed" for clarity
      return !isOnline ? '○ Expired' : '- Time closed';
    }
    return '✓ Active';
  };

  // Show loading only on initial load (prevents flickering)
  if (loading && !hasLoadedRef.current) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          <Clock className="h-4 w-4 inline mr-1" />
          {periodLabel}
        </label>
        <div className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-500">
          Loading {periodLabel.toLowerCase()}s...
        </div>
      </div>
    );
  }

  if (error && !hasLoadedRef.current) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          <Clock className="h-4 w-4 inline mr-1" />
          {periodLabel}
        </label>
        <div className="w-full px-4 py-3 border border-red-300 rounded-lg bg-red-50 text-red-600 text-sm">
          <AlertCircle className="h-4 w-4 inline mr-1" />
          {error}
        </div>
      </div>
    );
  }

  if (sessions.length === 0 && initialLoadComplete) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          <Clock className="h-4 w-4 inline mr-1" />
          {periodLabel}
        </label>
        <div className="w-full px-4 py-3 border border-amber-300 rounded-lg bg-amber-50 text-amber-700 text-sm">
          <AlertCircle className="h-4 w-4 inline mr-1" />
          No {periodLabel.toLowerCase()}s configured for this company
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        {orgtype === 'C' ? <Calendar className="h-4 w-4 inline mr-1" /> : <Clock className="h-4 w-4 inline mr-1" />}
        {periodLabel}
      </label>
      <select
        value={selectedSession}
        onChange={(e) => {
          const selected = sessions.find(s => s.descript === e.target.value);
          if (selected) {
            // Check if selected session is selectable (past or active, not future)
            if (!isSessionSelectable(selected)) {
              return; // Prevent selection of future sessions
            }
            onSessionChange(selected);
          }
        }}
        disabled={disabled}
        className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:border-[#667eea] ${
          activeSession 
            ? 'border-green-300 bg-green-50' 
            : 'border-red-300 bg-red-50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <option value="">Select {periodLabel.toLowerCase()}...</option>
        {sessions.map((session) => {
          const selectable = isSessionSelectable(session);
          return (
            <option 
              key={session.id ? `season-${session.id}` : session.descript} 
              value={session.descript}
              disabled={!selectable}
            >
              {session.descript} ({formatTime(session.time_from)} - {formatTime(session.time_to)})
              {session.datefrom && session.dateto && ` [${formatDate(session.datefrom)} - ${formatDate(session.dateto)}]`}
              {' '}{getSessionStatus(session)}
            </option>
          );
        })}
      </select>
      
      {/* Session Status Indicator */}
      <div className="mt-2">
        {activeSession ? (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            <span>
              <strong>{activeSession.descript}</strong> is open 
              ({formatTime(activeSession.time_from)} - {formatTime(activeSession.time_to)})
              {activeSession.datefrom && activeSession.dateto && (
                <span className="text-xs ml-1">
                  [{formatDate(activeSession.datefrom)} - {formatDate(activeSession.dateto)}]
                </span>
              )}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>
              No {periodLabel.toLowerCase()} is currently open. Data entry is not allowed.
            </span>
          </div>
        )}
      </div>
      
      {/* Current Time Display */}
      <p className="text-xs text-gray-500 mt-1">
        Current time: {currentTime.toLocaleTimeString()} | Date: {currentTime.toLocaleDateString()}
      </p>
    </div>
  );
};
