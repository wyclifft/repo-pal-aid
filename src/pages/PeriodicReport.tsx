import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { CalendarIcon, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { mysqlApi, type PeriodicReportData } from "@/services/mysqlApi";
import { toast } from "sonner";
import { generateDeviceFingerprint } from "@/utils/deviceFingerprint";
import { useIndexedDB } from "@/hooks/useIndexedDB";
import { DeviceAuthStatus } from "@/components/DeviceAuthStatus";

export default function PeriodicReport() {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();

  // Check authentication
  useEffect(() => {
    const storedUser = localStorage.getItem('currentUser');
    if (!storedUser) {
      navigate('/', { replace: true });
    }
  }, [navigate]);
  const [farmerSearch, setFarmerSearch] = useState("");
  const [reportData, setReportData] = useState<PeriodicReportData[]>([]);
  const [loading, setLoading] = useState(false);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>("");
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  
  const { saveFarmers, savePeriodicReport, getPeriodicReport } = useIndexedDB();

  useEffect(() => {
    const initDevice = async () => {
      const fingerprint = await generateDeviceFingerprint();
      setDeviceFingerprint(fingerprint);
    };
    initDevice();

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleGenerateReport = async () => {
    if (!startDate || !endDate) {
      toast.error("Please select both start and end dates");
      return;
    }

    if (startDate > endDate) {
      toast.error("Start date must be before end date");
      return;
    }

    if (!deviceFingerprint) {
      toast.error("Device not initialized");
      return;
    }

    setLoading(true);
    try {
      const formattedStartDate = format(startDate, "yyyy-MM-dd");
      const formattedEndDate = format(endDate, "yyyy-MM-dd");
      const cacheKey = `${formattedStartDate}_${formattedEndDate}_${farmerSearch.trim()}`;
      
      console.log("Requesting report with dates:", formattedStartDate, formattedEndDate);
      
      if (navigator.onLine) {
        // Online: Fetch from API
        const response = await mysqlApi.periodicReport.get(
          formattedStartDate,
          formattedEndDate,
          deviceFingerprint,
          farmerSearch.trim() || undefined
        );

        console.log("Report response received:", response);
        
        // Check for authorization errors
        if (!response.success) {
          // Device not authorized - clear any cached farmers
          await saveFarmers([]);
          setReportData([]);
          toast.error(response.error || 'Device not authorized. Please contact administrator.');
          console.error('❌ Device authorization error for periodic report');
          return;
        }
        
        const data = response.data || [];
        setReportData(data);
        
        // Cache the report for offline access
        await savePeriodicReport(cacheKey, data);
        console.log('✅ Periodic report cached for offline use');
        
        if (data.length === 0) {
          toast.warning("No milk collections found for the selected date range");
        } else {
          toast.success(`Found ${data.length} farmer(s) with milk collections`);
        }
      } else {
        // Offline: Load from cache
        const cachedData = await getPeriodicReport(cacheKey);
        if (cachedData) {
          setReportData(cachedData);
          toast.info(`📦 Showing cached report (offline mode) - ${cachedData.length} farmer(s)`);
        } else {
          toast.error("No cached data available for this date range");
          setReportData([]);
        }
      }
    } catch (error) {
      console.error("Error generating report:", error);
      
      // Try to load from cache on error
      try {
        const formattedStartDate = format(startDate, "yyyy-MM-dd");
        const formattedEndDate = format(endDate, "yyyy-MM-dd");
        const cacheKey = `${formattedStartDate}_${formattedEndDate}_${farmerSearch.trim()}`;
        
        const cachedData = await getPeriodicReport(cacheKey);
        if (cachedData) {
          setReportData(cachedData);
          toast.warning(`📦 Using cached data (server unavailable) - ${cachedData.length} farmer(s)`);
        } else {
          toast.error("Error generating report");
          setReportData([]);
        }
      } catch (cacheError) {
        toast.error("Error generating report");
        setReportData([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const totalWeight = reportData.reduce((sum, item) => sum + (item.total_weight || 0), 0);
  const totalCollections = reportData.reduce((sum, item) => sum + (item.collection_count || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a8a] via-[#3b82f6] to-[#60a5fa] p-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold text-gray-900">Periodic Report</h1>
            </div>
            <DeviceAuthStatus />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Start Date */}
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              {isOffline && (
                <span className="text-xs text-orange-600 font-semibold">
                  📡 Offline - Cached data only
                </span>
              )}
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={setEndDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Farmer Search */}
            <div className="space-y-2">
              <Label>Farmer Name or ID</Label>
              <Input
                placeholder="Search by name or ID..."
                value={farmerSearch}
                onChange={(e) => setFarmerSearch(e.target.value)}
              />
            </div>
          </div>

          <Button 
            onClick={handleGenerateReport} 
            disabled={loading}
            className="w-full md:w-auto"
          >
            {loading ? "Generating..." : "Generate Report"}
          </Button>
        </div>

        {/* Results Table */}
        {reportData.length > 0 && (
          <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Report Results</h2>
              <div className="text-sm text-muted-foreground">
                {reportData.length} Farmer{reportData.length !== 1 ? 's' : ''} | {totalCollections} Collection{totalCollections !== 1 ? 's' : ''} | {totalWeight.toFixed(2)} kg Total
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Farmer ID</TableHead>
                    <TableHead>Farmer Name</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Total Collections</TableHead>
                    <TableHead>Total Weight (kg)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>{item.farmer_id}</TableCell>
                      <TableCell>{item.farmer_name}</TableCell>
                      <TableCell>{item.route}</TableCell>
                      <TableCell>{item.collection_count}</TableCell>
                      <TableCell>{item.total_weight.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
