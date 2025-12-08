import { useState, useEffect, useCallback } from 'react';
import { Shield, ShieldAlert, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { storeDeviceConfig, hasDeviceConfig } from '@/utils/referenceGenerator';

interface DeviceAuthStatusProps {
  onCompanyNameChange?: (companyName: string) => void;
  onAuthorizationChange?: (authorized: boolean) => void;
}

export const DeviceAuthStatus = ({ onCompanyNameChange, onAuthorizationChange }: DeviceAuthStatusProps) => {
  // Initialize from localStorage to persist across navigation
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(() => {
    const cached = localStorage.getItem('device_authorized');
    return cached ? JSON.parse(cached) : null;
  });
  const [companyName, setCompanyName] = useState<string>(() => {
    return localStorage.getItem('device_company_name') || 'Unknown';
  });
  const [loading, setLoading] = useState(true);

  const initializeDeviceConfig = useCallback(async (companyNameValue: string, deviceCode: string) => {
    try {
      // Always attempt to store config on authorization
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
      
      const response = await fetch(
        `${apiUrl}/api/devices/fingerprint/${encodeURIComponent(fingerprint)}`
      );
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Authorization check returned non-JSON response - keeping cached status');
        return;
      }
      
      if (response.ok) {
        const data = await response.json();
        console.log('API Response:', data);
        
        if (data.success && data.data) {
          const authorized = data.data.authorized === 1;
          setIsAuthorized(authorized);
          onAuthorizationChange?.(authorized);
          
          // Cache authorization status
          localStorage.setItem('device_authorized', JSON.stringify(authorized));
          
          // Always update company name from response (default to 'Unknown' if null)
          const fetchedCompanyName = data.data.company_name || 'Unknown';
          console.log('Fetched company name:', fetchedCompanyName);
          setCompanyName(fetchedCompanyName);
          onCompanyNameChange?.(fetchedCompanyName);
          
          // Cache company name in localStorage
          localStorage.setItem('device_company_name', fetchedCompanyName);
          
          // Store device config for offline reference generation (critical for first install)
          if (authorized) {
            const deviceCode = String(data.data.uniquedevcode || '00000').slice(-5);
            // Initialize config immediately - this is critical for first install
            await initializeDeviceConfig(fetchedCompanyName, deviceCode);
          }
        }
        // If data structure is invalid, keep cached values
      }
      // If response not ok, keep cached values
    } catch (error) {
      console.error('Authorization check failed:', error);
      // Keep using cached values when offline or on error
    } finally {
      setLoading(false);
    }
  }, [onAuthorizationChange, onCompanyNameChange, initializeDeviceConfig]);

  useEffect(() => {
    // Check if we have device config on mount (for first install detection)
    const checkFirstInstall = async () => {
      const hasConfig = await hasDeviceConfig();
      if (!hasConfig) {
        console.log('📱 First install detected - will initialize config on authorization');
      }
    };
    
    checkFirstInstall();
    checkAuthorization();
    
    // Recheck every 30 seconds
    const interval = setInterval(checkAuthorization, 30000);
    
    return () => clearInterval(interval);
  }, [checkAuthorization]);

  if (loading) {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">Checking...</span>
      </Badge>
    );
  }

  if (isAuthorized === null) {
    return (
      <Badge variant="outline" className="gap-1">
        <ShieldAlert className="h-3 w-3" />
        <span className="text-xs">{companyName}</span>
      </Badge>
    );
  }

  if (isAuthorized) {
    return (
      <Badge variant="outline" className="gap-1 bg-green-50 border-green-200 text-green-700">
        <Shield className="h-3 w-3" />
        <span className="text-xs">{companyName}</span>
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="gap-1 bg-red-50 border-red-200 text-red-700">
      <ShieldAlert className="h-3 w-3" />
      <span className="text-xs">{companyName}</span>
    </Badge>
  );
};
