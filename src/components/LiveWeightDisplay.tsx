/**
 * LiveWeightDisplay - Shows scale weight in a high-contrast boxed layout
 * Layout: "Kgs" label on left, large bold weight value on right
 * Matches reference design with thick black borders
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

  // Display weight: use liveWeight when connected, otherwise use passed weight prop
  const displayWeight = scaleConnected ? liveWeight : weight;

  return (
    <div className="flex">
      {/* Kgs Label Box - Left side */}
      <div className="flex-1 bg-white border-[3px] border-gray-900 rounded-l-lg py-6 sm:py-8 flex items-center justify-center">
        <span className="text-3xl sm:text-4xl font-bold text-gray-900">Kgs</span>
      </div>
      
      {/* Weight Value Box - Right side with thicker border */}
      <div className={`flex-1 border-[3px] rounded-r-lg py-6 sm:py-8 flex flex-col items-center justify-center transition-colors ${
        scaleConnected 
          ? 'bg-white border-gray-900' 
          : isConnecting
          ? 'bg-yellow-50 border-yellow-500'
          : 'bg-white border-gray-900'
      }`}>
        <span className={`text-4xl sm:text-5xl font-black ${
          scaleConnected ? 'text-gray-900' : isConnecting ? 'text-yellow-600' : 'text-gray-400'
        }`}>
          {isConnecting 
            ? '...' 
            : scaleConnected 
              ? displayWeight.toFixed(1) 
              : displayWeight > 0 
                ? displayWeight.toFixed(1) 
                : '--'
          }
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
        ) : null}
      </div>
    </div>
  );
};
