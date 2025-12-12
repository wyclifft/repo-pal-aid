import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, ShieldAlert, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { storeDeviceConfig, hasDeviceConfig } from '@/utils/referenceGenerator';

interface DeviceAuthStatusProps {
  onCompanyNameChange?: (companyName: string) => void;
  onAuthorizationChange?: (authorized: boolean) => void;
}

export const DeviceAuthStatus = ({ onCompanyNameChange, onAuthorizationChange }: DeviceAuthStatusProps) => {
  // Initialize from localStorage immediately for instant display
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(() => {
    const cached = localStorage.getItem('device_authorized');
    return cached ? JSON.parse(cached) : null;
  });
  const [companyName, setCompanyName] = useState<string>(() => {
    return localStorage.getItem('device_company_name') || '';
  });
  const [loading, setLoading] = useState(() => {
    // Only show loading if no cached data exists
    return !localStorage.getItem('device_company_name');
  });
  const hasInitialized = useRef(false);

  const initializeDeviceConfig = useCallback(async (companyNameValue: string, deviceCode: string) => {
    try {
      await storeDeviceConfig(companyNameValue, deviceCode);
      console.log('✅ Device config initialized for offline generation');
    } catch (error) {
      console.error('⚠️ Failed to initialize device config:', error);
    }
  }, []);

  const checkAuthorization = useCallback(async () => {
    try {
      const fingerprint = await generateDeviceFingerprint();
      const apiUrl = 'https://backend.maddasystems.co.ke';
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(
        `${apiUrl}/api/devices/fingerprint/${encodeURIComponent(fingerprint)}`,
        { signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Authorization check returned non-JSON response - keeping cached status');
        setLoading(false);
        return;
      }
      
      if (response.ok) {
        const data = await response.json();
        console.log('API Response:', data);
        
        if (data.success && data.data) {
          const authorized = data.data.authorized === 1;
          setIsAuthorized(authorized);
          onAuthorizationChange?.(authorized);
          localStorage.setItem('device_authorized', JSON.stringify(authorized));
          
          const fetchedCompanyName = data.data.company_name || 'DAIRY COLLECTION';
          console.log('Fetched company name:', fetchedCompanyName);
          setCompanyName(fetchedCompanyName);
          onCompanyNameChange?.(fetchedCompanyName);
          localStorage.setItem('device_company_name', fetchedCompanyName);
          
          if (authorized) {
            const deviceCode = String(data.data.uniquedevcode || '00000').slice(-5);
            await initializeDeviceConfig(fetchedCompanyName, deviceCode);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.warn('Authorization check timed out - using cached values');
      } else {
        console.error('Authorization check failed:', error);
      }
    } finally {
      setLoading(false);
    }
  }, [onAuthorizationChange, onCompanyNameChange, initializeDeviceConfig]);

  // Immediately notify parent of cached values on mount
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    
    // Immediately notify parent with cached values
    const cachedCompanyName = localStorage.getItem('device_company_name');
    const cachedAuthorized = localStorage.getItem('device_authorized');
    
    if (cachedCompanyName) {
      onCompanyNameChange?.(cachedCompanyName);
    }
    if (cachedAuthorized) {
      onAuthorizationChange?.(JSON.parse(cachedAuthorized));
    }
    
    // Then check for updates from server
    checkAuthorization();
    
    // Recheck every 60 seconds (less frequent for stability)
    const interval = setInterval(checkAuthorization, 60000);
    
    return () => clearInterval(interval);
  }, [checkAuthorization, onCompanyNameChange, onAuthorizationChange]);

  if (loading && !companyName) {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Loading...</span>
      </Badge>
    );
  }

  const displayName = companyName || 'DAIRY COLLECTION';

  if (isAuthorized === null) {
    return (
      <Badge variant="outline" className="gap-1">
        <ShieldAlert className="h-3 w-3" />
        <span className="text-xs">{displayName}</span>
      </Badge>
    );
  }

  if (isAuthorized) {
    return (
      <Badge variant="outline" className="gap-1 bg-green-50 border-green-200 text-green-700">
        <Shield className="h-3 w-3" />
        <span className="text-xs">{displayName}</span>
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1 bg-red-50 border-red-200 text-red-700">
      <ShieldAlert className="h-3 w-3" />
      <span className="text-xs">{displayName}</span>
    </Badge>
  );
};
