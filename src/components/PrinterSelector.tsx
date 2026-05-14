import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Printer, RefreshCw, Signal, Check, Loader2, WifiOff, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  scanForPrinters,
  connectToSpecificPrinter,
  type DiscoveredPrinter,
} from '@/services/bluetooth';
import { Capacitor } from '@capacitor/core';
import { useBtStatus } from '@/hooks/useBtStatus';

interface PrinterSelectorProps {
  onPrinterConnected?: (name: string) => void;
  isPrinterConnected: boolean;
}

export const PrinterSelector = ({ onPrinterConnected, isPrinterConnected }: PrinterSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [printers, setPrinters] = useState<DiscoveredPrinter[]>([]);

  // v2.10.85: Real-time status from the central BT connection manager.
  const printerBt = useBtStatus('printer');
  const lastConnected = printerBt.deviceName;
  const autoReconnecting = printerBt.status === 'connecting' || printerBt.status === 'reconnecting';
  const connectionError = printerBt.status === 'failed' ? (printerBt.lastError || 'Connection failed') : null;

  // Notify parent on transition to connected.
  useEffect(() => {
    if (printerBt.status === 'connected' && lastConnected) {
      onPrinterConnected?.(lastConnected);
    }
  }, [printerBt.status, lastConnected, onPrinterConnected]);

  // v2.10.85: Auto-reconnect, health monitoring, and stale-state recovery are
  // now handled centrally by btConnectionManager — no per-component logic needed.
  const attemptAutoReconnect = (showToast: boolean = true) => {
    printerBt.reconnect();
    if (showToast && lastConnected) toast.info(`Reconnecting to ${lastConnected}…`);
  };

  const handleScan = async () => {
    if (!Capacitor.isNativePlatform()) {
      toast.error('Printer scanning requires native app');
      return;
    }

    setScanning(true);
    setPrinters([]);
    
    toast.info('Scanning for printers...', { duration: 5000 });
    
    const result = await scanForPrinters(5000);
    
    setScanning(false);
    
    if (result.success) {
      setPrinters(result.printers);
      if (result.printers.length === 0) {
        toast.info('No printers found. Make sure your printer is on and in pairing mode.');
      } else {
        toast.success(`Found ${result.printers.length} device(s)`);
      }
    } else {
      toast.error(result.error || 'Scan failed');
    }
  };

  const handleConnect = async (printer: DiscoveredPrinter) => {
    setConnecting(printer.deviceId);
    
    const result = await connectToSpecificPrinter(printer.deviceId, printer.name);
    
    setConnecting(null);
    
    if (result.success) {
      toast.success(`Connected to ${printer.name}`);
      // Manager picks up the new connection via printerConnectionChange.
      onPrinterConnected?.(printer.name);
      setOpen(false);
    } else {
      toast.error(result.error || 'Connection failed');
    }
  };

  const getSignalStrength = (rssi?: number) => {
    if (!rssi) return 'text-muted-foreground';
    if (rssi > -50) return 'text-green-500';
    if (rssi > -70) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2"
          disabled={autoReconnecting}
        >
          {autoReconnecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">
                {printerBt.status === 'reconnecting'
                  ? printerBt.retryInMs && printerBt.retryInMs > 0
                    ? `Retry in ${Math.ceil(printerBt.retryInMs / 1000)}s`
                    : 'Reconnecting…'
                  : 'Connecting…'}
              </span>
            </>
          ) : (
            <>
              <Printer className="h-4 w-4" />
              {isPrinterConnected || printerBt.status === 'connected' ? (
                <span className="text-green-600 text-xs">Connected</span>
              ) : printerBt.status === 'failed' ? (
                <span className="text-destructive text-xs flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Failed
                </span>
              ) : lastConnected ? (
                <span className="text-orange-600 text-xs flex items-center gap-1">
                  <WifiOff className="h-3 w-3" />
                  {lastConnected}
                </span>
              ) : (
                <span className="text-xs">Select Printer</span>
              )}
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Select Bluetooth Printer
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {lastConnected && (
            <div className={`p-3 rounded-lg flex items-center justify-between ${connectionError ? 'bg-destructive/10 border border-destructive/20' : 'bg-muted'}`}>
              <div>
                <p className="text-sm text-muted-foreground">Last connected:</p>
                <p className="font-medium">{lastConnected}</p>
                {connectionError && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {connectionError}
                  </p>
                )}
              </div>
              {Capacitor.isNativePlatform() && (
                <Button
                  size="sm"
                  variant={isPrinterConnected ? "outline" : "secondary"}
                  onClick={() => attemptAutoReconnect(true)}
                  disabled={autoReconnecting || isPrinterConnected}
                  className="gap-1"
                >
                  {autoReconnecting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : isPrinterConnected ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {isPrinterConnected ? 'Connected' : 'Reconnect'}
                </Button>
              )}
            </div>
          )}
          
          <Button 
            onClick={handleScan} 
            disabled={scanning}
            className="w-full gap-2"
          >
            {scanning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Scan for Printers
              </>
            )}
          </Button>
          
          {printers.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              <p className="text-sm font-medium text-muted-foreground">
                Available Printers ({printers.length})
              </p>
              {printers.map((p) => (
                <button
                  key={p.deviceId}
                  onClick={() => handleConnect(p)}
                  disabled={connecting !== null}
                  className="w-full flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <Printer className="h-5 w-5 text-muted-foreground" />
                    <div className="text-left">
                      <p className="font-medium text-sm">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.deviceId.slice(-8)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.rssi && (
                      <Signal className={`h-4 w-4 ${getSignalStrength(p.rssi)}`} />
                    )}
                    {connecting === p.deviceId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isPrinterConnected && lastConnected === p.name ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
          
          {!scanning && printers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Tap "Scan for Printers" to find nearby Bluetooth printers
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
