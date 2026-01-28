/**
 * CoffeeWeightDisplay - Shows Gross, Sack (tare), and Net weight for coffee weighing
 * Sack tare weight is configurable via psettings (default 1 kg)
 * Net weight = Gross weight - Sack tare
 * allowSackEdit controls whether users can manually adjust sack weight
 */

import { useEffect, useState, useRef, useMemo } from 'react';
import { Scale, Loader2, RefreshCw, Package, Lock, Unlock } from 'lucide-react';
import { useScaleConnection } from '@/hooks/useScaleConnection';
import { Button } from '@/components/ui/button';

// Display stabilization - prevents flickering when scale is stable
const DISPLAY_STABLE_THRESHOLD = 0.15; // Max kg variance to consider "stable"
const DISPLAY_STABLE_COUNT = 3; // Readings within threshold to lock display
const DISPLAY_UPDATE_INTERVAL = 200; // Min ms between display updates

interface CoffeeWeightDisplayProps {
  grossWeight: number;
  onGrossWeightChange: (grossWeight: number) => void;
  onNetWeightChange: (netWeight: number) => void;
  onTareWeightChange?: (tareWeight: number) => void; // Called when user edits sack weight
  onEntryTypeChange: (entryType: 'scale' | 'manual') => void;
  digitalDisabled?: boolean;
  // Configurable sack tare weight from psettings (default 1 kg)
  sackTareWeight?: number;
  // Whether user can edit sack weight (psettings: allowSackEdit)
  allowSackEdit?: boolean;
}

