import { useEffect, useState } from 'react';
import { mysqlApi, type ApprovedDevice } from '@/services/mysqlApi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const DeviceApproval = () => {
  const [devices, setDevices] = useState<ApprovedDevice[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPendingDevices = async () => {
    try {
      const response = await mysqlApi.devices.getAll();
      if (response.error) throw new Error(response.error);
      setDevices(response.data || []);
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

  const handleApprove = async (deviceId: number) => {
    try {
      const response = await mysqlApi.devices.approve(deviceId, true, new Date().toISOString());
      
      if (response.error) throw new Error(response.error);
      
      toast.success('Device approved successfully');
      fetchPendingDevices();
    } catch (err) {
      console.error('Error approving device:', err);
      toast.error('Failed to approve device');
    }
  };

  const handleReject = async (deviceId: number) => {
    try {
      const success = await mysqlApi.devices.delete(deviceId);
      
      if (!success) throw new Error('Failed to delete device');
      
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
                  <h3 className="text-lg font-semibold">{device.device_info || 'Unknown Device'}</h3>
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
                  <p><strong>Device Fingerprint:</strong> {device.device_fingerprint.substring(0, 50)}...</p>
                  <p><strong>Requested:</strong> {new Date(device.created_at).toLocaleString()}</p>
                  <p><strong>Last Updated:</strong> {new Date(device.updated_at).toLocaleString()}</p>
                </div>
              </div>
              
              {!device.approved && (
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleApprove(device.id)}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    Approve
                  </Button>
                  <Button
                    onClick={() => handleReject(device.id)}
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
