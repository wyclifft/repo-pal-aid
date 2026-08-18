import { useState, useEffect, useCallback } from 'react';
import { Search, Calendar, Filter, Building2, User, Receipt, Download, Loader2, Clock, Tag } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { mysqlApi, type SupervisorStore, type SupervisorTransaction } from '@/services/mysqlApi';
import { useAuth } from '@/contexts/AuthContext';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';

export const SupervisorTransactions = () => {
  const { currentUser } = useAuth();
  const [stores, setStores] = useState<SupervisorStore[]>([]);
  const [transactions, setTransactions] = useState<SupervisorTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    store_tcode: 'all',
    search: '',
    date_from: format(new Date(), 'yyyy-MM-01'), // Start of month
    date_to: format(new Date(), 'yyyy-MM-dd'),
  });

  // v2.12.19: Format date and time to Kenya/Nairobi (EAT) 12-hour format using native Intl
  const formatEAT = (dateStr: string, timeStr: string) => {
    try {
      // transdate might be ISO string or YYYY-MM-DD
      const dateObj = dateStr.includes('T') ? parseISO(dateStr) : parseISO(`${dateStr}T${timeStr || '00:00:00'}`);

      return new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      }).format(dateObj);
    } catch (e) {
      return timeStr || '00:00:00';
    }
  };

  const formatDateOnly = (dateStr: string) => {
    try {
      const baseDate = dateStr.includes('T') ? parseISO(dateStr) : parseISO(dateStr);
      return format(baseDate, 'dd/MM/yyyy');
    } catch (e) {
      return dateStr;
    }
  };

  const fetchStores = useCallback(async () => {
    if (!currentUser?.user_id) return;
    try {
      const fingerprint = await generateDeviceFingerprint();
      const resp = await mysqlApi.supervisor.getAuthorizedStores(currentUser.user_id, fingerprint);
      if (resp.success && resp.data) {
        setStores(resp.data);
      }
    } catch (err) {
      console.error('Failed to fetch supervisor stores:', err);
    }
  }, [currentUser]);

  const fetchTransactions = useCallback(async () => {
    if (!currentUser?.user_id) return;
    setLoading(true);
    try {
      const fingerprint = await generateDeviceFingerprint();
      const resp = await mysqlApi.supervisor.getTransactions({
        userid: currentUser.user_id,
        device_fingerprint: fingerprint,
        store_tcode: filters.store_tcode === 'all' ? undefined : filters.store_tcode,
        search: filters.search,
        date_from: filters.date_from,
        date_to: filters.date_to,
      });
      if (resp.success && resp.data) {
        setTransactions(resp.data);
      } else {
        toast.error(resp.error || 'Failed to fetch transactions');
      }
    } catch (err) {
      toast.error('Network error while fetching transactions');
    } finally {
      setLoading(false);
    }
  }, [currentUser, filters]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTransactions();
    }, 500); // Debounce search
    return () => clearTimeout(timer);
  }, [fetchTransactions]);

  const handleExport = () => {
    if (transactions.length === 0) return;

    const headers = ['Date', 'Time (EAT)', 'Reference', 'Member ID', 'Member Name', 'Item Code', 'Item Name', 'Qty', 'Price', 'Amount', 'Clerk', 'Location'];
    const csvContent = [
      headers.join(','),
      ...transactions.map(t => [
        t.transdate,
        formatEAT(t.transdate, t.transtime),
        t.transrefno,
        t.memberno,
        `"${t.farmer_name || ''}"`,
        t.icode,
        `"${t.item_name || ''}"`,
        t.weight,
        t.iprice,
        t.amount,
        `"${t.clerk}"`,
        t.ccode
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `transactions_${filters.date_from}_to_${filters.date_to}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 p-3 md:p-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between gap-4">
        <div className="hidden md:block">
          <h2 className="text-xl font-bold tracking-tight">Supervisor Monitoring</h2>
          <p className="text-xs text-muted-foreground">Monitor store transactions across locations.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={transactions.length === 0}
          className="w-full md:w-auto h-9"
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card className="shadow-sm border-muted/60">
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">Location</label>
              <Select
                value={filters.store_tcode}
                onValueChange={(v) => setFilters(f => ({ ...f, store_tcode: v }))}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="All Stores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stores</SelectItem>
                  {stores.map(s => (
                    <SelectItem key={s.tcode} value={s.tcode}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-1">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="ID, Ref..."
                  className="pl-7 h-9 text-xs"
                  value={filters.search}
                  onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">From</label>
              <Input
                type="date"
                className="h-9 text-xs px-2"
                value={filters.date_from}
                onChange={(e) => setFilters(f => ({ ...f, date_from: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">To</label>
              <Input
                type="date"
                className="h-9 text-xs px-2"
                value={filters.date_to}
                onChange={(e) => setFilters(f => ({ ...f, date_to: e.target.value }))}
              />
            </div>
          </div>

          {transactions.length > 0 && (
            <div className="mt-3 pt-2 border-t flex items-center justify-between text-[11px] font-bold text-muted-foreground uppercase tracking-tight">
              <div className="flex items-center gap-2">
                <span>{transactions.length} Records</span>
              </div>
              <div className="flex items-center gap-1">
                <span>Total:</span>
                <span className="text-primary">
                  {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(
                    transactions.reduce((sum, t) => sum + Number(t.amount || 0), 0)
                  )}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-1.5">
        {loading ? (
          <div className="py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Fetching records...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
            <Filter className="h-6 w-6 opacity-20 mx-auto mb-2" />
            <p className="text-xs">No records found.</p>
          </div>
        ) : (
          transactions.map((t) => (
            <div
              key={t.ID}
              className="bg-white dark:bg-card border rounded-md p-2 shadow-sm hover:shadow-md transition-all active:scale-[0.99] border-l-4 border-l-primary/70"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="secondary" className="px-1 py-0 text-[9px] font-mono whitespace-nowrap shrink-0 h-4">
                    {t.transrefno.slice(-8)}
                  </Badge>
                  <h3 className="font-bold text-xs truncate uppercase text-foreground/90">
                    {t.farmer_name || 'Unknown'}
                  </h3>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-black text-xs text-primary">
                    {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(t.amount)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-1 shrink-0">
                      <User className="h-3 w-3 opacity-60" />
                      <span className="font-medium">{t.memberno}</span>
                    </div>
                    <div className="flex items-center gap-1 min-w-0">
                      <Tag className="h-3 w-3 opacity-60 shrink-0" />
                      <span className="font-medium truncate">{t.icode} - {t.item_name || 'N/A'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-muted-foreground uppercase mt-0.5">
                    <div className="flex items-center gap-1">
                      <span className="opacity-70">By:</span>
                      <span className="truncate max-w-[80px]">{t.clerk}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="opacity-30 mx-0.5">|</span>
                      <span className="opacity-70">Loc:</span>
                      <span className="font-bold text-foreground/70">{t.ccode}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end shrink-0 gap-1 pl-2 border-l border-muted/30">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-foreground">
                    <Clock className="h-3 w-3 text-primary/70" />
                    <span>{formatEAT(t.transdate, t.transtime)}</span>
                  </div>
                  <div className="text-[9px] text-muted-foreground font-medium flex items-center gap-1">
                    <Calendar className="h-2.5 w-2.5 opacity-50" />
                    {formatDateOnly(t.transdate)}
                  </div>
                  <Badge className="text-[8px] px-1 py-0 h-3.5 bg-muted text-muted-foreground hover:bg-muted font-black">
                    {t.weight} Qty
                  </Badge>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
