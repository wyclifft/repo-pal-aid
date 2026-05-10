import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { CalendarIcon, FileText, Printer, User } from "lucide-react";
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
import { useAppSettings } from "@/hooks/useAppSettings";
import { PeriodicReportReceipt } from "@/components/PeriodicReportReceipt";
import type { Farmer } from "@/lib/supabase";

export default function PeriodicReport() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { produceLabel, routeLabel, weightUnit, weightLabel } = useAppSettings();
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();

  // Check authentication
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);
  const [farmerSearch, setFarmerSearch] = useState("");
  const [reportData, setReportData] = useState<PeriodicReportData[]>([]);
  const [loading, setLoading] = useState(false);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>("");
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  // v2.10.53: read active route from Dashboard's persisted session so report
  // is scoped to the same route/center the operator is currently working on.
  const [activeRoute, setActiveRoute] = useState<{ tcode: string; descript: string } | null>(null);

  // Receipt modal state
  const [selectedFarmer, setSelectedFarmer] = useState<{ id: string; name: string } | null>(null);

  // v2.10.77: live member autocomplete state
  const [allFarmers, setAllFarmers] = useState<Farmer[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { saveFarmers, savePeriodicReport, getPeriodicReport, getFarmers } = useIndexedDB();

  useEffect(() => {
    const initDevice = async () => {
      const fingerprint = await generateDeviceFingerprint();
      setDeviceFingerprint(fingerprint);
    };
    initDevice();

    // v2.10.53: load active route from persisted Dashboard session
    try {
      const raw = localStorage.getItem('active_session_data');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.route?.tcode) {
          setActiveRoute({
            tcode: String(parsed.route.tcode).trim(),
            descript: String(parsed.route.descript || parsed.route.tcode).trim(),
          });
        }
      }
    } catch (e) {
      console.warn('Could not read active route from localStorage:', e);
    }

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // v2.10.77: load cached members for the autocomplete (offline-safe)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await getFarmers();
        if (!cancelled && Array.isArray(list)) setAllFarmers(list);
      } catch (e) {
        // No cached members yet — autocomplete simply has no suggestions.
      }
    };
    // Defer slightly so IndexedDB is ready
    const t = setTimeout(load, 50);
    return () => { cancelled = true; clearTimeout(t); };
  }, [getFarmers]);

  // v2.10.77: derive ranked suggestions from current input
  const suggestions = useMemo(() => {
    const q = farmerSearch.trim();
    if (!q) return [] as Farmer[];
    const qLower = q.toLowerCase();
    const numeric = q.replace(/\D/g, '');
    const isPureNumeric = numeric.length > 0 && numeric === q;
    const paddedId = isPureNumeric ? `M${numeric.padStart(5, '0')}` : '';

    const scored: Array<{ f: Farmer; score: number }> = [];
    for (const f of allFarmers) {
      const idUp = (f.farmer_id || '').toUpperCase();
      const nameLow = (f.name || '').toLowerCase();
      const idNumeric = (f.farmer_id || '').replace(/\D/g, '');
      let score = -1;

      if (idUp === q.toUpperCase()) score = 100;
      else if (paddedId && idUp === paddedId) score = 95;
      else if (paddedId && idUp.startsWith(paddedId)) score = 90;
      else if (isPureNumeric && idNumeric.startsWith(numeric)) score = 80;
      else if (idUp.startsWith(q.toUpperCase())) score = 70;
      else if (nameLow.startsWith(qLower)) score = 60;
      else if (nameLow.includes(qLower)) score = 40;
      else if (!isPureNumeric && idUp.includes(q.toUpperCase())) score = 30;

      if (score >= 0) scored.push({ f, score });
    }
    scored.sort((a, b) => b.score - a.score || (a.f.name || '').localeCompare(b.f.name || ''));
    return scored.slice(0, 8).map(s => s.f);
  }, [farmerSearch, allFarmers]);

  // Reset highlight when suggestions change
  useEffect(() => { setHighlightIdx(0); }, [suggestions.length]);

  // v2.10.77: pick a member from the suggestion list — auto-opens the receipt
  const pickFarmer = (f: Farmer) => {
    setFarmerSearch(f.farmer_id);
    setShowSuggest(false);
    if (!startDate || !endDate) {
      toast.info("Select start and end dates to view the receipt");
      return;
    }
    setSelectedFarmer({ id: f.farmer_id, name: f.name });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggest || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const f = suggestions[highlightIdx];
      if (f) pickFarmer(f);
    } else if (e.key === 'Escape') {
      setShowSuggest(false);
    }
  };

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
    const formattedStartDate = format(startDate, "yyyy-MM-dd");
    const formattedEndDate = format(endDate, "yyyy-MM-dd");
    // v2.10.53: include route in cache key so per-route caches don't collide
    const routeKey = activeRoute?.tcode || 'ALL';
    const cacheKey = `${formattedStartDate}_${formattedEndDate}_${routeKey}_${farmerSearch.trim()}`;

    console.log("Requesting report with dates:", formattedStartDate, formattedEndDate, "route:", routeKey);

    // 1. ALWAYS load from cache first for instant display
    try {
      const cachedData = await getPeriodicReport(cacheKey);
      if (cachedData && cachedData.length > 0) {
        setReportData(cachedData);
        setLoading(false);
        console.log('📦 Loaded periodic report from cache');
      }
    } catch (cacheError) {
      console.error('Cache read error:', cacheError);
    }

    // 2. Then fetch fresh data in background if online
    if (navigator.onLine) {
      try {
        const response = await mysqlApi.periodicReport.get(
          formattedStartDate,
          formattedEndDate,
          deviceFingerprint,
          farmerSearch.trim() || undefined,
          activeRoute?.tcode || undefined
        );

        console.log("Report response received:", response);

        // Check for authorization errors — do NOT clear farmer cache
        if (!response.success) {
          if (!reportData || reportData.length === 0) {
            setReportData([]);
            toast.error(response.error || 'Device not authorized. Please contact administrator.');
          }
          console.error('❌ Device authorization error for periodic report');
          setLoading(false);
          return;
        }

        const data = response.data || [];
        setReportData(data);

        // Cache the report for offline access
        await savePeriodicReport(cacheKey, data);
        console.log('✅ Periodic report synced and cached');

        if (data.length === 0) {
          toast.warning(`No ${produceLabel.toLowerCase()} collections found for the selected date range`);
        } else {
          toast.success(`Found ${data.length} farmer(s) with ${produceLabel.toLowerCase()} collections`);
        }
      } catch (error) {
        console.error("Error syncing report:", error);
        // Data already loaded from cache if available
        if (!reportData || reportData.length === 0) {
          toast.error("No data available for this date range");
        }
      }
    } else {
      // Offline mode - data already loaded from cache
      if (!reportData || reportData.length === 0) {
        toast.info("📡 Offline - No cached data available for this date range");
      } else {
        toast.info(`📦 Offline mode - Showing ${reportData.length} cached farmer(s)`);
      }
    }

    setLoading(false);
  };

  const totalWeight = reportData.reduce((sum, item) => sum + (item.total_weight || 0), 0);
  const totalCollections = reportData.reduce((sum, item) => sum + (item.collection_count || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a8a] via-[#3b82f6] to-[#60a5fa] p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="max-w-7xl mx-auto">
          <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold text-gray-900">{produceLabel} Periodic Report</h1>
            </div>
            <DeviceAuthStatus />
          </div>
          {/* v2.10.53: scope badge — operator sees which route is being reported */}
          <div className="mb-6 text-sm text-muted-foreground">
            {routeLabel}: <span className="font-semibold text-gray-800">{activeRoute?.descript || 'All routes'}</span>
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

            {/* v2.10.77: Member Search with live suggestions */}
            <div className="space-y-2 relative">
              <Label>Member Name or ID</Label>
              <Input
                placeholder="Type 1, M00001, or a name…"
                value={farmerSearch}
                onChange={(e) => { setFarmerSearch(e.target.value); setShowSuggest(true); }}
                onFocus={() => setShowSuggest(true)}
                onKeyDown={handleSearchKeyDown}
                onBlur={() => {
                  // Delay so click on suggestion can register before close
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  blurTimer.current = setTimeout(() => setShowSuggest(false), 150);
                }}
                autoComplete="off"
              />
              {showSuggest && suggestions.length > 0 && (
                <div
                  className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {suggestions.map((f, idx) => (
                    <button
                      type="button"
                      key={f.farmer_id}
                      onClick={() => pickFarmer(f)}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm flex items-center gap-2 border-b last:border-b-0",
                        idx === highlightIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      )}
                    >
                      <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="font-mono font-semibold">{f.farmer_id}</span>
                      <span className="text-muted-foreground">—</span>
                      <span className="truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              )}
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
                {reportData.length} Farmer{reportData.length !== 1 ? 's' : ''} | {totalCollections} Collection{totalCollections !== 1 ? 's' : ''} | {totalWeight.toFixed(2)} {weightUnit} Total
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Farmer ID</TableHead>
                    <TableHead>Farmer Name</TableHead>
                    <TableHead>{routeLabel}</TableHead>
                    <TableHead>Total Collections</TableHead>
                    <TableHead>Total Weight ({weightUnit})</TableHead>
                    <TableHead className="text-right">Action</TableHead>
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
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedFarmer({ id: item.farmer_id, name: item.farmer_name })}
                          disabled={!startDate || !endDate}
                        >
                          <Printer className="h-4 w-4 mr-1" />
                          View & Print
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        
        {/* Receipt Modal */}
        {selectedFarmer && startDate && endDate && (
          <PeriodicReportReceipt
            open={!!selectedFarmer}
            onClose={() => setSelectedFarmer(null)}
            farmerId={selectedFarmer.id}
            farmerName={selectedFarmer.name}
            startDate={startDate}
            endDate={endDate}
            deviceFingerprint={deviceFingerprint}
            weightUnit={weightUnit}
            route={activeRoute?.tcode}
          />
        )}
      </div>
    </div>
  );
}
