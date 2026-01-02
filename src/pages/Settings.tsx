import { useState, useEffect, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, Bluetooth, Printer, CheckCircle2, XCircle, Zap, Bug, RefreshCw, Building2, Loader2, Settings2, Trash2 } from "lucide-react";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { 
  connectBluetoothScale, 
  disconnectBluetoothScale, 
  quickReconnect,
  getStoredDeviceInfo,
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  quickReconnectPrinter,
  getStoredPrinterInfo,
  printToBluetoothPrinter,
  isScaleConnected,
  isPrinterConnected,
  ScaleType 
} from "@/services/bluetooth";
import { runBluetoothDiagnostics, logConnectionTips } from "@/utils/bluetoothDiagnostics";
import { generateDeviceFingerprint } from "@/utils/deviceFingerprint";

const Settings = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { settings, isLoading: isLoadingSettings, refreshSettings, routeLabel } = useAppSettings();
  
  // Initialize from actual bluetooth state
  const [scaleConnected, setScaleConnected] = useState(() => isScaleConnected());

  // Check authentication
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);
  
  const [scaleType, setScaleType] = useState<ScaleType>("Unknown");
  const [isConnectingScale, setIsConnectingScale] = useState(false);
  const [lastWeight, setLastWeight] = useState<number | null>(null);
  const [storedDevice, setStoredDevice] = useState<ReturnType<typeof getStoredDeviceInfo>>(null);
  
  // Initialize printer connected from actual bluetooth state
  const [printerConnected, setPrinterConnected] = useState(() => isPrinterConnected());
  const [printerName, setPrinterName] = useState<string>("");
  const [isConnectingPrinter, setIsConnectingPrinter] = useState(false);
  const [storedPrinter, setStoredPrinter] = useState<ReturnType<typeof getStoredPrinterInfo>>(null);
  
  // Company refresh state
  const [companyName, setCompanyName] = useState<string>(() => {
    return localStorage.getItem('device_company_name') || '';
  });
  const [isRefreshingCompany, setIsRefreshingCompany] = useState(false);

  useEffect(() => {
    const deviceInfo = getStoredDeviceInfo();
    setStoredDevice(deviceInfo);
    
    const printerInfo = getStoredPrinterInfo();
    setStoredPrinter(printerInfo);
  }, []);
  
  // Listen for connection state changes
  useEffect(() => {
    const handleScaleChange = (e: CustomEvent<{ connected: boolean }>) => {
      setScaleConnected(e.detail.connected);
    };
    const handlePrinterChange = (e: CustomEvent<{ connected: boolean }>) => {
      setPrinterConnected(e.detail.connected);
    };
    
    window.addEventListener('scaleConnectionChange', handleScaleChange as EventListener);
    window.addEventListener('printerConnectionChange', handlePrinterChange as EventListener);
    
    return () => {
      window.removeEventListener('scaleConnectionChange', handleScaleChange as EventListener);
      window.removeEventListener('printerConnectionChange', handlePrinterChange as EventListener);
    };
  }, []);

  // Force refresh company name and settings from server
  const handleRefreshCompany = useCallback(async () => {
    if (!navigator.onLine) {
      toast.error('Cannot refresh while offline');
      return;
    }
    
    setIsRefreshingCompany(true);
    toast.info('Refreshing company data...');
    
    try {
      // Clear cached company name to force fresh fetch
      localStorage.removeItem('device_company_name');
      
      // Refresh app settings which includes company info from psettings
      await refreshSettings();
      
      // Update local state with company name from settings
      const updatedCompanyName = settings.company_name || localStorage.getItem('device_company_name') || 'DAIRY COLLECTION';
      setCompanyName(updatedCompanyName);
      localStorage.setItem('device_company_name', updatedCompanyName);
      
      toast.success(`Company data refreshed: ${updatedCompanyName}`);
      
      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('companyNameUpdated', { 
        detail: { companyName: updatedCompanyName } 
      }));
      
    } catch (error) {
      console.error('Failed to refresh company:', error);
      // Even on error, try to use cached device company name
      const cachedName = localStorage.getItem('device_company_name');
      if (cachedName) {
        setCompanyName(cachedName);
        toast.info(`Using cached: ${cachedName}`);
      } else {
        toast.error('Failed to refresh company data');
      }
    } finally {
      setIsRefreshingCompany(false);
    }
  }, [refreshSettings, settings.company_name]);

  const handleQuickReconnect = async () => {
    if (!storedDevice) return;
    
    setIsConnectingScale(true);
    const result = await quickReconnect(storedDevice.deviceId, (weight, type) => {
      setLastWeight(weight);
      toast.success(`Weight received: ${weight} kg`);
    });

    setIsConnectingScale(false);
    if (result.success) {
      setScaleConnected(true);
      setScaleType(result.type);
      toast.success(`Reconnected to ${storedDevice.deviceName}`);
    } else {
      toast.error(result.error || "Failed to reconnect. Try searching for device again.");
      setStoredDevice(null);
    }
  };

  const handleConnectScale = async () => {
    setIsConnectingScale(true);
    const result = await connectBluetoothScale((weight, type) => {
      setLastWeight(weight);
      toast.success(`Weight received: ${weight} kg`);
    });

    setIsConnectingScale(false);
    if (result.success) {
      setScaleConnected(true);
      setScaleType(result.type);
      toast.success(`Connected to ${result.type} scale`);
    } else {
      toast.error(result.error || "Failed to connect to scale");
    }
  };

  const handleDisconnectScale = async () => {
    await disconnectBluetoothScale(false);
    setScaleConnected(false);
    setScaleType("Unknown");
    setLastWeight(null);
    toast.info("Scale disconnected");
  };

  const handleForgetDevice = async () => {
    await disconnectBluetoothScale(true);
    setScaleConnected(false);
    setScaleType("Unknown");
    setLastWeight(null);
    setStoredDevice(null);
    toast.info("Device forgotten");
  };

  const handleRunDiagnostics = async () => {
    toast.info("Running Bluetooth diagnostics...");
    logConnectionTips();
    const result = await runBluetoothDiagnostics();
    console.log('📋 Diagnostic Results:', result);
    toast.success("Diagnostics complete! Check the browser console (F12) for details.");
  };

  const handleQuickReconnectPrinter = async () => {
    if (!storedPrinter) return;
    
    setIsConnectingPrinter(true);
    const result = await quickReconnectPrinter(storedPrinter.deviceId);

    setIsConnectingPrinter(false);
    if (result.success) {
      setPrinterConnected(true);
      setPrinterName(storedPrinter.deviceName);
      toast.success(`Reconnected to ${storedPrinter.deviceName}`);
    } else {
      toast.error(result.error || "Failed to reconnect. Try searching for device again.");
      setStoredPrinter(null);
    }
  };

  const handleConnectPrinter = async () => {
    setIsConnectingPrinter(true);
    const result = await connectBluetoothPrinter();

    setIsConnectingPrinter(false);
    if (result.success) {
      setPrinterConnected(true);
      setPrinterName(result.deviceName || "Bluetooth Printer");
      toast.success(`Connected to ${result.deviceName || "printer"}`);
    } else {
      toast.error(result.error || "Failed to connect to printer");
    }
  };

  const handleDisconnectPrinter = async () => {
    await disconnectBluetoothPrinter(false);
    setPrinterConnected(false);
    setPrinterName("");
    toast.info("Printer disconnected");
  };

  const handleForgetPrinter = async () => {
    await disconnectBluetoothPrinter(true);
    setPrinterConnected(false);
    setPrinterName("");
    setStoredPrinter(null);
    toast.info("Printer forgotten");
  };

  const isBluetoothAvailable = Capacitor.isNativePlatform() || ('bluetooth' in navigator);

  return (
    <div className="min-h-screen bg-background p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Device Settings</h1>
            <p className="text-sm text-muted-foreground">Configure scales and printers</p>
          </div>
        </div>

        {/* Bluetooth Scale Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bluetooth className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle>Bluetooth Scale</CardTitle>
                  <CardDescription>Connect and test your weighing scale</CardDescription>
                </div>
              </div>
              {scaleConnected ? (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <XCircle className="h-3 w-3" />
                  Disconnected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isBluetoothAvailable && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                Bluetooth is not available on this device
              </div>
            )}

            {storedDevice && !scaleConnected && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium">Last Connected Device</p>
                    <p className="text-xs text-muted-foreground mt-1">{storedDevice.deviceName}</p>
                    <p className="text-xs text-muted-foreground">Type: {storedDevice.scaleType}</p>
                  </div>
                  <Button
                    onClick={handleQuickReconnect}
                    disabled={isConnectingScale}
                    size="sm"
                    className="gap-1"
                  >
                    <Zap className="h-3 w-3" />
                    {isConnectingScale ? "Connecting..." : "Quick Reconnect"}
                  </Button>
                </div>
              </div>
            )}

            {scaleConnected && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Scale Type:</span>
                  <span className="font-medium">{scaleType}</span>
                </div>
                {lastWeight !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Last Reading:</span>
                    <span className="font-medium">{lastWeight} kg</span>
                  </div>
                )}
              </div>
            )}

            <Separator />

            <div className="flex gap-2">
              {!scaleConnected ? (
                <>
                  <Button
                    onClick={handleConnectScale}
                    disabled={!isBluetoothAvailable || isConnectingScale}
                    className="flex-1"
                  >
                    {isConnectingScale ? "Connecting..." : "Search for Scale"}
                  </Button>
                  <Button
                    onClick={handleRunDiagnostics}
                    variant="outline"
                    size="icon"
                    title="Run Diagnostics"
                  >
                    <Bug className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={handleDisconnectScale}
                    variant="destructive"
                    className="flex-1"
                  >
                    Disconnect
                  </Button>
                  <Button
                    onClick={handleForgetDevice}
                    variant="outline"
                    disabled={isConnectingScale}
                  >
                    Forget Device
                  </Button>
                  <Button
                    onClick={handleConnectScale}
                    variant="outline"
                    disabled={isConnectingScale}
                  >
                    {isConnectingScale ? "Testing..." : "Test"}
                  </Button>
                </>
              )}
            </div>
            
            {!scaleConnected && (
              <div className="mt-4 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                <p className="font-semibold mb-2">Having trouble connecting?</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>Ensure scale is powered on and in pairing mode</li>
                  <li>Keep phone within 5 meters of the scale</li>
                  <li>Enable Location permission (Android)</li>
                  <li>Click the <Bug className="inline h-3 w-3" /> button to run diagnostics</li>
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Printer Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Printer className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle>Printer</CardTitle>
                  <CardDescription>Configure receipt printer</CardDescription>
                </div>
              </div>
              {printerConnected ? (
                <Badge variant="default" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <XCircle className="h-3 w-3" />
                  Disconnected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isBluetoothAvailable && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                Bluetooth is not available on this device
              </div>
            )}

            {storedPrinter && !printerConnected && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium">Last Connected Printer</p>
                    <p className="text-xs text-muted-foreground mt-1">{storedPrinter.deviceName}</p>
                  </div>
                  <Button
                    onClick={handleQuickReconnectPrinter}
                    disabled={isConnectingPrinter}
                    size="sm"
                    className="gap-1"
                  >
                    <Zap className="h-3 w-3" />
                    {isConnectingPrinter ? "Connecting..." : "Quick Reconnect"}
                  </Button>
                </div>
              </div>
            )}

            {printerConnected && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Printer Name:</span>
                  <span className="font-medium">{printerName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="font-medium text-green-600">Ready</span>
                </div>
              </div>
            )}

            {!printerConnected && !storedPrinter && (
              <div className="text-sm text-muted-foreground text-center py-2">
                No printer connected
              </div>
            )}

            <Separator />

            <div className="flex gap-2">
              {!printerConnected ? (
                <Button
                  onClick={handleConnectPrinter}
                  disabled={!isBluetoothAvailable || isConnectingPrinter}
                  className="flex-1"
                >
                  {isConnectingPrinter ? "Scanning..." : "Search for Printer"}
                </Button>
              ) : (
                <>
                  <Button
                    onClick={handleDisconnectPrinter}
                    variant="destructive"
                    className="flex-1"
                  >
                    Disconnect
                  </Button>
                  <Button
                    onClick={handleForgetPrinter}
                    variant="outline"
                    disabled={isConnectingPrinter}
                  >
                    Forget Device
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const testText = `
================================
       TEST PRINT
================================

This is a test print from your
Bluetooth thermal printer.

If you can read this, your
printer is working correctly!

Date: ${new Date().toLocaleString()}

================================
`;
                      const result = await printToBluetoothPrinter(testText);
                      if (result.success) {
                        toast.success("Test print sent successfully");
                      } else {
                        toast.error(result.error || "Failed to print");
                      }
                    }}
                  >
                    Test Print
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Company Status - Full Details from psettings */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle>Company Status</CardTitle>
                  <CardDescription>Company details from assigned ccode</CardDescription>
                </div>
              </div>
              {isRefreshingCompany && (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Refreshing...
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Company Code:</span>
                <span className="font-medium">{localStorage.getItem('device_ccode') || 'Not assigned'}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Company Name (cname):</span>
                <span className="font-semibold text-lg">{settings.company_name || companyName || 'Not set'}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Address (caddress):</span>
                <span className="font-medium">{settings.caddress || 'Not set'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Telephone (tel):</span>
                <span className="font-medium">{settings.tel || 'Not set'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Email:</span>
                <span className="font-medium">{settings.email || 'Not set'}</span>
              </div>
            </div>

            <Separator />

            <Button
              onClick={handleRefreshCompany}
              disabled={isRefreshingCompany || !navigator.onLine}
              className="w-full gap-2"
            >
              {isRefreshingCompany ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Refresh Company Data
                </>
              )}
            </Button>
            
            <p className="text-xs text-muted-foreground text-center">
              Fetches latest company details from psettings table based on assigned ccode.
            </p>
          </CardContent>
        </Card>

        {/* App Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Settings2 className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle>App Settings</CardTitle>
                  <CardDescription>Settings synced from psettings table</CardDescription>
                </div>
              </div>
              {isLoadingSettings && (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading...
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Route Label (rdesc):</span>
                <span className="font-medium">{settings.rdesc || '(empty)'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Computed Route Label:</span>
                <span className="font-medium">{routeLabel}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Org Type:</span>
                <span className="font-medium">{settings.orgtype} ({settings.orgtype === 'D' ? 'Dairy' : 'Coffee'})</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Print Copies:</span>
                <span className="font-medium">{settings.printoptions}</span>
              </div>
            </div>

            <Separator />

            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  await refreshSettings();
                  toast.success('App settings refreshed');
                }}
                disabled={isLoadingSettings || !navigator.onLine}
                className="flex-1 gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh Settings
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  localStorage.removeItem('app_settings');
                  localStorage.removeItem('app_settings_ccode');
                  window.location.reload();
                }}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Clear Cache
              </Button>
            </div>
            
            <p className="text-xs text-muted-foreground text-center">
              Clear cache forces a complete refresh from the database (psettings table).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">System Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Platform:</span>
              <span className="font-medium">
                {Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "Web Browser"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bluetooth Available:</span>
              <span className="font-medium">
                {isBluetoothAvailable ? "Yes" : "No"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Settings;
