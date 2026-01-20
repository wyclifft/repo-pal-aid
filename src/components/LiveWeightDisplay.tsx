/**
 * LiveWeightDisplay - Shows scale weight directly in the weight field
 * Simplified display without connection controls (those remain in Settings)
 */

import { useEffect, useState } from 'react';
import { Scale, Loader2 } from 'lucide-react';
import { useScaleConnection } from '@/hooks/useScaleConnection';

interface LiveWeightDisplayProps {
  weight: number;
  onWeightChange: (weight: number) => void;
  onEntryTypeChange: (entryType: 'scale' | 'manual') => void;
  digitalDisabled?: boolean;
}

export const LiveWeightDisplay = ({
  weight,
  onWeightChange,
  onEntryTypeChange,
  digitalDisabled = false,
}: LiveWeightDisplayProps) => {
  const {
    scaleConnected,
    liveWeight,
    autoReconnect,
    isConnecting,
  } = useScaleConnection({ onWeightChange, onEntryTypeChange });
  
  const [hasReceivedData, setHasReceivedData] = useState(false);

  // Auto-reconnect on mount if we have a stored device
  useEffect(() => {
    if (!scaleConnected && !digitalDisabled) {
      autoReconnect();
    }
  }, []);
  
  // Track when we receive data from scale
  useEffect(() => {
    if (scaleConnected && liveWeight !== undefined) {
      setHasReceivedData(true);
    }
  }, [scaleConnected, liveWeight]);

  // Reset data received flag when disconnected
  useEffect(() => {
    if (!scaleConnected) {
      setHasReceivedData(false);
    }
  }, [scaleConnected]);

  return (
    <div className="flex gap-2">
      {/* Kgs Label Box */}
      <div className="flex-1 bg-white border-2 border-gray-800 rounded-lg p-4 sm:p-6 flex items-center justify-center">
        <span className="text-2xl sm:text-3xl font-bold">Kgs</span>
      </div>
      
      {/* Weight Value Box */}
      <div className={`flex-1 border-2 rounded-lg p-4 sm:p-6 flex flex-col items-center justify-center transition-colors ${
        scaleConnected 
          ? 'bg-green-50 border-green-500' 
          : isConnecting
          ? 'bg-yellow-50 border-yellow-500'
          : 'bg-white border-gray-800'
      }`}>
        <span className={`text-2xl sm:text-3xl font-bold ${
          scaleConnected ? 'text-green-700' : isConnecting ? 'text-yellow-600' : 'text-gray-400'
        }`}>
          {scaleConnected ? liveWeight.toFixed(1) : isConnecting ? '...' : '--'}
        </span>
        {isConnecting ? (
          <span className="text-xs text-yellow-600 mt-1 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Connecting
          </span>
        ) : scaleConnected ? (
          <span className="text-xs text-green-600 mt-1 flex items-center gap-1">
            <Scale className="h-3 w-3" />
            {hasReceivedData ? 'Live' : 'Waiting...'}
          </span>
        ) : (
          <span className="text-xs text-gray-400 mt-1">
            No scale connected
          </span>
        )}
      </div>
    </div>
  );
};
