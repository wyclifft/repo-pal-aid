import { useState } from "react";
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
import { mysqlApi, type MilkCollection } from "@/services/mysqlApi";
import { toast } from "sonner";

export default function PeriodicReport() {
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [farmerSearch, setFarmerSearch] = useState("");
  const [reportData, setReportData] = useState<MilkCollection[]>([]);
  const [loading, setLoading] = useState(false);

  const handleGenerateReport = async () => {
    if (!startDate || !endDate) {
      toast.error("Please select both start and end dates");
      return;
    }

    if (startDate > endDate) {
      toast.error("Start date must be before end date");
      return;
    }

    setLoading(true);
    try {
      const data = await mysqlApi.milkCollection.getAll();
      
      // Filter by date range
      let filtered = data.filter((item) => {
        const itemDate = new Date(item.collection_date);
        return itemDate >= startDate && itemDate <= endDate;
      });

      // Filter by farmer if search term provided
      if (farmerSearch.trim()) {
        const searchLower = farmerSearch.toLowerCase();
        filtered = filtered.filter((item) => {
          const farmerId = String(item.farmer_id || '').toLowerCase();
          const farmerName = String(item.farmer_name || '').toLowerCase();
          return farmerId.includes(searchLower) || farmerName.includes(searchLower);
        });
      }

      setReportData(filtered);
      toast.success(`Found ${filtered.length} records`);
    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("Error generating report");
    } finally {
      setLoading(false);
    }
  };

  const totalWeight = reportData.reduce((sum, item) => sum + (item.weight || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a8a] via-[#3b82f6] to-[#60a5fa] p-4">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <FileText className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-gray-900">Periodic Report</h1>
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
              <Label>Farmer Name or ID (Optional)</Label>
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
                Total Records: {reportData.length} | Total Weight: {totalWeight.toFixed(2)} kg
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference No</TableHead>
                    <TableHead>Farmer ID</TableHead>
                    <TableHead>Farmer Name</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead>Weight (kg)</TableHead>
                    <TableHead>Clerk</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>{item.reference_no}</TableCell>
                      <TableCell>{item.farmer_id}</TableCell>
                      <TableCell>{item.farmer_name}</TableCell>
                      <TableCell>{item.route}</TableCell>
                      <TableCell>{item.session}</TableCell>
                      <TableCell>{item.weight}</TableCell>
                      <TableCell>{item.clerk_name}</TableCell>
                      <TableCell>{format(new Date(item.collection_date), "PP")}</TableCell>
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
