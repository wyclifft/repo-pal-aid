import { useEffect, useState, memo } from 'react';
import { Mail, Eye, EyeOff } from 'lucide-react';
import { type AppUser } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { toast } from 'sonner';
import { generateDeviceFingerprint, getStoredDeviceId, setStoredDeviceId, getDeviceName } from '@/utils/deviceFingerprint';
import { storeDeviceConfig, syncOfflineCounter } from '@/utils/referenceGenerator';
import loginBg from '@/assets/login-bg.jpg';

interface LoginProps {
  onLogin: (user: AppUser, isOffline: boolean, password?: string) => void;
}

export const Login = memo(({ onLogin }: LoginProps) => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<'pending' | 'approved' | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const { isReady, saveUser, getUser, saveDeviceApproval, getDeviceApproval } = useIndexedDB();
  const [deviceFingerprintPreview, setDeviceFingerprintPreview] = useState<string>('');

  useEffect(() => {
    let mounted = true;

    const initializeFingerprint = async () => {
      try {
        const existing = getStoredDeviceId();
        if (existing && mounted) {
          setDeviceFingerprintPreview(existing);
          return;
        }

        const fingerprint = await generateDeviceFingerprint();
        if (!mounted) return;

        setStoredDeviceId(fingerprint);
        setDeviceFingerprintPreview(fingerprint);
      } catch (error) {
        console.error('Fingerprint initialization failed:', error);
        if (mounted) {
          setDeviceFingerprintPreview('Unavailable');
        }
      }
    };

    const onFingerprintReady = (event: Event) => {
      const custom = event as CustomEvent<{ fingerprint?: string }>;
      const fp = custom?.detail?.fingerprint;
      if (fp && mounted) {
        setDeviceFingerprintPreview(fp);
      }
    };

    window.addEventListener('deviceFingerprintReady', onFingerprintReady as EventListener);
    initializeFingerprint();

    return () => {
      mounted = false;
      window.removeEventListener('deviceFingerprintReady', onFingerprintReady as EventListener);
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!userId || !password) {
      toast.error('Enter credentials');
      return;
    }

    // For offline login, don't require IndexedDB - use localStorage fallback
    const isOffline = !navigator.onLine;
    if (!isReady && !isOffline) {
      toast.error('Local database not ready yet. Please wait a second and try again.');
      return;
    }

    setLoading(true);

    // Get or generate device fingerprint
    let deviceFingerprint = getStoredDeviceId() || deviceFingerprintPreview;
    if (!deviceFingerprint || deviceFingerprint === 'Unavailable') {
      try {
        deviceFingerprint = await generateDeviceFingerprint();
        setStoredDeviceId(deviceFingerprint);
        setDeviceFingerprintPreview(deviceFingerprint);
      } catch (fingerprintError) {
        console.error('Fingerprint generation error:', fingerprintError);
        toast.error('Device fingerprint failed. Please restart the app and try again.');
        setLoading(false);
        return;
      }
    }
    
    console.log('Device fingerprint:', deviceFingerprint);

    // Check cached device approval (fire and forget - don't block)
    const cachedApprovalPromise = getDeviceApproval(deviceFingerprint).catch(() => null);
    
    if (navigator.onLine) {
      try {
        // OPTIMIZED: Run auth and device check in PARALLEL with short timeout
        const authPromise = mysqlApi.auth.login(userId, password, deviceFingerprint);
        const deviceCheckPromise = Promise.race([
          mysqlApi.devices.getByFingerprint(deviceFingerprint),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)) // 2s timeout for device
        ]);

        // Wait for auth (critical) while device check runs in parallel
        const [authResponse, deviceData] = await Promise.all([
          authPromise,
          deviceCheckPromise.catch(() => null) // Don't fail if device check fails
        ]);

        if (!authResponse.success || !authResponse.data) {
          toast.error(authResponse.error || 'Invalid credentials');
          setLoading(false);
          return;
        }

        const rawUserData = authResponse.data as Partial<AppUser> & Record<string, any>;
        const normalizedUserId = String(rawUserData.user_id ?? rawUserData.userid ?? userId).trim();

        if (!normalizedUserId) {
          throw new Error('Authentication succeeded but user ID is missing in response');
        }

        const userData: AppUser = {
          ...rawUserData,
          user_id: normalizedUserId,
        };

        let resolvedDeviceData = deviceData;

        // Process device data (already fetched in parallel)
        if (resolvedDeviceData && resolvedDeviceData.id) {
          // Device is registered - cache approval asynchronously (fire and forget)
          saveDeviceApproval(deviceFingerprint, resolvedDeviceData.id, normalizedUserId, resolvedDeviceData.approved).catch(() => {});
          
          if (!resolvedDeviceData.approved) {
            setDeviceStatus('pending');
            setCurrentDeviceId(deviceFingerprint);
            toast.error('Device pending approval. Contact administrator.');
            setLoading(false);
            return;
          }

          setDeviceStatus('approved');
          
          // Store device config asynchronously (fire and forget - don't block login)
          if (resolvedDeviceData.company_name && resolvedDeviceData.devcode) {
            storeDeviceConfig(resolvedDeviceData.company_name, resolvedDeviceData.devcode).catch(() => {});
          }
          if (resolvedDeviceData.devcode) {
            try {
              localStorage.setItem('devcode', resolvedDeviceData.devcode);
            } catch (storageError) {
              console.warn('[AUTH] Failed to cache devcode locally:', storageError);
            }

            // Sync counters in background (fire and forget)
            const lastTrnId = resolvedDeviceData.trnid ? parseInt(String(resolvedDeviceData.trnid), 10) : undefined;
            const lastMilkId = resolvedDeviceData.milkid ? parseInt(String(resolvedDeviceData.milkid), 10) : undefined;
            const lastStoreId = resolvedDeviceData.storeid ? parseInt(String(resolvedDeviceData.storeid), 10) : undefined;
            const lastAiId = resolvedDeviceData.aiid ? parseInt(String(resolvedDeviceData.aiid), 10) : undefined;
            syncOfflineCounter(resolvedDeviceData.devcode, lastTrnId, lastMilkId, lastStoreId, lastAiId).catch(() => {});
          }
          
          // Update last sync timestamp (fire and forget)
          mysqlApi.devices.update(resolvedDeviceData.id, { user_id: normalizedUserId }).catch(() => {});
        } else if (resolvedDeviceData && !resolvedDeviceData.id) {
          console.log('Device in devsettings but not approved_devices - needs registration');
          resolvedDeviceData = null;
        }
        
        // Use cached approval from parallel fetch
        const cachedApproval = await cachedApprovalPromise;

        // If API failed, device not found in backend, or needs registration, handle it
        if (!resolvedDeviceData) {
          if (cachedApproval) {
            // Use cached approval status - fast path
            console.log('Using cached device approval (API timeout or failure)');
            
            if (!cachedApproval.approved) {
              setDeviceStatus('pending');
              setCurrentDeviceId(deviceFingerprint);
              toast.warning('Device pending approval (cached status).');
              setLoading(false);
              return;
            }
            
            setDeviceStatus('approved');
          } else {
            // New device - register in background with short timeout
            try {
              const deviceName = getDeviceName();
              const registerResult = await Promise.race([
                mysqlApi.devices.register({
                  device_fingerprint: deviceFingerprint,
                  user_id: normalizedUserId,
                  approved: false,
                  device_info: deviceName,
                }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
              ]);

              if (registerResult && registerResult.id) {
                console.log('Device registered with ID:', registerResult.id);
                // Save approval in background
                saveDeviceApproval(deviceFingerprint, registerResult.id, normalizedUserId, false).catch(() => {});
                setDeviceStatus('pending');
                setCurrentDeviceId(deviceFingerprint);
                toast.error('New device detected. Awaiting admin approval.');
                setLoading(false);
                return;
              }
            } catch (registerError) {
              console.warn('Failed to register device:', registerError);
              toast.error('Cannot register new device. This device must be approved first.');
              setLoading(false);
              return;
            }
          }
        }

        // Explicitly convert admin to boolean for role assignment
        // supervisor is now a number (0-4) controlling capture mode
        const isAdmin = Boolean(userData.admin);
        const supervisorMode = typeof userData.supervisor === 'number' ? userData.supervisor : 0;
        
        console.log('👤 Role assignment - admin:', userData.admin, 'isAdmin:', isAdmin, 'supervisor mode:', supervisorMode);
        
        const userWithPassword: AppUser = {
          ...userData,
          user_id: normalizedUserId,
          username: userData.username || normalizedUserId,
          supervisor: supervisorMode,
          password,
          role: isAdmin ? 'admin' : 'user'
        };
        
        console.log('👤 Login successful - User data:', {
          user_id: userWithPassword.user_id,
          admin: userWithPassword.admin,
          supervisor: supervisorMode,
          role: userWithPassword.role
        });

        // Do not block successful auth when local IndexedDB cache write fails
        try {
          saveUser(userWithPassword);
        } catch (cacheError) {
          console.warn('[AUTH] Failed to cache user in IndexedDB, continuing login:', cacheError);
        }

        onLogin(userWithPassword, false, password); // Pass password to cache credentials
        toast.success('Login successful');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('Login error:', errorMessage, err);
        toast.error('Login failed. Check credentials.');
      }
    } else {
      console.log('[OFFLINE] Offline login attempt for user:', userId);
      
      // Check cached credentials from localStorage (stored on first online login)
      const cachedCredsStr = localStorage.getItem('cachedCredentials');
      console.log('[OFFLINE] Cached credentials found:', !!cachedCredsStr);
      
      if (!cachedCredsStr) {
        console.log('[OFFLINE] No cached credentials - first login must be online');
        toast.error('First-time login must be done online. Connect to internet and try again.');
        setLoading(false);
        return;
      }
      
      try {
        const cachedCreds = JSON.parse(cachedCredsStr);
        console.log('[OFFLINE] Cached user_id:', cachedCreds.user_id, 'Input user_id:', userId);
        console.log('[OFFLINE] Password match:', cachedCreds.password === password);
        
        // Verify credentials match (case-insensitive user ID, exact password)
        const userIdMatch = cachedCreds.user_id?.toLowerCase().trim() === userId.toLowerCase().trim();
        const passwordMatch = cachedCreds.password === password;
        
        if (!userIdMatch || !passwordMatch) {
          console.log('[OFFLINE] Credential mismatch - userIdMatch:', userIdMatch, 'passwordMatch:', passwordMatch);
          toast.error('Invalid credentials (offline)');
          setLoading(false);
          return;
        }
        
        // Recreate user object from cached credentials (includes all fields for full offline support)
        const user: AppUser = {
          user_id: cachedCreds.user_id,
          role: cachedCreds.role || (cachedCreds.admin ? 'admin' : 'user'),
          username: cachedCreds.username || cachedCreds.user_id,
          email: cachedCreds.email || '',
          ccode: cachedCreds.ccode || '',
          admin: cachedCreds.admin ?? false,
          supervisor: cachedCreds.supervisor ?? 0,
          dcode: cachedCreds.dcode || '',
          groupid: cachedCreds.groupid || '',
          depart: cachedCreds.depart || ''
        };
        
        console.log('👤 Offline login - Cached user data:', {
          user_id: cachedCreds.user_id,
          admin: cachedCreds.admin,
          role: cachedCreds.role
        });

        // For offline login, try to get cached device approval but don't block on it
        let cachedApproval = null;
        try {
          if (isReady) {
            cachedApproval = await getDeviceApproval(deviceFingerprint);
          }
        } catch (dbError) {
          console.warn('IndexedDB not available for offline login, using localStorage fallback');
        }
        
        if (!cachedApproval) {
          // Check localStorage for device approval as fallback
          const storedApproval = localStorage.getItem('device_approved');
          const storedUserId = localStorage.getItem('device_user_id');
          
          if (storedApproval === 'true' && storedUserId === userId) {
            console.log('✅ Using localStorage device approval fallback');
            setDeviceStatus('approved');
            onLogin(user, true);
            toast.success('Offline login successful');
            setLoading(false);
            return;
          }
          
          console.log('⚠️ No cached device approval found, but user exists - allowing offline login');
          console.log('User should reconnect online to refresh device approval status');
          
          // Save approval to localStorage for future offline logins
          localStorage.setItem('device_approved', 'true');
          localStorage.setItem('device_user_id', userId);
          
          setDeviceStatus('approved');
          onLogin(user, true);
          toast.success('Offline login successful (limited mode)');
          setLoading(false);
          return;
        }

        if (cachedApproval.user_id !== userId) {
          toast.error('This device is registered to a different user. Connect online to verify.');
          setLoading(false);
          return;
        }

        if (!cachedApproval.approved) {
          setDeviceStatus('pending');
          setCurrentDeviceId(deviceFingerprint);
          toast.error('Device pending approval. Connect to internet to check status.');
          setLoading(false);
          return;
        }

        console.log('✅ Offline login success with approved device:', user.user_id);
        setDeviceStatus('approved');
        onLogin(user, true);
        toast.success('Offline login successful');
      } catch (err) {
        console.error('Offline login error:', err);
        toast.error('Offline login failed. Please try again.');
      }
    }

    setLoading(false);
  };

  return (
    <div 
      className="h-screen h-[100dvh] flex flex-col bg-gray-100 overflow-hidden"
      style={{ 
        backgroundImage: `url(${loginBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      {/* Purple Header */}
      <header 
        className="bg-[#7B68A6] h-12 w-full flex-shrink-0"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-4 overflow-hidden">
        {deviceStatus === 'pending' && (
          <div className="mb-4 p-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg max-w-sm w-full">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⏳</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-yellow-800 mb-1 text-sm">Device Pending Approval</h3>
                <p className="text-xs text-yellow-700 mb-2">
                  Your device is waiting for administrator approval.
                </p>
                <div className="bg-white p-2 rounded border border-yellow-300">
                  <p className="text-xs font-mono text-gray-600 break-all">
                    <strong>Device:</strong> {currentDeviceId.substring(0, 30)}...
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {deviceStatus === 'approved' && (
          <div className="mb-3 p-3 bg-green-50 border border-green-400 rounded-lg text-center max-w-sm w-full">
            <span className="text-green-700 font-semibold text-sm">✓ Device Approved</span>
          </div>
        )}
        
        <div className="mb-2 p-2 bg-white/80 border border-gray-300 rounded text-xs text-gray-700 break-all">
          <strong>Device Fingerprint:</strong>{' '}
          {deviceFingerprintPreview && deviceFingerprintPreview !== 'Unavailable'
            ? `${deviceFingerprintPreview.substring(0, 20)}...`
            : deviceFingerprintPreview || 'Generating...'}
        </div>

        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
          {/* User ID Field */}
          <div className="relative">
            <input
              type="text"
              id="userid"
              name="userid"
              inputMode="text"
              autoComplete="username"
              placeholder="User ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full px-4 py-4 pr-12 bg-white/90 border border-gray-300 rounded-md focus:outline-none focus:border-[#7B68A6] text-base min-h-[56px]"
            />
            <Mail className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          </div>

          {/* Password Field */}
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              name="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-4 pr-12 bg-white/90 border border-gray-300 rounded-md focus:outline-none focus:border-[#7B68A6] text-base min-h-[56px]"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1"
            >
              {showPassword ? (
                <EyeOff className="h-5 w-5 text-gray-400" />
              ) : (
                <Eye className="h-5 w-5 text-gray-400" />
              )}
            </button>
          </div>

          {/* Login Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-5 bg-[#7B68A6] text-white rounded-full font-bold text-xl hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors disabled:opacity-50 min-h-[60px] shadow-lg mt-6"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </main>
    </div>
  );
});
