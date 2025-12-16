import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Printer, RefreshCw, Signal, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { 
  scanForPrinters, 
  connectToSpecificPrinter, 
  getStoredPrinterInfo,
  DiscoveredPrinter 
} from '@/services/bluetooth';
import { Capacitor } from '@capacitor/core';

interface PrinterSelectorProps {
  onPrinterConnected?: (name: string) => void;
  isPrinterConnected: boolean;
}

export const PrinterSelector = ({ onPrinterConnected, isPrinterConnected }: PrinterSelectorProps) => {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [printers, setPrinters] = useState<DiscoveredPrinter[]>([]);
  const [lastConnected, setLastConnected] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredPrinterInfo();
    if (stored) {
      setLastConnected(stored.deviceName);
    }
  }, []);

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
      setLastConnected(printer.name);
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
        >
          <Printer className="h-4 w-4" />
          {isPrinterConnected ? (
            <span className="text-green-600 text-xs">Connected</span>
          ) : (
            <span className="text-xs">Select Printer</span>
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
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Last connected:</p>
              <p className="font-medium">{lastConnected}</p>
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
