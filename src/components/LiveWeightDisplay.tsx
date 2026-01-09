/**
 * LiveWeightDisplay - Shows scale weight directly in the weight field
 * with connection controls integrated into the display
 */

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Scale, Bluetooth, BluetoothSearching, List, CheckCircle2, AlertCircle } from 'lucide-react';
import { useScaleConnection } from '@/hooks/useScaleConnection';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
    scaleType,
    connectionType,
    isConnecting,
    liveWeight,
    classicBtAvailable,
    showPairedDevices,
    setShowPairedDevices,
    pairedDevices,
    isLoadingPaired,
    isWaitingForStable,
    stableReadingProgress,
    lastRawWeight,
    requireStableReading,
    connectBLE,
    showPairedDevicesDialog,
    connectClassicDevice,
    autoReconnect,
  } = useScaleConnection({ onWeightChange, onEntryTypeChange });

  const isNative = Capacitor.isNativePlatform();
  const isBluetoothAvailable = isNative || ('bluetooth' in navigator);

  // Auto-reconnect on mount if we have a stored device
  useEffect(() => {
    if (!scaleConnected && !digitalDisabled) {
      autoReconnect();
    }
  }, []);

  // Display weight - prefer live weight from scale, fall back to prop weight
  const displayWeight = scaleConnected && liveWeight > 0 ? liveWeight : weight;

  return (
    <>
      {/* Weight Display with Live Scale Reading */}
      <div className="flex gap-2">
        <div className="flex-1 bg-white border-2 border-gray-800 rounded-lg p-4 sm:p-6 flex items-center justify-center">
          <span className="text-2xl sm:text-3xl font-bold">Kgs</span>
        </div>
        <div className={`flex-1 border-2 rounded-lg p-4 sm:p-6 flex flex-col items-center justify-center transition-colors ${
          scaleConnected 
            ? 'bg-green-50 border-green-500' 
            : 'bg-white border-gray-800'
        }`}>
          <span className={`text-2xl sm:text-3xl font-bold ${
            scaleConnected ? 'text-green-700' : ''
          }`}>
            {displayWeight > 0 ? displayWeight.toFixed(1) : '--'}
          </span>
          {scaleConnected && (
            <span className="text-xs text-green-600 mt-1 flex items-center gap-1">
              <Scale className="h-3 w-3" />
              Live
            </span>
          )}
        </div>
      </div>

      {/* Stable Reading Progress (when stableopt=1) */}
      {requireStableReading && isWaitingForStable && (
        <div className="p-3 rounded-lg border-2 bg-blue-50 border-blue-500">
          <div className="flex items-center gap-2 mb-2">
            {stableReadingProgress < 100 ? (
              <AlertCircle className="h-5 w-5 text-blue-600 animate-pulse" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            )}
            <p className="font-semibold text-blue-700 text-sm">
              {stableReadingProgress < 100 ? 'Waiting for stable reading...' : 'Reading stable!'}
            </p>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${stableReadingProgress}%` }}
            />
          </div>
          <p className="text-xs text-blue-600 mt-1">
            Raw: {lastRawWeight.toFixed(1)} Kg • Keep container still
          </p>
        </div>
      )}

      {/* Scale Connection Controls */}
      {isBluetoothAvailable && !digitalDisabled && (
        <div className="flex gap-2">
          {/* BLE Connection Button */}
          <button
            onClick={connectBLE}
            disabled={isConnecting || scaleConnected}
            className={`flex-1 py-2.5 rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm ${
              scaleConnected 
                ? 'bg-green-100 text-green-700 border-2 border-green-500' 
                : 'bg-purple-600 text-white hover:bg-purple-700'
            }`}
          >
            {scaleConnected ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {scaleType} ({connectionType === 'ble' ? 'BLE' : 'SPP'})
              </>
            ) : (
              <>
                <BluetoothSearching className="h-4 w-4" />
                {isConnecting ? 'Connecting...' : 'Connect Scale'}
              </>
            )}
          </button>
          
          {/* Classic BT Button - Only show on native */}
          {isNative && !scaleConnected && (
            <button
              onClick={showPairedDevicesDialog}
              disabled={isConnecting || isLoadingPaired}
              className="py-2.5 px-4 bg-gray-700 text-white rounded-lg font-semibold hover:bg-gray-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <List className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Paired Devices Dialog */}
      <Dialog open={showPairedDevices} onOpenChange={setShowPairedDevices}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bluetooth className="h-5 w-5" />
              Paired Scale Devices
            </DialogTitle>
            <DialogDescription>
              Select a paired Bluetooth scale to connect via Classic SPP
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-80 overflow-y-auto">
            {isLoadingPaired ? (
              <div className="text-center py-8 text-gray-500">
                Loading paired devices...
              </div>
            ) : pairedDevices.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No paired scale devices found.</p>
                <p className="text-sm mt-2">
                  Pair your scale in Android Bluetooth settings first.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pairedDevices.map((device) => (
                  <button
                    key={device.address}
                    onClick={() => connectClassicDevice(device)}
                    className="w-full p-3 text-left border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <p className="font-medium">{device.name || 'Unknown Device'}</p>
                    <p className="text-xs text-gray-500">{device.address}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
