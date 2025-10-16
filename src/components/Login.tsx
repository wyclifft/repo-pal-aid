import { useState } from 'react';
import { supabase, type AppUser } from '@/lib/supabase';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { toast } from 'sonner';
import { generateDeviceFingerprint, getStoredDeviceId, setStoredDeviceId } from '@/utils/deviceFingerprint';

interface LoginProps {
  onLogin: (user: AppUser, isOffline: boolean) => void;
}

export const Login = ({ onLogin }: LoginProps) => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { isReady, saveUser, getUser } = useIndexedDB();

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

    // Get or generate device ID
    let deviceId = getStoredDeviceId();
    if (!deviceId) {
      deviceId = generateDeviceFingerprint();
      setStoredDeviceId(deviceId);
    }

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
          // Check if device is approved
          const { data: deviceData, error: deviceError } = await supabase
            .from('approved_devices')
            .select('*')
            .eq('user_id', userId)
            .eq('device_id', deviceId)
            .maybeSingle();

          if (deviceError && deviceError.code !== 'PGRST116') {
            throw deviceError;
          }

          if (!deviceData) {
            // New device - register it as pending approval
            await supabase.from('approved_devices').insert([{
              user_id: userId,
              device_id: deviceId,
              device_name: navigator.userAgent.substring(0, 100),
              approved: false,
            }]);
            
            toast.error('New device detected. Please wait for admin approval.');
            setLoading(false);
            return;
          }

          if (!deviceData.approved) {
            toast.error('Device pending approval. Contact administrator.');
            setLoading(false);
            return;
          }

          // Update last used timestamp
          await supabase
            .from('approved_devices')
            .update({ last_used: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('device_id', deviceId);

          const userWithPassword = { ...data, password };
          saveUser(userWithPassword);
          onLogin(data, false);
          toast.success('Login successful');
        } else {
          toast.error('Invalid credentials');
        }
      } catch (err) {
        console.error('Login error', err);
        toast.error('Login failed (online)');
      }
    } else {
      console.log('🔒 Offline login attempt...');
      try {
        const user = await getUser(userId);
        if (!user) {
          toast.error('No saved user found for offline login.');
        } else if (user.password === password) {
          console.log('✅ Offline login success:', user.user_id);
          onLogin(user, true);
          toast.success('Offline login successful');
        } else {
          toast.error('Invalid credentials (offline)');
        }
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