export const CoffeeWeightDisplay = ({
  grossWeight,
  onGrossWeightChange,
  onNetWeightChange,
  onTareWeightChange,
  onEntryTypeChange,
  digitalDisabled = false,
  sackTareWeight = 1, // Default 1 kg if not provided
  allowSackEdit = false, // Default: fixed, backend-controlled
}: CoffeeWeightDisplayProps) => {
  // Local tare weight state - starts from psettings value but can be edited if allowed
  const [localTareWeight, setLocalTareWeight] = useState(sackTareWeight);
  const [isEditingTare, setIsEditingTare] = useState(false);
  
  // Sync local tare weight when psettings changes
  useEffect(() => {
    setLocalTareWeight(sackTareWeight);
  }, [sackTareWeight]);

  const {
    scaleConnected,
    liveWeight,
    autoReconnect,
    forceResubscribe,
    isConnecting,
    connectionType,
  } = useScaleConnection({ 
    onWeightChange: (w) => {
      console.log(`☕ CoffeeWeightDisplay onWeightChange callback: ${w} kg gross`);
      onGrossWeightChange(w);
      // Calculate and propagate net weight using current tare
      const netWeight = Math.max(0, w - localTareWeight);
      onNetWeightChange(parseFloat(netWeight.toFixed(2)));
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

  // Calculate net weight from gross (gross - sack tare)
  const netWeight = useMemo(() => {
    const net = Math.max(0, stableDisplayWeight - localTareWeight);
    return parseFloat(net.toFixed(1));
  }, [stableDisplayWeight, localTareWeight]);

  // Recalculate net weight when tare changes
  useEffect(() => {
    if (stableDisplayWeight > 0) {
      const newNet = Math.max(0, stableDisplayWeight - localTareWeight);
      onNetWeightChange(parseFloat(newNet.toFixed(2)));
    }
  }, [localTareWeight, stableDisplayWeight, onNetWeightChange]);

  // Auto-reconnect on mount ONLY if not already connected
  useEffect(() => {
    console.log(`☕ CoffeeWeightDisplay mount: scaleConnected=${scaleConnected}, digitalDisabled=${digitalDisabled}`);
    if (!scaleConnected && !digitalDisabled && !isConnecting) {
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
    
    const incomingWeight = liveWeight > 0 ? liveWeight : grossWeight;
    
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
      const avg = recentReadings.reduce((a, b) => a + b, 0) / recentReadings.length;
      const roundedAvg = parseFloat(avg.toFixed(1));
      if (roundedAvg !== stableDisplayWeight) {
        setStableDisplayWeight(roundedAvg);
        lastDisplayUpdateRef.current = now;
      }
    } else if (timeSinceLastUpdate > DISPLAY_UPDATE_INTERVAL) {
      setStableDisplayWeight(parseFloat(incomingWeight.toFixed(1)));
      lastDisplayUpdateRef.current = now;
    }
    
    // Track data received
    if (incomingWeight > 0) {
      setHasReceivedData(true);
      setLastWeightTime(now);
      setShowResubscribe(false);
    }
  }, [scaleConnected, liveWeight, grossWeight, stableDisplayWeight]);

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

  // Handle tare weight edit
  const handleTareChange = (value: string) => {
    const numValue = parseFloat(value) || 0;
    const clampedValue = Math.max(0, Math.min(10, numValue)); // Limit 0-10 kg
    setLocalTareWeight(clampedValue);
    onTareWeightChange?.(clampedValue);
  };

  // Use stabilized display weight for gross
  const displayGrossWeight = stableDisplayWeight > 0 ? stableDisplayWeight : (grossWeight > 0 ? grossWeight : 0);

  return (
    <div className="space-y-2">
      {/* Three-column weight display: Gross | Sack | Net */}
      <div className="flex gap-1">
        {/* Gross Weight Box */}
        <div className={`flex-1 border-[3px] rounded-lg py-4 sm:py-5 flex flex-col items-center justify-center transition-colors ${
          scaleConnected 
            ? 'bg-white border-gray-900' 
            : isConnecting
            ? 'bg-yellow-50 border-yellow-500'
            : 'bg-white border-gray-900'
        }`}>
          <span className="text-xs sm:text-sm font-semibold text-gray-500 uppercase tracking-wide">Gross</span>
          <span className={`text-2xl sm:text-3xl font-black ${
            (scaleConnected || displayGrossWeight > 0) ? 'text-gray-900' : isConnecting ? 'text-yellow-600' : 'text-gray-400'
          }`}>
            {isConnecting 
              ? '...' 
              : displayGrossWeight > 0 
                ? displayGrossWeight.toFixed(1) 
                : scaleConnected 
                  ? '0.0'
                  : '--'
            }
          </span>
          <span className="text-xs text-gray-500">kg</span>
        </div>
        
        {/* Sack (Tare) Weight Box - Editable if allowSackEdit=1, otherwise fixed */}
        <div 
          className={`flex-1 border-[3px] rounded-lg py-4 sm:py-5 flex flex-col items-center justify-center transition-colors ${
            allowSackEdit ? 'bg-amber-50 border-amber-500 cursor-pointer' : 'bg-amber-50 border-amber-400'
          }`}
          onClick={() => allowSackEdit && setIsEditingTare(true)}
        >
          <span className="text-xs sm:text-sm font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
            <Package className="h-3 w-3" />
            Sack
            {allowSackEdit ? (
              <Unlock className="h-3 w-3 text-amber-600" />
            ) : (
              <Lock className="h-3 w-3 text-amber-600" />
            )}
          </span>
          
          {isEditingTare && allowSackEdit ? (
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              max="10"
              value={localTareWeight}
              onChange={(e) => handleTareChange(e.target.value)}
              onBlur={() => setIsEditingTare(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditingTare(false)}
              autoFocus
              className="w-16 text-center text-2xl sm:text-3xl font-black text-amber-700 bg-white border border-amber-400 rounded"
            />
          ) : (
            <span className="text-2xl sm:text-3xl font-black text-amber-700">
              {localTareWeight.toFixed(1)}
            </span>
          )}
          
          <span className="text-xs text-amber-600">
            kg {allowSackEdit ? '(tap to edit)' : '(fixed)'}
          </span>
        </div>
        
        {/* Net Weight Box - Calculated automatically */}
        <div className={`flex-1 border-[3px] rounded-lg py-4 sm:py-5 flex flex-col items-center justify-center ${
          netWeight > 0 ? 'bg-green-50 border-green-600' : 'bg-gray-50 border-gray-300'
        }`}>
          <span className={`text-xs sm:text-sm font-semibold uppercase tracking-wide ${
            netWeight > 0 ? 'text-green-700' : 'text-gray-500'
          }`}>Net</span>
          <span className={`text-2xl sm:text-3xl font-black ${
            netWeight > 0 ? 'text-green-700' : 'text-gray-400'
          }`}>
            {displayGrossWeight > 0 
              ? netWeight.toFixed(1) 
              : scaleConnected 
                ? '0.0'
                : '--'
            }
          </span>
          <span className={`text-xs ${netWeight > 0 ? 'text-green-600' : 'text-gray-400'}`}>kg</span>
        </div>
      </div>
      
      {/* Connection status */}
      <div className="flex items-center justify-center gap-2 text-xs">
        {isConnecting ? (
          <span className="text-yellow-600 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Connecting to scale...
          </span>
        ) : scaleConnected ? (
          <span className="text-green-600 flex items-center gap-1">
            <Scale className="h-3 w-3" />
            {hasReceivedData ? 'Scale connected • Live' : 'Scale connected • Waiting...'}
          </span>
        ) : (
          <span className="text-gray-400">
            No scale connected
          </span>
        )}
      </div>
      
      {/* Force Resubscribe Button */}
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

// Export the default tare weight for backward compatibility
export const COFFEE_SACK_TARE_WEIGHT = 1;
