import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, Bluetooth, Printer, CheckCircle2, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { connectBluetoothScale, disconnectBluetoothScale, ScaleType } from "@/services/bluetooth";

const Settings = () => {
  const navigate = useNavigate();
  const [scaleConnected, setScaleConnected] = useState(false);
  const [scaleType, setScaleType] = useState<ScaleType>("Unknown");
  const [isConnectingScale, setIsConnectingScale] = useState(false);
  const [lastWeight, setLastWeight] = useState<number | null>(null);
  
  const [printerConnected, setPrinterConnected] = useState(false);
  const [isConnectingPrinter, setIsConnectingPrinter] = useState(false);

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
    await disconnectBluetoothScale();
    setScaleConnected(false);
    setScaleType("Unknown");
    setLastWeight(null);
    toast.info("Scale disconnected");
  };

  const handleConnectPrinter = async () => {
    setIsConnectingPrinter(true);
    // Placeholder for printer connection logic
    setTimeout(() => {
      setPrinterConnected(true);
      setIsConnectingPrinter(false);
      toast.success("Printer connected");
    }, 1500);
  };

  const handleDisconnectPrinter = async () => {
    setPrinterConnected(false);
    toast.info("Printer disconnected");
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
                  {isConnectingScale ? "Connecting..." : "Connect Scale"}
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
                    onClick={handleConnectScale}
                    variant="outline"
                    disabled={isConnectingScale}
                  >
                    {isConnectingScale ? "Testing..." : "Test Connection"}
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
            {printerConnected && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Printer Type:</span>
                  <span className="font-medium">Bluetooth Thermal</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <span className="font-medium text-green-600">Ready</span>
                </div>
              </div>
            )}

            <Separator />

            <div className="flex gap-2">
              {!printerConnected ? (
                <Button
                  onClick={handleConnectPrinter}
                  disabled={isConnectingPrinter}
                  className="flex-1"
                >
                  {isConnectingPrinter ? "Connecting..." : "Connect Printer"}
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
                    variant="outline"
                    onClick={() => toast.success("Test print sent")}
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
