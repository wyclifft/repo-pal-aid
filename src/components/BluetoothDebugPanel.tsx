import { useState, useEffect, useRef, useCallback } from "react";
import { Bug, Trash2, Download, Play, Pause, Radio, Bluetooth, Scale, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { broadcastScaleWeightUpdate, isScaleConnected, isPrinterConnected, ScaleType } from "@/services/bluetooth";
import { toast } from "sonner";

interface LogEntry {
  id: number;
  timestamp: Date;
  type: 'info' | 'success' | 'warning' | 'error' | 'event';
  source: string;
  message: string;
  data?: any;
}

export const BluetoothDebugPanel = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const logIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isPausedRef = useRef(isPaused);
  
  // Keep ref in sync
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const addLog = useCallback((type: LogEntry['type'], source: string, message: string, data?: any) => {
    if (isPausedRef.current) return;
    
    const entry: LogEntry = {
      id: logIdRef.current++,
      timestamp: new Date(),
      type,
      source,
      message,
      data
    };
    
    setLogs(prev => [...prev.slice(-99), entry]); // Keep last 100 logs
  }, []);

  // Listen for all Bluetooth-related events
  useEffect(() => {
    const handleScaleWeightUpdate = (e: CustomEvent<{ weight: number; scaleType: string }>) => {
      addLog('event', 'Weight', `📊 ${e.detail.weight} kg (${e.detail.scaleType})`, e.detail);
    };

    const handleScaleConnectionChange = (e: CustomEvent<{ connected: boolean }>) => {
      addLog(e.detail.connected ? 'success' : 'warning', 'Scale', 
        e.detail.connected ? '✅ Scale connected' : '❌ Scale disconnected');
    };

    const handlePrinterConnectionChange = (e: CustomEvent<{ connected: boolean }>) => {
      addLog(e.detail.connected ? 'success' : 'warning', 'Printer', 
        e.detail.connected ? '✅ Printer connected' : '❌ Printer disconnected');
    };

    const handleEntryTypeChange = (e: CustomEvent<{ entryType: string }>) => {
      addLog('info', 'Entry', `Entry type: ${e.detail.entryType}`, e.detail);
    };

    // Intercept console logs with Bluetooth-related content
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;

    const btKeywords = [
      '🔌', '📡', '🎯', '📺', '🔄', '📊', '✅', '⚠️', '❌', '📋', '📱', '📤',
      'bluetooth', 'Bluetooth', 'scale', 'Scale', 'weight', 'Weight', 
      'BLE', 'Classic', 'SPP', 'HC-05', 'HC-06', 'notify', 'characteristic',
      'connect', 'Connect', 'broadcast', 'Broadcast', 'parsed', 'Parsed',
      'dataReceived', 'reconnect', 'Reconnect'
    ];

    const filterBluetoothLog = (args: any[], type: LogEntry['type']) => {
      const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      // Filter for Bluetooth-related logs
      if (btKeywords.some(kw => msg.includes(kw))) {
        addLog(type, 'Console', msg.substring(0, 300));
      }
    };

    console.log = (...args) => {
      originalLog.apply(console, args);
      filterBluetoothLog(args, 'info');
    };

    console.warn = (...args) => {
      originalWarn.apply(console, args);
      filterBluetoothLog(args, 'warning');
    };

    console.error = (...args) => {
      originalError.apply(console, args);
      filterBluetoothLog(args, 'error');
    };

    console.info = (...args) => {
      originalInfo.apply(console, args);
      filterBluetoothLog(args, 'info');
    };

    window.addEventListener('scaleWeightUpdate', handleScaleWeightUpdate as EventListener);
    window.addEventListener('scaleConnectionChange', handleScaleConnectionChange as EventListener);
    window.addEventListener('printerConnectionChange', handlePrinterConnectionChange as EventListener);
    window.addEventListener('entryTypeChange', handleEntryTypeChange as EventListener);

    // Initial log
    addLog('info', 'Debug', '🚀 Bluetooth debug panel initialized');
    addLog('info', 'Status', `Scale: ${isScaleConnected() ? '✅' : '❌'}, Printer: ${isPrinterConnected() ? '✅' : '❌'}`);

    // Periodic status check every 5 seconds
    const statusInterval = setInterval(() => {
      const scaleNow = isScaleConnected();
      const printerNow = isPrinterConnected();
      addLog('info', 'Poll', `Scale: ${scaleNow ? '✅' : '❌'}, Printer: ${printerNow ? '✅' : '❌'} (${new Date().toLocaleTimeString()})`);
    }, 5000);

    return () => {
      clearInterval(statusInterval);
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      console.info = originalInfo;
      window.removeEventListener('scaleWeightUpdate', handleScaleWeightUpdate as EventListener);
      window.removeEventListener('scaleConnectionChange', handleScaleConnectionChange as EventListener);
      window.removeEventListener('printerConnectionChange', handlePrinterConnectionChange as EventListener);
      window.removeEventListener('entryTypeChange', handleEntryTypeChange as EventListener);
    };
  }, [addLog]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && !isPaused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isPaused]);

  const clearLogs = () => {
    setLogs([]);
    logIdRef.current = 0;
    addLog('info', 'Debug', 'Logs cleared');
  };

  const exportLogs = () => {
    const content = logs.map(log => 
      `[${log.timestamp.toISOString()}] [${log.type.toUpperCase()}] [${log.source}] ${log.message}${log.data ? ' | Data: ' + JSON.stringify(log.data) : ''}`
    ).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bluetooth-debug-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Logs exported');
  };

  const sendTestWeight = () => {
    const testWeight = Math.round((5 + Math.random() * 45) * 10) / 10; // 5.0 - 50.0 kg
    addLog('info', 'Test', `Sending test weight: ${testWeight} kg`);
    broadcastScaleWeightUpdate(testWeight, 'Unknown' as ScaleType);
    toast.success(`Test weight ${testWeight} kg broadcasted`);
  };

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'error': return 'text-red-600';
      case 'event': return 'text-blue-600';
      default: return 'text-foreground';
    }
  };

  const getLogBadgeVariant = (type: LogEntry['type']): "default" | "secondary" | "destructive" | "outline" => {
    switch (type) {
      case 'success': return 'default';
      case 'error': return 'destructive';
      default: return 'secondary';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bug className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Bluetooth Debug Panel</CardTitle>
              <CardDescription className="text-xs">Real-time event logs</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isScaleConnected() ? "default" : "secondary"} className="text-xs gap-1">
              <Scale className="h-3 w-3" />
              Scale
            </Badge>
            <Badge variant={isPrinterConnected() ? "default" : "secondary"} className="text-xs gap-1">
              <Bluetooth className="h-3 w-3" />
              Printer
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? 'Collapse' : 'Expand'}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="space-y-3">
          {/* Control buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={isPaused ? "default" : "outline"}
              size="sm"
              onClick={() => setIsPaused(!isPaused)}
              className="gap-1"
            >
              {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {isPaused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearLogs}
              className="gap-1"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={exportLogs}
              className="gap-1"
            >
              <Download className="h-3 w-3" />
              Export
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={sendTestWeight}
              className="gap-1"
            >
              <Send className="h-3 w-3" />
              Test Weight
            </Button>
          </div>

          <Separator />

          {/* Log display */}
          <ScrollArea className="h-64 w-full rounded border bg-muted/30 p-2" ref={scrollRef}>
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                <Radio className="h-4 w-4 mr-2 animate-pulse" />
                Waiting for Bluetooth events...
              </div>
            ) : (
              <div className="space-y-1 font-mono text-xs">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-2 items-start hover:bg-muted/50 rounded px-1">
                    <span className="text-muted-foreground shrink-0">
                      {log.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}.{String(log.timestamp.getMilliseconds()).padStart(3, '0')}
                    </span>
                    <Badge variant={getLogBadgeVariant(log.type)} className="text-[10px] px-1 py-0 shrink-0">
                      {log.source}
                    </Badge>
                    <span className={`${getLogColor(log.type)} break-all`}>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <p className="text-xs text-muted-foreground text-center">
            Logs capture Bluetooth events and console messages. Use "Test Weight" to simulate scale data.
          </p>
        </CardContent>
      )}
    </Card>
  );
};
