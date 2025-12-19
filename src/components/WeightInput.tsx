import { useState, useEffect } from 'react';
import { connectBluetoothScale, type ScaleType } from '@/services/bluetooth';
import { toast } from 'sonner';
import { Scale } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

interface WeightInputProps {
  weight: number;
  onWeightChange: (weight: number) => void;
  currentUserRole: string;
  onEntryTypeChange: (entryType: 'scale' | 'manual') => void;
  lastSavedWeight: number;
  lastEntryType: 'scale' | 'manual';
}

export const WeightInput = ({ weight, onWeightChange, currentUserRole, onEntryTypeChange, lastSavedWeight, lastEntryType }: WeightInputProps) => {
  const [manualWeight, setManualWeight] = useState('');
  const [scaleConnected, setScaleConnected] = useState(false);
  const [scaleType, setScaleType] = useState<ScaleType>('Unknown');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnectScale = async () => {
    setIsConnecting(true);
    const result = await connectBluetoothScale((newWeight, type) => {
      onWeightChange(newWeight);
      setManualWeight(newWeight.toFixed(1));
      onEntryTypeChange('scale');
    });

    if (result.success) {
      setScaleConnected(true);
      setScaleType(result.type);
      toast.success(`Scale Connected (${result.type}) ✅`);
    } else {
      toast.error(result.error || 'Failed to connect scale');
    }
    setIsConnecting(false);
  };

  const handleManualWeight = () => {
    const manual = parseFloat(manualWeight);
    if (!isNaN(manual) && manual > 0) {
      onWeightChange(manual);
      onEntryTypeChange('manual');
      toast.success('Manual weight applied');
    } else {
      toast.error('Enter valid weight');
    }
  };

  // Check if Bluetooth is available (Web Bluetooth or Capacitor native)
  const isBluetoothAvailable = Capacitor.isNativePlatform() || ('bluetooth' in navigator);

  // Determine scale status for visual feedback (now applies to both scale and manual)
  const isScaleReady = weight === 0 && lastSavedWeight > 0;
  const isScaleNotReady = weight > 0 && lastSavedWeight > 0;
  const showScaleStatus = lastSavedWeight > 0;

  return (
    <div className="bg-white rounded-xl p-6 shadow-lg">
      <h3 className="text-xl font-bold mb-4 text-[#667eea] flex items-center gap-2">
        <Scale className="h-6 w-6" />
        Milk Weight
      </h3>

      {/* Scale Status Indicator */}
      {showScaleStatus && (
        <div className={`mb-4 p-3 rounded-lg border-2 ${
          isScaleReady 
            ? 'bg-green-50 border-green-500' 
            : 'bg-amber-50 border-amber-500'
        }`}>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              isScaleReady ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
            }`} />
            <p className={`font-semibold ${
              isScaleReady ? 'text-green-700' : 'text-amber-700'
            }`}>
              {isScaleReady ? '✓ Scale Ready - Clear for Next Collection' : '⚠ Scale Not Ready - Remove Container'}
            </p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <p className="text-3xl font-bold text-[#667eea] mb-4">
          Weight: {weight.toFixed(1)} Kg
        </p>
        
        {isBluetoothAvailable && (
          <>
            <button
              onClick={handleConnectScale}
              disabled={isConnecting}
              className="w-full py-3 bg-[#667eea] text-white rounded-lg font-semibold hover:bg-[#5568d3] transition-colors mb-2 disabled:opacity-50"
            >
              {isConnecting ? 'Connecting...' : 'Connect Bluetooth Scale'}
            </button>
            <p className="text-sm text-gray-600 text-center">
              Scale: {scaleConnected ? `Connected (${scaleType}) ✅` : 'Not Connected'}
            </p>
          </>
        )}
      </div>

      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <p className="text-sm font-semibold text-gray-700 mb-2">Manual Weight Entry</p>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            placeholder="Manual Weight (Kg)"
            step="0.1"
            value={manualWeight}
            onChange={(e) => setManualWeight(e.target.value)}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-[#667eea]"
          />
          <button
            onClick={handleManualWeight}
            className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
