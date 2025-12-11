import { useState, useEffect, useCallback } from 'react';
import { mysqlApi, type Session } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { Clock, AlertCircle, CheckCircle } from 'lucide-react';

interface SessionSelectorProps {
  selectedSession: string;
  onSessionChange: (session: Session | null) => void;
  disabled?: boolean;
}

export const SessionSelector = ({ 
  selectedSession, 
  onSessionChange, 
  disabled = false 
}: SessionSelectorProps) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const { saveSessions, getSessions } = useIndexedDB();

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Check if a session is active based on current time
  const isSessionActive = useCallback((session: Session): boolean => {
    const now = currentTime;
    const currentTimeStr = now.toTimeString().split(' ')[0]; // "HH:MM:SS"
    
    // Handle time comparison
    const timeFrom = session.time_from;
    const timeTo = session.time_to;
    
    return currentTimeStr >= timeFrom && currentTimeStr <= timeTo;
  }, [currentTime]);

  // Find the currently active session from loaded sessions
  const findActiveSession = useCallback((sessionList: Session[]): Session | null => {
    return sessionList.find(s => isSessionActive(s)) || null;
  }, [isSessionActive]);

  // Load sessions
  useEffect(() => {
    const loadSessions = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const deviceFingerprint = await generateDeviceFingerprint();
        
        // Try to load from cache first
        const cached = await getSessions();
        if (cached && cached.length > 0) {
          setSessions(cached);
          const active = findActiveSession(cached);
          setActiveSession(active);
          if (active && !selectedSession) {
            onSessionChange(active);
          }
        }
        
        // Fetch fresh data if online
        if (navigator.onLine) {
          const response = await mysqlApi.sessions.getByDevice(deviceFingerprint);
          
          if (response.success && response.data) {
            setSessions(response.data);
            await saveSessions(response.data);
            
            const active = findActiveSession(response.data);
            setActiveSession(active);
            
            // Auto-select active session if none selected
            if (active && !selectedSession) {
              onSessionChange(active);
            }
          } else if (!cached || cached.length === 0) {
            setError(response.error || 'Failed to load sessions');
          }
        } else if (!cached || cached.length === 0) {
          setError('Offline - no cached sessions available');
        }
      } catch (err) {
        console.error('Error loading sessions:', err);
        setError('Failed to load sessions');
      } finally {
        setLoading(false);
      }
    };

    loadSessions();
  }, [getSessions, saveSessions, findActiveSession, selectedSession, onSessionChange]);

  // Re-check active session when time changes
  useEffect(() => {
    if (sessions.length > 0) {
      const active = findActiveSession(sessions);
      setActiveSession(active);
    }
  }, [currentTime, sessions, findActiveSession]);

  // Format time for display (HH:MM)
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  if (loading) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          <Clock className="h-4 w-4 inline mr-1" />
          Session
        </label>
        <div className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-500">
          Loading sessions...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          <Clock className="h-4 w-4 inline mr-1" />
          Session
        </label>
        <div className="w-full px-4 py-3 border border-red-300 rounded-lg bg-red-50 text-red-600 text-sm">
          <AlertCircle className="h-4 w-4 inline mr-1" />
          {error}
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          <Clock className="h-4 w-4 inline mr-1" />
          Session
        </label>
        <div className="w-full px-4 py-3 border border-amber-300 rounded-lg bg-amber-50 text-amber-700 text-sm">
          <AlertCircle className="h-4 w-4 inline mr-1" />
          No sessions configured for this company
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        <Clock className="h-4 w-4 inline mr-1" />
        Session
      </label>
      <select
        value={selectedSession}
        onChange={(e) => {
          const selected = sessions.find(s => s.descript === e.target.value);
          if (selected) {
            // Check if selected session is active
            if (!isSessionActive(selected)) {
              return; // Prevent selection of inactive sessions
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
        <option value="">Select session...</option>
        {sessions.map((session) => {
          const isActive = isSessionActive(session);
          return (
            <option 
              key={session.descript} 
              value={session.descript}
              disabled={!isActive}
            >
              {session.descript} ({formatTime(session.time_from)} - {formatTime(session.time_to)})
              {isActive ? ' ✓ Active' : ' - Closed'}
            </option>
          );
        })}
      </select>
      
      {/* Session Status Indicator */}
      <div className="mt-2">
        {activeSession ? (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">
            <CheckCircle className="h-4 w-4" />
            <span>
              <strong>{activeSession.descript}</strong> is open 
              ({formatTime(activeSession.time_from)} - {formatTime(activeSession.time_to)})
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
            <AlertCircle className="h-4 w-4" />
            <span>
              No session is currently open. Data entry is not allowed.
            </span>
          </div>
        )}
      </div>
      
      {/* Current Time Display */}
      <p className="text-xs text-gray-500 mt-1">
        Current time: {currentTime.toLocaleTimeString()}
      </p>
    </div>
  );
};
