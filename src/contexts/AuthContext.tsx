import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { type AppUser } from '@/lib/supabase';
import { toast } from 'sonner';

interface AuthContextType {
  currentUser: AppUser | null;
  isOffline: boolean;
  login: (user: AppUser, offline: boolean, password?: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'currentUser';
const SESSION_TIMESTAMP_KEY = 'sessionTimestamp';
const CACHED_CREDENTIALS_KEY = 'cachedCredentials'; // For offline use only
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isInitialized, setIsInitialized] = useState(false);

  // Validate and restore session on mount
  useEffect(() => {
    restoreSession();
    setIsInitialized(true);
  }, []);

  // Listen for storage events (cross-tab sync) - sessionStorage doesn't sync across tabs
  // but we keep the listener structure for consistency
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) {
        if (e.newValue) {
          try {
            const user = JSON.parse(e.newValue);
            setCurrentUser(user);
            console.log('Session synced from another tab');
          } catch (error) {
            console.error('Failed to sync session:', error);
            setCurrentUser(null);
          }
        } else {
          // Session cleared in another tab
          setCurrentUser(null);
          console.log('Session cleared from another tab');
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      console.log('Network status: Online');
    };
    
    const handleOffline = () => {
      setIsOffline(true);
      console.log('Network status: Offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Periodic session validation
  useEffect(() => {
    if (!currentUser) return;

    const interval = setInterval(() => {
      validateSession();
    }, 5 * 60 * 1000); // Check every 5 minutes

    return () => clearInterval(interval);
  }, [currentUser]);

  const restoreSession = () => {
    try {
      const storedUser = sessionStorage.getItem(SESSION_KEY);
      const timestamp = sessionStorage.getItem(SESSION_TIMESTAMP_KEY);

      if (storedUser && timestamp) {
        const sessionAge = Date.now() - parseInt(timestamp, 10);
        
        if (sessionAge > SESSION_DURATION) {
          console.log('Session expired, clearing...');
          clearSession();
          return;
        }

        const user = JSON.parse(storedUser);
        setCurrentUser(user);
        console.log('✅ Session restored:', user.user_id);
        
        // Update timestamp to extend session
        sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
      } else {
        console.log('No valid session found');
      }
    } catch (error) {
      console.error('Failed to restore session:', error);
      clearSession();
    }
  };

  const validateSession = () => {
    try {
      const storedUser = sessionStorage.getItem(SESSION_KEY);
      const timestamp = sessionStorage.getItem(SESSION_TIMESTAMP_KEY);

      if (!storedUser || !timestamp) {
        console.warn('Session data missing, logging out');
        logout();
        return;
      }

      const sessionAge = Date.now() - parseInt(timestamp, 10);
      
      if (sessionAge > SESSION_DURATION) {
        console.warn('Session expired');
        logout();
        toast.error('Session expired. Please login again.');
        return;
      }

      // Session is still valid, update timestamp
      sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
    } catch (error) {
      console.error('Session validation failed:', error);
      logout();
    }
  };

  const login = (user: AppUser, offline: boolean, password?: string) => {
    try {
      setCurrentUser(user);
      setIsOffline(offline);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
      sessionStorage.setItem(SESSION_TIMESTAMP_KEY, Date.now().toString());
      
      // Cache credentials for offline login (only when password is provided)
      if (password) {
        const cachedCreds = {
          user_id: user.user_id,
          password: password,
          role: user.role,
          username: user.username,
          email: user.email,
          ccode: user.ccode,
          admin: user.admin,
          supervisor: user.supervisor,
          timestamp: Date.now()
        };
        localStorage.setItem(CACHED_CREDENTIALS_KEY, JSON.stringify(cachedCreds));
      }
      
      console.log('✅ User logged in:', user.user_id);
    } catch (error) {
      console.error('Failed to save session:', error);
      toast.error('Failed to save session. Please try again.');
    }
  };

  const logout = () => {
    setCurrentUser(null);
    clearSession();
    console.log('User logged out');
  };

  const clearSession = () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_TIMESTAMP_KEY);
  };

  if (!isInitialized) {
    return null; // or a loading spinner
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isOffline,
        login,
        logout,
        isAuthenticated: !!currentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
