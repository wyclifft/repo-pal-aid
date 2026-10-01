import { useState, useEffect, memo } from 'react';
import { Mail, Eye, EyeOff, Copy, Smartphone } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { type AppUser } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { toast } from 'sonner';
import { generateDeviceFingerprint, getStoredDeviceId, setStoredDeviceId, getDeviceName, collectHardwareBundle, type DeviceHardwareBundle } from '@/utils/deviceFingerprint';
import { storeDeviceConfig, syncOfflineCounter } from '@/utils/referenceGenerator';
import { hashPassword, hashesEqual } from '@/utils/passwordHash';
import { requestBluetoothPermission } from '@/utils/permissionRequests';
import loginBg from '@/assets/login-bg.jpg';

interface LoginProps {
  onLogin: (user: AppUser, isOffline: boolean, password?: string) => void;
}

export const Login = memo(({ onLogin }: LoginProps) => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<'pending' | 'approved' | null>(() => {
    const cached = localStorage.getItem('device_authorized');
    return cached === 'true' ? 'approved' : null;
  });
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const [displayFingerprint, setDisplayFingerprint] = useState<string>(() => getStoredDeviceId() || '');
  const { isReady, saveUser, getUser, saveDeviceApproval, getDeviceApproval } = useIndexedDB();

  // Load device fingerprint immediately on mount so it displays above the User ID field
  useEffect(() => {
    generateDeviceFingerprint().then((fp) => {
      if (fp) setDisplayFingerprint(fp);
    }).catch(() => {});
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
    let deviceFingerprint = getStoredDeviceId();
    if (!deviceFingerprint) {
      deviceFingerprint = await generateDeviceFingerprint();
      setStoredDeviceId(deviceFingerprint);
    }
    
    console.log('Device fingerprint:', deviceFingerprint);

    // Check cached device approval (fire and forget - don't block)
    const cachedApprovalPromise = getDeviceApproval(deviceFingerprint).catch(() => null);
    
    const performOfflineLogin = async () => {
      console.log('[OFFLINE] Offline login attempt for user:', userId);

      const { getCachedUsersMap, CACHED_USERS_MAP_KEY } = await import('@/utils/companyUsersCache');
      const usersMap = getCachedUsersMap();
      const normInputUserId = userId.toLowerCase().trim();
      let cachedCreds = usersMap[normInputUserId];

      if (!cachedCreds) {
        // Fallback search: numeric unpadded match or trim match
        const unpadded = normInputUserId.replace(/^0+/, '');
        const matchedKey = Object.keys(usersMap).find(k => {
          const cleanK = k.toLowerCase().trim();
          return cleanK === normInputUserId || (unpadded && cleanK.replace(/^0+/, '') === unpadded);
        });
        if (matchedKey) {
          cachedCreds = usersMap[matchedKey];
        }
      }

      if (!cachedCreds) {
        console.log('[OFFLINE] No cached credentials found for user:', userId);
        toast.error('No offline credentials found for this user. First login or sync must be done online.');
        setLoading(false);
        return;
      }

      try {
        console.log('[OFFLINE] Found cached credentials for user:', cachedCreds.user_id);

        const cleanInputPassword = (password || '').toString().trim();
        let passwordMatch = false;

        // 1. Check SHA-256 hash match (exact, lowercase, uppercase to account for MySQL case-insensitive collation)
        if (cachedCreds.passwordHash) {
          const inputHash = await hashPassword(cachedCreds.user_id, cleanInputPassword);
          passwordMatch = hashesEqual(inputHash, cachedCreds.passwordHash);

          if (!passwordMatch && cleanInputPassword) {
            const inputHashLower = await hashPassword(cachedCreds.user_id, cleanInputPassword.toLowerCase());
            passwordMatch = hashesEqual(inputHashLower, cachedCreds.passwordHash);
          }

          if (!passwordMatch && cleanInputPassword) {
            const inputHashUpper = await hashPassword(cachedCreds.user_id, cleanInputPassword.toUpperCase());
            passwordMatch = hashesEqual(inputHashUpper, cachedCreds.passwordHash);
          }
        }

        // 2. Fallback to plaintext string match (case-insensitive)
        if (!passwordMatch && cachedCreds.password) {
          const cleanCachedPassword = cachedCreds.password.toString().trim();
          passwordMatch = (
            cleanCachedPassword === cleanInputPassword ||
            cleanCachedPassword.toLowerCase() === cleanInputPassword.toLowerCase()
          );
          if (passwordMatch) {
            const upgradedHash = await hashPassword(cachedCreds.user_id, cleanInputPassword);
            if (upgradedHash) {
              cachedCreds.passwordHash = upgradedHash;
              cachedCreds.password = cleanInputPassword;
              usersMap[normInputUserId] = cachedCreds;
              localStorage.setItem(CACHED_USERS_MAP_KEY || 'cachedUsersMap', JSON.stringify(usersMap));
              console.log('[OFFLINE] Upgraded credential cache to hashed form for:', cachedCreds.user_id);
            }
          }
        }

        if (!passwordMatch) {
          console.log('[OFFLINE] Credential mismatch for user:', userId);
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
          admin: Boolean(cachedCreds.admin),
          supervisor: typeof cachedCreds.supervisor === 'number' ? cachedCreds.supervisor : 0,
          dcode: cachedCreds.dcode || '',
          groupid: cachedCreds.groupid || '',
          depart: cachedCreds.depart || '',
          can_access_payments: Boolean(cachedCreds.can_access_payments),
          company_analysis: cachedCreds.company_analysis !== undefined ? Boolean(cachedCreds.company_analysis) : true
        };

        console.log('👤 Offline login - Cached user data:', {
          user_id: user.user_id,
          admin: user.admin,
          supervisor: user.supervisor,
          role: user.role
        });

        // For offline login, try to get cached device approval
        let cachedApproval = null;
        try {
          if (isReady) {
            cachedApproval = await getDeviceApproval(deviceFingerprint);
          }
        } catch (dbError) {
          console.warn('IndexedDB not available for offline login, using localStorage fallback');
        }

        if (cachedApproval && !cachedApproval.approved) {
          setDeviceStatus('pending');
          setCurrentDeviceId(deviceFingerprint);
          toast.error('Device pending approval. Connect to internet to check status.');
          setLoading(false);
          return;
        }

        // Save approval to localStorage for offline access
        localStorage.setItem('device_approved', 'true');
        localStorage.setItem('device_user_id', user.user_id);

        console.log('✅ Offline login success for user:', user.user_id);
        setDeviceStatus('approved');

        // Prompt for Android Bluetooth connectivity permissions on login if not yet granted
        if (Capacitor.isNativePlatform()) {
          requestBluetoothPermission().catch((err) => {
            console.warn('[BT][PERMS] Bluetooth permission request on offline login error:', err);
          });
        }

        onLogin(user, true);
        toast.success('Offline login successful');
        setLoading(false);
      } catch (err) {
        console.error('Offline login error:', err);
        toast.error('Offline login failed. Please try again.');
        setLoading(false);
      }
    };

    if (navigator.onLine) {
      try {
        // v2.10.109 — STABLE DEVICE IDENTITY (reinstall recovery).
        // Before falling back to the legacy lookup, ask the server if it can
        // recognize this physical device by its SSAID/hardware bundle. If
        // yes, we rehydrate the ORIGINAL device_fingerprint + devcode +
        // counters instead of letting a wiped device get a fresh identity
        // that would risk TRNID/MILKID collisions. Strictly additive — on
        // 404 / old backend / network error we fall through to the existing
        // getByFingerprint path unchanged.
        let resolveBundlePromise: Promise<DeviceHardwareBundle> | null = null;
        try {
          resolveBundlePromise = collectHardwareBundle();
        } catch (e) {
          console.warn('[DEVICE][RESOLVE] hw bundle collection failed:', e);
        }

        let resolvedFromServer: any = null;
        if (resolveBundlePromise) {
          try {
            const bundle = await Promise.race([
              resolveBundlePromise,
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
            ]);
            if (bundle) {
              resolvedFromServer = await Promise.race([
                mysqlApi.devices.resolveIdentity(bundle),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
              ]).catch(() => null);
              if (resolvedFromServer?.resolved_fingerprint && resolvedFromServer.resolved_fingerprint !== deviceFingerprint) {
                console.log(`[DEVICE][RESOLVE] hit — rehydrating fingerprint ${resolvedFromServer.resolved_fingerprint.substring(0, 12)}… (was ${deviceFingerprint.substring(0, 12)}…)`);
                deviceFingerprint = resolvedFromServer.resolved_fingerprint;
                try { setStoredDeviceId(deviceFingerprint); } catch { /* ignore */ }
              }
            }
          } catch (e) {
            console.warn('[DEVICE][RESOLVE] non-fatal failure:', e);
          }
        }

        // OPTIMIZED: Run auth and device check in PARALLEL with short timeout.
        // If resolveIdentity already produced full device data, reuse it and
        // skip the secondary fingerprint lookup.
        const authPromise = mysqlApi.auth.login(userId, password, deviceFingerprint);
        const deviceCheckPromise = resolvedFromServer
          ? Promise.resolve(resolvedFromServer)
          : Promise.race([
              mysqlApi.devices.getByFingerprint(deviceFingerprint),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)) // 2s timeout for device
            ]);

        // Wait for auth (critical) while device check runs in parallel
        const [authResponse, deviceData] = await Promise.all([
          authPromise,
          deviceCheckPromise.catch(() => null) // Don't fail if device check fails
        ]);

        if (!authResponse.success || !authResponse.data) {
          // If it's a network issue or timeout, aggressively fallback to offline mode
          if (authResponse.error?.includes('timed out') ||
              authResponse.error?.toLowerCase().includes('network') ||
              authResponse.error?.toLowerCase().includes('fetch')) {
            console.warn('[LOGIN] Network error/timeout during online login. Falling back to offline mode.');
            toast.warning('Slow network detected. Falling back to offline mode for fast operation.');
            await performOfflineLogin();
            return;
          }

          toast.error(authResponse.error || 'Invalid credentials');
          setLoading(false);
          return;
        }

        const userData = authResponse.data;
        let needsRegistration = false;
        let resolvedDeviceData = deviceData;

        // v2.10.97 — STRICT COMPANY ISOLATION (ccode).
        // If both the authenticated user and the device carry a ccode, they MUST match.
        // Prevents a user assigned to company A from logging in on a device approved
        // for company B. Backend also enforces this on /api/auth/login when a device
        // fingerprint is supplied, but we double-check on the client so the rejection
        // is immediate and the offline credential cache is never written.
        const userCcode = (userData?.ccode || '').toString().trim().toUpperCase();
        const rawDeviceCcode = (resolvedDeviceData?.ccode || '').toString().trim().toUpperCase();
        const deviceCcode = (rawDeviceCcode && rawDeviceCcode !== '000' && rawDeviceCcode !== '0') ? rawDeviceCcode : null;

        if (userCcode && deviceCcode && userCcode !== deviceCcode) {
          console.warn('[AUTH][CCODE] Mismatch — user:', userCcode, 'device:', deviceCcode);
          toast.error('Access denied. Your account is restricted to your assigned company.');
          setLoading(false);
          return;
        }

        // Process device data (already fetched in parallel)
        if (resolvedDeviceData && resolvedDeviceData.id) {
          // Device is registered - cache approval asynchronously (fire and forget)
          saveDeviceApproval(deviceFingerprint, resolvedDeviceData.id, userId, resolvedDeviceData.approved).catch(() => {});
          
          if (!resolvedDeviceData.approved) {
            setDeviceStatus('pending');
            setCurrentDeviceId(deviceFingerprint);
            toast.error('Device pending approval. Contact administrator.');
            setLoading(false);
            return;
          }

          setDeviceStatus('approved');
          
          // Store device config before syncing counters to avoid race condition
          if (resolvedDeviceData.company_name && resolvedDeviceData.devcode) {
            await storeDeviceConfig(resolvedDeviceData.company_name, resolvedDeviceData.devcode);
          }
          if (resolvedDeviceData.devcode) {
            localStorage.setItem('devcode', resolvedDeviceData.devcode);
            // Sync counters in background (fire and forget).
            // Note: 0/null both → undefined, so syncOfflineCounter keeps the local counter.
            //       The backend GREATEST(devsettings.trnid, MAX(transrefno)) self-heals on next call.
            const lastTrnId = resolvedDeviceData.trnid ? parseInt(String(resolvedDeviceData.trnid), 10) : undefined;
            const lastMilkId = resolvedDeviceData.milkid ? parseInt(String(resolvedDeviceData.milkid), 10) : undefined;
            const lastStoreId = resolvedDeviceData.storeid ? parseInt(String(resolvedDeviceData.storeid), 10) : undefined;
            const lastAiId = resolvedDeviceData.aiid ? parseInt(String(resolvedDeviceData.aiid), 10) : undefined;
            syncOfflineCounter(resolvedDeviceData.devcode, lastTrnId, lastMilkId, lastStoreId, lastAiId).catch(() => {});
          }
          
          // Update last sync timestamp (fire and forget)
          mysqlApi.devices.update(resolvedDeviceData.id, { user_id: userId }).catch(() => {});
        } else if (resolvedDeviceData && !resolvedDeviceData.id) {
          console.log('Device in devsettings but not approved_devices - needs registration');
          needsRegistration = true;
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
            // New device - register in background with short timeout.
            // v2.10.111: include hardware bundle so backend can recover the
            // ORIGINAL approved row (by ssaid) instead of creating a
            // duplicate pending device.
            try {
              const deviceName = getDeviceName();
              let regBundle: DeviceHardwareBundle | null = null;
              try {
                regBundle = await Promise.race([
                  collectHardwareBundle(),
                  new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
                ]);
              } catch { /* ignore */ }

              const registerResult = await Promise.race([
                mysqlApi.devices.register({
                  device_fingerprint: deviceFingerprint,
                  user_id: userId,
                  approved: false,
                  device_info: deviceName,
                  ssaid: regBundle?.ssaid,
                  model: regBundle?.model,
                  manufacturer: regBundle?.manufacturer,
                  osVersion: regBundle?.osVersion,
                }),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500))
              ]);

              // v2.10.111: If server recovered an approved row by ssaid,
              // adopt its fingerprint and treat the device as approved.
              const recoveredFp = (registerResult as any)?.resolved_fingerprint;
              if (registerResult && registerResult.id && registerResult.approved && recoveredFp) {
                console.log(`[DEVICE][REGISTER] recovered approved fp ${String(recoveredFp).substring(0, 12)}… — rehydrating`);
                deviceFingerprint = recoveredFp;
                try { setStoredDeviceId(deviceFingerprint); } catch { /* ignore */ }
                saveDeviceApproval(deviceFingerprint, registerResult.id, userId, true).catch(() => {});
                setDeviceStatus('approved');
                // Rehydrate device config + counters from recovered row
                const rec: any = registerResult;
                if (rec.company_name && rec.devcode) {
                  try { await storeDeviceConfig(rec.company_name, rec.devcode); } catch { /* ignore */ }
                }
                if (rec.devcode) {
                  localStorage.setItem('devcode', rec.devcode);
                  const lastTrnId = rec.trnid ? parseInt(String(rec.trnid), 10) : undefined;
                  const lastMilkId = rec.milkid ? parseInt(String(rec.milkid), 10) : undefined;
                  const lastStoreId = rec.storeid ? parseInt(String(rec.storeid), 10) : undefined;
                  const lastAiId = rec.aiid ? parseInt(String(rec.aiid), 10) : undefined;
                  syncOfflineCounter(rec.devcode, lastTrnId, lastMilkId, lastStoreId, lastAiId).catch(() => {});
                }
                resolvedDeviceData = registerResult;
              } else if (registerResult && registerResult.id) {
                console.log('Device registered with ID:', registerResult.id);
                // Save approval in background
                saveDeviceApproval(deviceFingerprint, registerResult.id, userId, false).catch(() => {});
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
          supervisor: supervisorMode,
          password,
          role: isAdmin ? 'admin' : 'user'
        };
        
        console.log('👤 Login successful - User data:', {
          user_id: userData.user_id,
          admin: userData.admin,
          supervisor: supervisorMode,
          role: userWithPassword.role
        });
        
        saveUser(userWithPassword);

        // Prompt for Android Bluetooth connectivity permissions on login if not yet granted
        if (Capacitor.isNativePlatform()) {
          requestBluetoothPermission().catch((err) => {
            console.warn('[BT][PERMS] Bluetooth permission request on login error:', err);
          });
        }

        onLogin(userWithPassword, false, password); // Pass password to cache credentials

        // Sync all company users in background for offline use
        mysqlApi.auth.syncCompanyUsers(deviceFingerprint, userData.ccode)
          .then(async (res) => {
            if (res.success && res.data?.length) {
              const { cacheCompanyUsers } = await import('@/utils/companyUsersCache');
              await cacheCompanyUsers(res.data);
            }
          })
          .catch((e) => console.warn('[AUTH] Background user sync failed:', e));

        toast.success('Login successful');
      } catch (err: any) {
  console.error("=================================");
  console.error("LOGIN ERROR");
  console.error("message:", err?.message);
  console.error("stack:", err?.stack);
  console.error("full:", JSON.stringify(err));
  console.error(err);
  console.error("=================================");

  // Detect network error and fallback to offline mode
  if (err?.message?.includes('fetch') || err?.message?.toLowerCase().includes('network') || err?.name === 'TypeError') {
    console.warn('[LOGIN] Network error exception during online login. Falling back to offline mode.');
    toast.warning('Network error detected. Falling back to offline mode.');
    await performOfflineLogin();
    return;
  }

  toast.error("Login failed. Check credentials.");
}    } else {
      await performOfflineLogin();
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
          <div className="mb-3 p-3 bg-yellow-50 border-2 border-yellow-400 rounded-lg max-w-sm w-full">
            <div className="flex items-start gap-2.5">
              <span className="text-xl">⏳</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-yellow-800 mb-0.5 text-xs">Device Pending Approval</h3>
                <p className="text-[11px] text-yellow-700 mb-1.5">
                  Your device is waiting for administrator approval.
                </p>
                <div className="bg-white p-2 rounded border border-yellow-300">
                  <p className="text-[10px] font-mono text-gray-800 break-all select-all">
                    <strong>Device ID:</strong> {currentDeviceId || displayFingerprint}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {deviceStatus === 'approved' && (
          <div className="mb-3 p-2.5 bg-green-50 border border-green-400 rounded-lg text-center max-w-sm w-full">
            <span className="text-green-700 font-semibold text-xs">✓ Device Approved</span>
          </div>
        )}
        
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-3">
          {/* Device Fingerprint Card directly on top of User ID field — ONLY rendered BEFORE device authorization */}
          {deviceStatus !== 'approved' && (
            <div className="bg-white/95 border border-purple-200 rounded-lg p-2.5 shadow-sm text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold text-purple-900 text-xs">
                  <Smartphone className="h-3.5 w-3.5 text-[#7B68A6]" />
                  Device Fingerprint
                </span>
                {(displayFingerprint || currentDeviceId) && (
                  <button
                    type="button"
                    onClick={() => {
                      const textToCopy = currentDeviceId || displayFingerprint;
                      if (textToCopy) {
                        navigator.clipboard.writeText(textToCopy);
                        toast.success('Fingerprint copied to clipboard');
                      }
                    }}
                    className="flex items-center gap-1 text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded border border-purple-200 transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                )}
              </div>
              <div className="font-mono text-[11px] font-bold text-gray-800 break-all bg-purple-50/70 p-1.5 rounded border border-purple-100 select-all">
                {displayFingerprint || currentDeviceId || 'Loading device fingerprint...'}
              </div>
            </div>
          )}

          {/* User ID Field */}
          <div className="relative">
            <input
              type="number"
              id="userid"
              name="userid"
              autoComplete="off"
              placeholder="User ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full px-4 py-3.5 pr-12 bg-white/90 border border-gray-300 rounded-md focus:outline-none focus:border-[#7B68A6] text-base min-h-[52px]"
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
