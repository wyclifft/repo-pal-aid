import { useState, memo } from 'react';
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
    let deviceFingerprint = getStoredDeviceId();
    if (!deviceFingerprint) {
      deviceFingerprint = await generateDeviceFingerprint();
      setStoredDeviceId(deviceFingerprint);
    }
    
    console.log('Device fingerprint:', deviceFingerprint);

    // Check cached device approval first (works offline and online)
    const cachedApproval = await getDeviceApproval(deviceFingerprint);
    
    if (navigator.onLine) {
      try {
        // Authenticate with MySQL backend - don't wait for device check
        const authResponse = await mysqlApi.auth.login(userId, password);

        if (!authResponse.success || !authResponse.data) {
          toast.error(authResponse.error || 'Invalid credentials');
          setLoading(false);
          return;
        }

        const userData = authResponse.data;

        // Try to check device approval status from MySQL (non-blocking with timeout)
        let deviceData = null;
        let needsRegistration = false;
        
        try {
          // Use Promise.race to timeout device check after 3s
          const deviceCheckPromise = mysqlApi.devices.getByFingerprint(deviceFingerprint);
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
          
          deviceData = await Promise.race([deviceCheckPromise, timeoutPromise]);
          
          if (deviceData && deviceData.id) {
            // Device is registered - cache approval asynchronously (don't await)
            saveDeviceApproval(deviceFingerprint, deviceData.id, userId, deviceData.approved).catch(e => 
              console.warn('Cache device approval failed:', e)
            );
            
            if (!deviceData.approved) {
              setDeviceStatus('pending');
              setCurrentDeviceId(deviceFingerprint);
              toast.error('Device pending approval. Contact administrator.');
              setLoading(false);
              return;
            }

            setDeviceStatus('approved');
            
            // Store device config and device_ref asynchronously
            if (deviceData.company_name && deviceData.devcode) {
              storeDeviceConfig(deviceData.company_name, deviceData.devcode);
            }
            if (deviceData.device_ref) {
              localStorage.setItem('device_ref', deviceData.device_ref);
              // Sync counter from backend's last sequence to maintain consistency
              const lastSequence = deviceData.last_sequence ? parseInt(deviceData.last_sequence, 10) : undefined;
              syncOfflineCounter(deviceData.device_ref, lastSequence).catch(e => console.warn('Sync counter failed:', e));
              console.log('📦 Stored device_ref:', deviceData.device_ref, 'last_sequence:', lastSequence);
            }
            
            // Update last sync timestamp (fire and forget)
            mysqlApi.devices.update(deviceData.id, { user_id: userId }).catch(() => {});
          } else if (deviceData && !deviceData.id) {
            console.log('Device in devsettings but not approved_devices - needs registration');
            needsRegistration = true;
            deviceData = null;
          }
        } catch (apiError) {
          console.warn('Device check failed, using cached:', apiError);
          deviceData = null;
        }

        // If API failed, device not found in backend, or needs registration, handle it
        if (!deviceData) {
          if (cachedApproval) {
            // Use cached approval status
            console.log('Using cached device approval (offline mode or API failure)');
            
            if (!cachedApproval.approved) {
              setDeviceStatus('pending');
              setCurrentDeviceId(deviceFingerprint);
              toast.warning('Device pending approval (cached status).');
              setLoading(false);
              return;
            }
            
            setDeviceStatus('approved');
          } else {
            // New device - try to register it (only if API is reachable)
            try {
              const deviceName = getDeviceName();
              const newDevice = await mysqlApi.devices.register({
                device_fingerprint: deviceFingerprint,
                user_id: userId,
                approved: false,
                device_info: deviceName,
              });

              if (newDevice && newDevice.id) {
                console.log('Device registered with ID:', newDevice.id);
                try {
                  await saveDeviceApproval(deviceFingerprint, newDevice.id, userId, false);
                } catch (saveError) {
                  console.error('Failed to cache device approval:', saveError);
                }
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

        // Explicitly convert admin and supervisor to boolean for role assignment
        const isAdmin = Boolean(userData.admin);
        const isSupervisor = Boolean(userData.supervisor);
        
        console.log('👤 Role assignment - admin:', userData.admin, 'isAdmin:', isAdmin, 'supervisor:', userData.supervisor, 'isSupervisor:', isSupervisor);
        
        const userWithPassword: AppUser = { 
          ...userData, 
          password,
          role: isAdmin ? 'admin' : (isSupervisor ? 'supervisor' : 'user')
        };
        
        console.log('👤 Login successful - User data:', {
          user_id: userData.user_id,
          admin: userData.admin,
          supervisor: userData.supervisor,
          role: userWithPassword.role
        });
        
        saveUser(userWithPassword);
        onLogin(userWithPassword, false, password); // Pass password to cache credentials
        toast.success('Login successful');
      } catch (err) {
        console.error('Login error', err);
        toast.error('Login failed. Check credentials.');
      }
    } else {
      console.log('🔒 Offline login attempt...');
      
      // Check cached credentials from localStorage (stored on first login)
      const cachedCredsStr = localStorage.getItem('cachedCredentials');
      if (!cachedCredsStr) {
        toast.error('First-time login must be done online. Connect to internet and try again.');
        setLoading(false);
        return;
      }
      
      try {
        const cachedCreds = JSON.parse(cachedCredsStr);
        
        // Verify credentials match
        if (cachedCreds.user_id !== userId || cachedCreds.password !== password) {
          toast.error('Invalid credentials (offline)');
          setLoading(false);
          return;
        }
        
        // Recreate user object from cached credentials
        const user: AppUser = {
          user_id: cachedCreds.user_id,
          role: cachedCreds.role,
          username: cachedCreds.username,
          email: cachedCreds.email,
          ccode: cachedCreds.ccode,
          admin: cachedCreds.admin,
          supervisor: cachedCreds.supervisor
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
      className="min-h-screen min-h-[100dvh] flex flex-col bg-gray-100"
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
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-8">
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
        
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
          {/* User ID Field */}
          <div className="relative">
            <input
              type="text"
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
            className="w-full py-4 bg-[#7B68A6] text-white rounded-full font-bold text-lg hover:bg-[#6B5996] active:bg-[#5A4985] transition-colors disabled:opacity-50 min-h-[56px] shadow-lg mt-6"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </main>
    </div>
  );
});
