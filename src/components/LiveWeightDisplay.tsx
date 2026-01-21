/**
 * LiveWeightDisplay - Shows scale weight in a high-contrast boxed layout
 * Layout: "Kgs" label on left, large bold weight value on right
 * Matches reference design with thick black borders
 */

import { useEffect, useState, useRef } from 'react';
import { Scale, Loader2, RefreshCw } from 'lucide-react';
import { useScaleConnection } from '@/hooks/useScaleConnection';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// Display stabilization - prevents flickering when scale is stable
const DISPLAY_STABLE_THRESHOLD = 0.15; // Max kg variance to consider "stable"
const DISPLAY_STABLE_COUNT = 3; // Readings within threshold to lock display
const DISPLAY_UPDATE_INTERVAL = 200; // Min ms between display updates

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
    forceResubscribe,
    isConnecting,
    connectionType,
  } = useScaleConnection({ 
    onWeightChange: (w) => {
      console.log(`📺 LiveWeightDisplay onWeightChange callback fired: ${w} kg`);
      onWeightChange(w);
    }, 
    onEntryTypeChange 
  });
  
  const [hasReceivedData, setHasReceivedData] = useState(false);
  const [lastWeightTime, setLastWeightTime] = useState<number>(0);
  const [showResubscribe, setShowResubscribe] = useState(false);
  
  // Display stabilization state
  const [stableDisplayWeight, setStableDisplayWeight] = useState(0);
  const recentReadingsRef = useRef<number[]>([]);
  const lastDisplayUpdateRef = useRef<number>(0);

  // Auto-reconnect on mount ONLY if not already connected and we have a stored device
  useEffect(() => {
    console.log(`📺 LiveWeightDisplay mount: scaleConnected=${scaleConnected}, digitalDisabled=${digitalDisabled}, isConnecting=${isConnecting}`);
    if (!scaleConnected && !digitalDisabled && !isConnecting) {
      console.log('📺 LiveWeightDisplay: attempting autoReconnect...');
      autoReconnect();
    }
  }, []); // Only on mount
  
  // Stabilize display weight - prevents flickering when scale is stable
  useEffect(() => {
    if (!scaleConnected) {
      recentReadingsRef.current = [];
      setStableDisplayWeight(0);
      return;
    }
    
    const incomingWeight = liveWeight > 0 ? liveWeight : weight;
    
    // Handle zero weight immediately
    if (incomingWeight === 0) {
      recentReadingsRef.current = [];
      setStableDisplayWeight(0);
      return;
    }
    
    // Add to readings buffer
    recentReadingsRef.current.push(incomingWeight);
    if (recentReadingsRef.current.length > DISPLAY_STABLE_COUNT * 2) {
      recentReadingsRef.current = recentReadingsRef.current.slice(-DISPLAY_STABLE_COUNT);
    }
    
    const now = Date.now();
    const recentReadings = recentReadingsRef.current.slice(-DISPLAY_STABLE_COUNT);
    
    // Check if readings are stable (within threshold)
    let isStable = false;
    if (recentReadings.length >= DISPLAY_STABLE_COUNT) {
      const min = Math.min(...recentReadings);
      const max = Math.max(...recentReadings);
      isStable = (max - min) <= DISPLAY_STABLE_THRESHOLD;
    }
    
    // Update display if stable OR enough time has passed
    const timeSinceLastUpdate = now - lastDisplayUpdateRef.current;
    
    if (isStable) {
      // Lock to average of stable readings
      const avg = recentReadings.reduce((a, b) => a + b, 0) / recentReadings.length;
      const roundedAvg = parseFloat(avg.toFixed(1));
      if (roundedAvg !== stableDisplayWeight) {
        setStableDisplayWeight(roundedAvg);
        lastDisplayUpdateRef.current = now;
      }
    } else if (timeSinceLastUpdate > DISPLAY_UPDATE_INTERVAL) {
      // Not stable but throttle rapid updates
      setStableDisplayWeight(parseFloat(incomingWeight.toFixed(1)));
      lastDisplayUpdateRef.current = now;
    }
    
    // Track data received
    if (incomingWeight > 0) {
      setHasReceivedData(true);
      setLastWeightTime(now);
      setShowResubscribe(false);
    }
  }, [scaleConnected, liveWeight, weight, stableDisplayWeight]);

  // Show resubscribe button if connected but no data for 10 seconds
  useEffect(() => {
    if (!scaleConnected || connectionType !== 'ble') {
      setShowResubscribe(false);
      return;
    }
    
    const checkDataFlow = setInterval(() => {
      const noRecentData = Date.now() - lastWeightTime > 10000;
      if (noRecentData && hasReceivedData) {
        setShowResubscribe(true);
      }
    }, 5000);
    
    return () => clearInterval(checkDataFlow);
  }, [scaleConnected, connectionType, lastWeightTime, hasReceivedData]);

  // Reset data received flag when disconnected
  useEffect(() => {
    if (!scaleConnected) {
      setHasReceivedData(false);
      setShowResubscribe(false);
    }
  }, [scaleConnected]);

  const handleResubscribe = async () => {
    await forceResubscribe();
  };

  // Use stabilized display weight to prevent flickering
  const displayWeight = stableDisplayWeight > 0 ? stableDisplayWeight : (weight > 0 ? weight : 0);

  return (
    <div className="space-y-2">
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
            (scaleConnected || displayWeight > 0) ? 'text-gray-900' : isConnecting ? 'text-yellow-600' : 'text-gray-400'
          }`}>
            {isConnecting 
              ? '...' 
              : displayWeight > 0 
                ? displayWeight.toFixed(1) 
                : scaleConnected 
                  ? '0.0'
                  : '--'
            }
          </span>
          {isConnecting ? (
            <span className="text-xs text-yellow-600 mt-1 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Connecting
            </span>
          ) : (scaleConnected || displayWeight > 0) ? (
            <span className="text-xs text-green-600 mt-1 flex items-center gap-1">
              <Scale className="h-3 w-3" />
              {(hasReceivedData || displayWeight > 0) ? 'Live' : 'Waiting...'}
            </span>
          ) : (
            <span className="text-xs text-gray-400 mt-1">
              No scale connected
            </span>
          )}
        </div>
      </div>
      
      {/* Force Resubscribe Button - shown when data flow stops */}
      {showResubscribe && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleResubscribe}
          disabled={isConnecting}
          className="w-full border-orange-400 text-orange-600 hover:bg-orange-50"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isConnecting ? 'animate-spin' : ''}`} />
          Reconnect Notifications
        </Button>
      )}
    </div>
  );
};
