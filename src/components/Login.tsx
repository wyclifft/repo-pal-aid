import { useState, memo } from 'react';
import { type AppUser } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { toast } from 'sonner';
import { generateDeviceFingerprint, getStoredDeviceId, setStoredDeviceId, getDeviceName } from '@/utils/deviceFingerprint';
import { storeDeviceConfig } from '@/utils/referenceGenerator';

interface LoginProps {
  onLogin: (user: AppUser, isOffline: boolean, password?: string) => void;
}

export const Login = memo(({ onLogin }: LoginProps) => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
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
        // Authenticate with MySQL backend
        const authResponse = await mysqlApi.auth.login(userId, password);

        if (!authResponse.success || !authResponse.data) {
          toast.error(authResponse.error || 'Invalid credentials');
          setLoading(false);
          return;
        }

        const userData = authResponse.data;

        // Try to check device approval status from MySQL (best effort)
        let deviceData = null;
        let needsRegistration = false;
        
        try {
          deviceData = await mysqlApi.devices.getByFingerprint(deviceFingerprint);
          
          // Check if device exists in approved_devices (has an id)
          // If it only exists in devsettings, it won't have an id
          if (deviceData && deviceData.id) {
            // Device is registered in approved_devices
            try {
              await saveDeviceApproval(deviceFingerprint, deviceData.id, userId, deviceData.approved);
            } catch (saveError) {
              console.error('Failed to cache device approval:', saveError);
              // Continue anyway - this is just caching
            }
            
            if (!deviceData.approved) {
              setDeviceStatus('pending');
              setCurrentDeviceId(deviceFingerprint);
              toast.error('Device pending approval. Contact administrator.');
              setLoading(false);
              return;
            }

            setDeviceStatus('approved');
            
            // Store device config for offline reference generation
            if (deviceData.company_name && deviceData.devcode) {
              storeDeviceConfig(deviceData.company_name, deviceData.devcode);
            }
            
            // Update last sync timestamp (best effort)
            try {
              await mysqlApi.devices.update(deviceData.id, { user_id: userId });
            } catch (updateError) {
              console.warn('Failed to update device sync time:', updateError);
            }
          } else if (deviceData && !deviceData.id) {
            // Device exists in devsettings but not in approved_devices
            console.log('Device found in devsettings but not in approved_devices - needs registration');
            needsRegistration = true;
            deviceData = null;
          }
        } catch (apiError) {
          console.warn('MySQL API unavailable, using cached approval:', apiError);
          // API failed - fall back to cached approval
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
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center p-4 bg-gradient-to-br from-[#667eea] to-[#764ba2]" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="bg-white rounded-xl p-6 sm:p-8 w-full max-w-md shadow-2xl">
        <h2 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6 text-center text-[#667eea]">
          Milk Collection
        </h2>
        
        {deviceStatus === 'pending' && (
          <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg">
            <div className="flex items-start gap-2 sm:gap-3">
              <span className="text-xl sm:text-2xl">⏳</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-yellow-800 mb-1 sm:mb-2 text-sm sm:text-base">Device Pending Approval</h3>
                <p className="text-xs sm:text-sm text-yellow-700 mb-2">
                  Your device has been registered and is waiting for administrator approval.
                </p>
                <div className="bg-white p-2 rounded border border-yellow-300 mt-2">
                  <p className="text-xs font-mono text-gray-600 break-all">
                    <strong>Device:</strong> {currentDeviceId.substring(0, 40)}...
                  </p>
                </div>
                <p className="text-xs text-yellow-600 mt-2">
                  Contact your administrator to approve this device.
                </p>
              </div>
            </div>
          </div>
        )}

        {deviceStatus === 'approved' && (
          <div className="mb-3 sm:mb-4 p-2.5 sm:p-3 bg-green-50 border border-green-400 rounded-lg text-center">
            <span className="text-green-700 font-semibold text-sm sm:text-base">✓ Device Approved</span>
          </div>
        )}
        
        <form onSubmit={handleLogin} className="space-y-3 sm:space-y-4">
          <input
            type="text"
            inputMode="text"
            autoComplete="username"
            placeholder="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#667eea] text-base min-h-[48px]"
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#667eea] text-base min-h-[48px]"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#667eea] text-white rounded-lg font-semibold hover:bg-[#5568d3] active:bg-[#4458c3] transition-colors disabled:opacity-50 min-h-[48px] text-base"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
});
