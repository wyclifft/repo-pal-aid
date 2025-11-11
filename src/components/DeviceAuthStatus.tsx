import { useState, useEffect } from 'react';
import { Shield, ShieldAlert, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';

interface DeviceAuthStatusProps {
  onCompanyNameChange?: (companyName: string) => void;
}

export const DeviceAuthStatus = ({ onCompanyNameChange }: DeviceAuthStatusProps) => {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [companyName, setCompanyName] = useState<string>('Unknown');
  const [loading, setLoading] = useState(true);

  const checkAuthorization = async () => {
    try {
      const fingerprint = await generateDeviceFingerprint();
      const apiUrl = 'https://backend.maddasystems.co.ke';
      
      // Load cached company name from localStorage
      const cachedCompanyName = localStorage.getItem('device_company_name');
      if (cachedCompanyName) {
        setCompanyName(cachedCompanyName);
        onCompanyNameChange?.(cachedCompanyName);
      }
      
      const response = await fetch(
        `${apiUrl}/api/devices/fingerprint/${encodeURIComponent(fingerprint)}`
      );
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Authorization check returned non-JSON response');
        setIsAuthorized(null);
        return;
      }
      
      if (response.ok) {
        const data = await response.json();
        console.log('API Response:', data);
        
        if (data.success && data.data) {
          setIsAuthorized(data.data.authorized === 1);
          
          // Always update company name from response (default to 'Unknown' if null)
          const fetchedCompanyName = data.data.company_name || 'Unknown';
          console.log('Fetched company name:', fetchedCompanyName);
          setCompanyName(fetchedCompanyName);
          onCompanyNameChange?.(fetchedCompanyName);
          
          // Cache company name in localStorage
          localStorage.setItem('device_company_name', fetchedCompanyName);
        } else {
          setIsAuthorized(false);
        }
      } else {
        console.error('API request failed with status:', response.status);
        setIsAuthorized(false);
      }
    } catch (error) {
      console.error('Authorization check failed:', error);
      setIsAuthorized(null);
      // Keep using cached company name if offline
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
