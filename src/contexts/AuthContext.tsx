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

const CACHED_CREDENTIALS_KEY = 'cachedCredentials'; // For offline use only

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isInitialized, setIsInitialized] = useState(false);

  // SECURITY: Always require login on app start - no session restoration
  // This ensures login page is ALWAYS displayed when app opens/restarts
  useEffect(() => {
    setCurrentUser(null);
    setIsInitialized(true);
    console.log('🔒 App started - login required');
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

  const login = (user: AppUser, offline: boolean, password?: string) => {
    try {
      setCurrentUser(user);
      setIsOffline(offline);
      
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
      
      // Pre-cache pages after successful login (only if not recently cached)
      import('@/utils/precachePages').then(({ precacheApplicationPages, arePagesRecentlyCached }) => {
        if (!arePagesRecentlyCached()) {
          toast.promise(
            precacheApplicationPages(),
            {
              loading: 'Preparing app for offline use...',
              success: 'App ready for offline use',
              error: 'Could not cache all pages',
            }
          );
        } else {
          console.log('ℹ️ Pages already recently cached, skipping pre-cache');
        }
      });
    } catch (error) {
      console.error('Failed to save session:', error);
      toast.error('Failed to save session. Please try again.');
    }
  };

  const logout = () => {
    setCurrentUser(null);
    console.log('User logged out');
  };

  if (!isInitialized) {
    return null;
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
