import { useState, useEffect } from 'react';
import { Shield, ShieldAlert, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';

interface DeviceAuthStatusProps {
  onCompanyNameChange?: (companyName: string) => void;
}

export const DeviceAuthStatus = ({ onCompanyNameChange }: DeviceAuthStatusProps) => {
  // Initialize from localStorage to persist across navigation
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(() => {
    const cached = localStorage.getItem('device_authorized');
    return cached ? JSON.parse(cached) : null;
  });
  const [companyName, setCompanyName] = useState<string>(() => {
    return localStorage.getItem('device_company_name') || 'Unknown';
  });
  const [loading, setLoading] = useState(true);

  const checkAuthorization = async () => {
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
          
          // Cache authorization status
          localStorage.setItem('device_authorized', JSON.stringify(authorized));
          
          // Always update company name from response (default to 'Unknown' if null)
          const fetchedCompanyName = data.data.company_name || 'Unknown';
          console.log('Fetched company name:', fetchedCompanyName);
          setCompanyName(fetchedCompanyName);
          onCompanyNameChange?.(fetchedCompanyName);
          
          // Cache company name in localStorage
          localStorage.setItem('device_company_name', fetchedCompanyName);
          
          // Initialize batch reservation for fast reference generation
          if (authorized) {
            const { storeDeviceConfig, initializeReservation } = await import('@/utils/referenceGenerator');
            const deviceCode = String(data.data.uniquedevcode || '00000').slice(-5);
            await storeDeviceConfig(fetchedCompanyName, deviceCode);
            await initializeReservation(fingerprint);
            console.log('✅ Batch reservation initialized');
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
  };

  useEffect(() => {
    checkAuthorization();
    
    // Recheck every 30 seconds
    const interval = setInterval(checkAuthorization, 30000);
    
    return () => clearInterval(interval);
  }, []);

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
