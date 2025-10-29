import { useState } from 'react';
import { supabase, type AppUser } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { toast } from 'sonner';
import { generateDeviceFingerprint, getStoredDeviceId, setStoredDeviceId, getDeviceName } from '@/utils/deviceFingerprint';

interface LoginProps {
  onLogin: (user: AppUser, isOffline: boolean) => void;
}

export const Login = ({ onLogin }: LoginProps) => {
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

    if (!isReady) {
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

    // Check cached device approval first (works offline and online)
    const cachedApproval = await getDeviceApproval(deviceFingerprint);
    
    if (navigator.onLine) {
      try {
        const { data, error } = await supabase
          .from('app_users')
          .select('*')
          .eq('user_id', userId)
          .eq('password', password)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          // Try to check device approval status from MySQL
          let deviceData = null;
          try {
            deviceData = await mysqlApi.devices.getByFingerprint(deviceFingerprint);
          } catch (apiError) {
            console.warn('MySQL API unavailable, using cached approval:', apiError);
            // Fall back to cached approval if API fails
          }

          // If API is available, sync with backend
          if (deviceData !== null) {
            if (!deviceData.approved) {
              setDeviceStatus('pending');
              setCurrentDeviceId(deviceFingerprint);
              // Update cache
              await saveDeviceApproval(deviceFingerprint, deviceData.id, userId, false);
              toast.error('Device pending approval. Contact administrator.');
              setLoading(false);
              return;
            }

            setDeviceStatus('approved');
            // Update cache with latest approval status
            await saveDeviceApproval(deviceFingerprint, deviceData.id, userId, true);
            
            // Update last sync timestamp (best effort)
            try {
              await mysqlApi.devices.update(deviceData.id, { user_id: userId });
            } catch (updateError) {
              console.warn('Failed to update device sync time:', updateError);
            }
          } else if (!deviceData && !cachedApproval) {
            // New device - try to register it
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
                await saveDeviceApproval(deviceFingerprint, newDevice.id, userId, false);
                setDeviceStatus('pending');
                setCurrentDeviceId(deviceFingerprint);
                toast.error('New device detected. Awaiting admin approval.');
                setLoading(false);
                return;
              }
            } catch (registerError) {
              console.warn('Failed to register device, may need internet:', registerError);
              toast.error('Cannot register device. Check internet connection.');
              setLoading(false);
              return;
            }
          } else if (cachedApproval) {
            // Use cached approval when API is unavailable
            if (!cachedApproval.approved) {
              setDeviceStatus('pending');
              setCurrentDeviceId(deviceFingerprint);
              toast.warning('Using cached device status. Device pending approval.');
              setLoading(false);
              return;
            }
            setDeviceStatus('approved');
          }

          const userWithPassword = { ...data, password };
          saveUser(userWithPassword);
          onLogin(data, false);
          toast.success('Login successful');
        } else {
          toast.error('Invalid credentials');
        }
      } catch (err) {
        console.error('Login error', err);
        toast.error('Login failed. Check credentials.');
      }
    } else {
      console.log('🔒 Offline login attempt...');
      try {
        const user = await getUser(userId);
        if (!user) {
          toast.error('No saved user found for offline login.');
          setLoading(false);
          return;
        }
        
        if (user.password !== password) {
          toast.error('Invalid credentials (offline)');
          setLoading(false);
          return;
        }

        // Check cached device approval status using fingerprint
        const cachedApproval = await getDeviceApproval(deviceFingerprint);
        
        if (!cachedApproval) {
          toast.error('Device not registered. Connect to internet to register this device.');
          setLoading(false);
          return;
        }

        if (cachedApproval.user_id !== userId) {
          toast.error('Device registered to different user. Contact administrator.');
          setLoading(false);
          return;
        }

        if (!cachedApproval.approved) {
          setDeviceStatus('pending');
          setCurrentDeviceId(deviceFingerprint);
          toast.error('Device not approved. Connect to internet to check approval status.');
          setLoading(false);
          return;
        }

        console.log('✅ Offline login success with approved device:', user.user_id);
        setDeviceStatus('approved');
        onLogin(user, true);
        toast.success('Offline login successful');
      } catch (err) {
        console.error('Offline login error:', err);
        toast.error('Offline login failed');
      }
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#667eea] to-[#764ba2]">
      <div className="bg-white rounded-xl p-8 w-full max-w-md shadow-2xl">
        <h2 className="text-3xl font-bold mb-6 text-center text-[#667eea]">
          🥛 Milk Collection
        </h2>
        
        {deviceStatus === 'pending' && (
          <div className="mb-6 p-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⏳</span>
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-800 mb-2">Device Pending Approval</h3>
                <p className="text-sm text-yellow-700 mb-2">
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
          <div className="mb-4 p-3 bg-green-50 border border-green-400 rounded-lg text-center">
            <span className="text-green-700 font-semibold">✓ Device Approved</span>
          </div>
        )}
        
        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="text"
            placeholder="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#667eea]"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#667eea]"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#667eea] text-white rounded-lg font-semibold hover:bg-[#5568d3] transition-colors disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
};
