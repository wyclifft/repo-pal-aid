import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface PendingDevice {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  approved: boolean;
  created_at: string;
  last_used: string;
}

export const DeviceApproval = () => {
  const [devices, setDevices] = useState<PendingDevice[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPendingDevices = async () => {
    try {
      const { data, error } = await supabase
        .from('approved_devices')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDevices(data || []);
    } catch (err) {
      console.error('Error fetching devices:', err);
      toast.error('Failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingDevices();
  }, []);

  const handleApprove = async (deviceId: string, userId: string, currentDeviceId: string) => {
    try {
      const { error } = await supabase
        .from('approved_devices')
        .update({ 
          approved: true,
          approved_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('device_id', currentDeviceId);

      if (error) throw error;
      
      toast.success('Device approved successfully');
      fetchPendingDevices();
    } catch (err) {
      console.error('Error approving device:', err);
      toast.error('Failed to approve device');
    }
  };

  const handleReject = async (userId: string, currentDeviceId: string) => {
    try {
      const { error } = await supabase
        .from('approved_devices')
        .delete()
        .eq('user_id', userId)
        .eq('device_id', currentDeviceId);

      if (error) throw error;
      
      toast.success('Device rejected and removed');
      fetchPendingDevices();
    } catch (err) {
      console.error('Error rejecting device:', err);
      toast.error('Failed to reject device');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-[#667eea] to-[#764ba2]">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-6">Device Approval Management</h1>
        
        <div className="grid gap-4">
          {devices.map((device) => (
            <Card key={device.id} className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold">{device.device_name}</h3>
                    <span className={`px-3 py-1 rounded-full text-sm ${
                      device.approved 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {device.approved ? 'Approved' : 'Pending'}
                    </span>
                  </div>
                  
                  <div className="text-sm text-gray-600 space-y-1">
                    <p><strong>User ID:</strong> {device.user_id}</p>
                    <p><strong>Device ID:</strong> {device.device_id.substring(0, 50)}...</p>
                    <p><strong>Requested:</strong> {new Date(device.created_at).toLocaleString()}</p>
                    <p><strong>Last Used:</strong> {new Date(device.last_used).toLocaleString()}</p>
                  </div>
                </div>
                
                {!device.approved && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleApprove(device.id, device.user_id, device.device_id)}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      Approve
                    </Button>
                    <Button
                      onClick={() => handleReject(device.user_id, device.device_id)}
                      variant="destructive"
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
          
          {devices.length === 0 && (
            <Card className="p-8 text-center text-gray-500">
              No devices found
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
