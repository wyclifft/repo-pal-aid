import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, Bluetooth, Printer, CheckCircle2, XCircle, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
  ScaleType 
} from "@/services/bluetooth";

const Settings = () => {
  const navigate = useNavigate();
  const [scaleConnected, setScaleConnected] = useState(false);
  const [scaleType, setScaleType] = useState<ScaleType>("Unknown");
  const [isConnectingScale, setIsConnectingScale] = useState(false);
  const [lastWeight, setLastWeight] = useState<number | null>(null);
  const [storedDevice, setStoredDevice] = useState<ReturnType<typeof getStoredDeviceInfo>>(null);
  
  const [printerConnected, setPrinterConnected] = useState(false);
  const [printerName, setPrinterName] = useState<string>("");
  const [isConnectingPrinter, setIsConnectingPrinter] = useState(false);
  const [storedPrinter, setStoredPrinter] = useState<ReturnType<typeof getStoredPrinterInfo>>(null);

  useEffect(() => {
    const deviceInfo = getStoredDeviceInfo();
    setStoredDevice(deviceInfo);
    
    const printerInfo = getStoredPrinterInfo();
    setStoredPrinter(printerInfo);
  }, []);

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
    <div className="min-h-screen bg-background p-4">
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
                <Button
                  onClick={handleConnectScale}
                  disabled={!isBluetoothAvailable || isConnectingScale}
                  className="flex-1"
                >
                  {isConnectingScale ? "Connecting..." : "Search for Scale"}
                </Button>
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

        {/* Platform Info */}
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
