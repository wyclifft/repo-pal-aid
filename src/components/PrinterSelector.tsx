import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, RefreshCw, Loader2, WifiOff, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useBtStatus } from '@/hooks/useBtStatus';
import { PrinterConnectionDialog } from './PrinterConnectionDialog';

interface PrinterSelectorProps {
  onPrinterConnected?: (name: string) => void;
  isPrinterConnected: boolean;
}

export const PrinterSelector = ({ onPrinterConnected, isPrinterConnected }: PrinterSelectorProps) => {
  const [open, setOpen] = useState(false);

  // v2.10.85: Real-time status from the central BT connection manager.
  const printerBt = useBtStatus('printer');
  const lastConnected = printerBt.deviceName;
  const autoReconnecting = printerBt.status === 'connecting' || printerBt.status === 'reconnecting';

  // Notify parent on transition to connected.
  useEffect(() => {
    if (printerBt.status === 'connected' && lastConnected) {
      onPrinterConnected?.(lastConnected);
    }
  }, [printerBt.status, lastConnected, onPrinterConnected]);

  const handleConnected = (name: string) => {
    onPrinterConnected?.(name);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={autoReconnecting}
        onClick={() => setOpen(true)}
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

      <PrinterConnectionDialog
        open={open}
        onOpenChange={setOpen}
        onConnected={handleConnected}
      />
    </>
  );
};
