import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Trash2, Share2, Copy, Search, AlertTriangle, TrendingDown, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_VERSION } from "@/constants/appVersion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { saveExportedFile } from "@/utils/nativeFileExport";
import { plog, type LogLevel, type PLogEntry } from "@/utils/persistentLogger";

const LEVELS: (LogLevel | "all")[] = ["all", "error", "warn", "info", "debug"];

const levelClass: Record<LogLevel, string> = {
  error: "text-red-600",
  warn: "text-amber-600",
  info: "text-blue-600",
  debug: "text-muted-foreground",
};

type ViewMode = "all" | "cumulative";

export default function DebugConsole() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>("all");
  const [rows, setRows] = useState<PLogEntry[]>([]);
  const [cumRows, setCumRows] = useState<PLogEntry[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [tag, setTag] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [stats, setStats] = useState<{ count: number; estBytes: number }>({ count: 0, estBytes: 0 });
  const [autoRefresh, setAutoRefresh] = useState(true);

  const reload = useCallback(async () => {
    await plog.flush();
    const [list, allTags, s, cum] = await Promise.all([
      plog.list({
        level: level === "all" ? undefined : level,
        tag: tag || undefined,
        search: search || undefined,
        limit: 1000,
      }),
      plog.tags(),
      plog.stats(),
      plog.list({ limit: 2000 }).then(rs => rs.filter(r => r.tag.startsWith("CUM"))),
    ]);
    setRows(list);
    setTags(allTags);
    setStats(s);
    setCumRows(cum);
  }, [level, tag, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 2000);
    return () => clearInterval(id);
  }, [autoRefresh, reload]);

  const onClear = async () => {
    const filtersActive =
      view === "cumulative" || level !== "all" || !!tag || !!search;
    if (!filtersActive) {
      if (!confirm("Clear ALL debug logs? This cannot be undone.")) return;
      await plog.clear();
      await reload();
      toast.success("All debug logs cleared");
      return;
    }
    const visible = view === "cumulative" ? cumRows.length : rows.length;
    if (
      !confirm(
        `Delete the ${visible} filtered ${visible === 1 ? "entry" : "entries"}? Pinned rows are preserved.`
      )
    )
      return;
    const f =
      view === "cumulative"
        ? {
            level: level === "all" ? undefined : level,
            search: search || undefined,
            tagPrefix: "CUM",
            includePinned: false,
          }
        : {
            level: level === "all" ? undefined : level,
            tag: tag || undefined,
            search: search || undefined,
            includePinned: false,
          };
    const removed = await plog.deleteFiltered(f);
    await reload();
    toast.success(`Deleted ${removed} filtered ${removed === 1 ? "entry" : "entries"}`);
  };

  /**
   * Build a filter that mirrors what's currently visible on screen so that
   * Share Logs exports ONLY the rows the user is looking at.
   */
  const buildActiveFilter = () => {
    if (view === "cumulative") {
      return {
        level: level === "all" ? undefined : level,
        search: search || undefined,
        tagPrefix: "CUM",
        limit: 10000,
      };
    }
    return {
      level: level === "all" ? undefined : level,
      tag: tag || undefined,
      search: search || undefined,
      limit: 10000,
    };
  };

  const filterSuffix = () => {
    const parts: string[] = [];
    if (view === "cumulative") parts.push("CUM");
    if (level !== "all") parts.push(level);
    if (tag) parts.push(tag.replace(/[^A-Z0-9]+/gi, "_"));
    if (search) parts.push("q-" + search.replace(/[^A-Z0-9]+/gi, "_").slice(0, 20));
    return parts.length ? "-" + parts.join("-") : "";
  };

  const buildLogFilename = (ext: "ndjson" | "csv") => {
    const dev = ((localStorage.getItem("devcode") || "UNKNOWN")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")) || "UNKNOWN";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(new Date()).reduce<Record<string, string>>((a, p) => {
      a[p.type] = p.value;
      return a;
    }, {});
    const ts = `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
    return `debug-logs-${dev}-v${APP_VERSION}-${ts}${filterSuffix()}.${ext}`;
  };

  const onShareNDJSON = async () => {
    const filter = buildActiveFilter();
    const blob = await plog.exportNDJSON(filter);
    const text = await blob.text();
    const lineCount = text ? text.split("\n").length : 0;
    await saveExportedFile(
      buildLogFilename("ndjson"),
      text,
      "application/x-ndjson"
    );
    toast.success(`Shared ${lineCount} filtered entries`);
  };

  const onShareCSV = async () => {
    const filter = buildActiveFilter();
    const blob = await plog.exportCSV(filter);
    const text = await blob.text();
    const lineCount = Math.max(0, (text.match(/\n/g)?.length || 1) - 1);
    await saveExportedFile(
      buildLogFilename("csv"),
      text,
      "text/csv;charset=utf-8"
    );
    toast.success(`Shared ${lineCount} filtered entries`);
  };

  const onCopy = async () => {
    try {
      const text = rows
        .map((r) => `${new Date(r.ts).toISOString()} [${r.level.toUpperCase()}] [${r.tag}] ${r.message}${r.data ? " " + r.data : ""}${r.count && r.count > 1 ? ` (x${r.count})` : ""}`)
        .join("\n");
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${rows.length} entries`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const sizeKb = useMemo(() => Math.round(stats.estBytes / 102.4) / 10, [stats.estBytes]);

  // Cumulative summary
  const cumSummary = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const regressions = cumRows.filter(r => r.tag === "CUM:REGRESSION");
    const regressions24h = regressions.filter(r => r.ts >= dayAgo);
    const edits24h = cumRows.filter(r => (r.tag === "CUM:EDIT" || r.tag === "CUM:INSERT") && r.ts >= dayAgo);
    const recontext24h = cumRows.filter(r => r.tag === "CUM:RECONTEXT" && r.ts >= dayAgo);
    const transient24h = cumRows.filter(r => r.tag === "CUM:TRANSIENT" && r.ts >= dayAgo);
    const staleRejects24h = cumRows.filter(r => r.tag === "CUM:STALE-REJECT" && r.ts >= dayAgo);
    const backendDecreases24h = cumRows.filter(r => r.tag === "CUM:BACKEND-DECREASE" && r.ts >= dayAgo);
    const staleReconciles24h = cumRows.filter(r => r.tag === "CUM:STALE-RECONCILE" && r.ts >= dayAgo);
    const lastSync = cumRows.find(r => r.tag === "CUM:SYNC");
    const errors = cumRows.filter(r => r.level === "error").length;
    return { regressions, regressions24h, edits24h, recontext24h, transient24h, staleRejects24h, backendDecreases24h, staleReconciles24h, lastSync, errors, total: cumRows.length };
  }, [cumRows]);

  return (
    <div className="min-h-screen bg-background">
      <div
        className="sticky top-0 z-10 bg-background border-b"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        {/* Row 1: back + title */}
        <div className="flex items-center gap-2 px-3 pt-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="h-11 w-11 shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold flex-1 truncate">Debug Console</h1>
        </div>

        {/* Row 2: actions — responsive, wrap on small screens, real tap targets */}
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
          <Button variant="outline" size="sm" onClick={() => void reload()} className="h-10 gap-1.5">
            <RefreshCw className="h-4 w-4" />
            <span className="hidden xs:inline sm:inline">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onCopy} className="h-10 gap-1.5">
            <Copy className="h-4 w-4" />
            <span className="hidden xs:inline sm:inline">Copy</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 gap-1.5">
                <Share2 className="h-4 w-4" />
                <span>Share Logs</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onShareNDJSON}>Share filtered (NDJSON)</DropdownMenuItem>
              <DropdownMenuItem onClick={onShareCSV}>Share filtered (CSV)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={onClear} className="h-10 gap-1.5 text-red-600 hover:text-red-700 ml-auto">
            <Trash2 className="h-4 w-4" />
            <span className="hidden xs:inline sm:inline">Clear</span>
          </Button>
        </div>

        <div className="px-3 pt-3 pb-3">
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="all">All Logs</TabsTrigger>
              <TabsTrigger value="cumulative" className="gap-1">
                Cumulative
                {cumSummary.regressions24h.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">
                    {cumSummary.regressions24h.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {view === "all" && (
          <div className="px-3 pb-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search messages, tags, data..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {LEVELS.map((l) => (
                <Badge
                  key={l}
                  variant={level === l ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setLevel(l)}
                >
                  {l}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge
                variant={tag === "" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setTag("")}
              >
                all tags
              </Badge>
              {tags.map((t) => (
                <Badge
                  key={t}
                  variant={tag === t ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setTag(t)}
                >
                  {t}
                </Badge>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {rows.length} shown · {stats.count} total · ~{sizeKb} KB
              </span>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto-refresh
              </label>
            </div>
          </div>
        )}
      </div>

      {view === "all" && (
        <div className="p-3 space-y-1 font-mono text-xs">
          {rows.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No log entries match the current filters.
              </CardContent>
            </Card>
          )}
          {rows.map((r) => (
            <LogRow key={r.id} r={r} />
          ))}
        </div>
      )}

      {view === "cumulative" && (
        <div className="p-3 space-y-3">
          {/* v2.10.95: Active context strip — confirm tcode/scode/icode/devcode at glance */}
          <ActiveContextStrip />
          {/* Summary strip */}
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Last sync</div>
              <div className="font-mono text-sm break-all">
                {cumSummary.lastSync
                  ? cumSummary.lastSync.message
                  : <span className="text-muted-foreground">no sync recorded yet</span>}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Badge variant={cumSummary.regressions24h.length > 0 ? "destructive" : "outline"}>
                  <TrendingDown className="h-3 w-3 mr-1" />
                  {cumSummary.regressions24h.length} regressions / 24h
                </Badge>
                <Badge variant={cumSummary.edits24h.length > 0 ? "secondary" : "outline"}>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {cumSummary.edits24h.length} edits/inserts / 24h
                </Badge>
                <Badge variant="outline">
                  <Shuffle className="h-3 w-3 mr-1" />
                  {cumSummary.recontext24h.length} re-bucketed / 24h
                </Badge>
                <Badge variant="outline" title="Transient backend reads suppressed by the two-read confirmation guard (v2.10.91)">
                  {cumSummary.transient24h.length} transient suppressed / 24h
                </Badge>
                <Badge variant={cumSummary.staleRejects24h.length > 0 ? "destructive" : "outline"} title="Stale backend writes rejected by updateFarmerCumulative (v2.10.117)">
                  {cumSummary.staleRejects24h.length} stale-rejects / 24h
                </Badge>
                <Badge variant="outline">{cumSummary.total} CUM entries</Badge>
              </div>
            </CardContent>
          </Card>

          {/* v2.10.117: Stale-write rejections & backend decreases panel */}
          {(cumSummary.staleRejects24h.length > 0 || cumSummary.backendDecreases24h.length > 0) && (
            <Card className="border-amber-400">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
                    Stale-write rejections & backend decreases ({cumSummary.staleRejects24h.length + cumSummary.backendDecreases24h.length} / 24h)
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1"
                    onClick={async () => {
                      try {
                        const rows = [...cumSummary.staleRejects24h, ...cumSummary.backendDecreases24h]
                          .sort((a, b) => b.ts - a.ts);
                        const text = rows.map((r) => `${new Date(r.ts).toISOString()} [${r.tag}] ${r.message}${r.data ? " " + r.data : ""}`).join("\n");
                        await navigator.clipboard.writeText(text);
                        toast.success(`Copied ${rows.length} rows`);
                      } catch { toast.error("Copy failed"); }
                    }}
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
                <div className="space-y-1 font-mono text-xs">
                  {[...cumSummary.staleRejects24h, ...cumSummary.backendDecreases24h]
                    .sort((a, b) => b.ts - a.ts)
                    .slice(0, 50)
                    .map(r => (<LogRow key={r.id} r={r} />))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* v2.10.118: Auto-heal reconciliations panel */}
          {cumSummary.staleReconciles24h.length > 0 && (
            <Card className="border-emerald-400">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
                    Auto-heal reconciliations ({cumSummary.staleReconciles24h.length} / 24h)
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1"
                    onClick={async () => {
                      try {
                        const rows = [...cumSummary.staleReconciles24h].sort((a, b) => b.ts - a.ts);
                        const text = rows.map((r) => `${new Date(r.ts).toISOString()} [${r.tag}] ${r.message}${r.data ? " " + r.data : ""}`).join("\n");
                        await navigator.clipboard.writeText(text);
                        toast.success(`Copied ${rows.length} rows`);
                      } catch { toast.error("Copy failed"); }
                    }}
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
                <div className="space-y-1 font-mono text-xs">
                  {cumSummary.staleReconciles24h
                    .sort((a, b) => b.ts - a.ts)
                    .slice(0, 50)
                    .map(r => (<LogRow key={r.id} r={r} />))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Regressions panel (pinned, highest priority) */}
          {cumSummary.regressions.length > 0 && (
            <Card className="border-red-300">
              <CardContent className="p-3 space-y-2">
                <div className="text-xs font-semibold text-red-600 uppercase tracking-wider">
                  Cumulative regressions ({cumSummary.regressions.length})
                </div>
                <div className="space-y-1 font-mono text-xs">
                  {cumSummary.regressions.slice(0, 50).map(r => (
                    <LogRow key={r.id} r={r} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* All CUM events */}
          <Card>
            <CardContent className="p-3 space-y-1 font-mono text-xs">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 font-sans">
                Cumulative events ({cumRows.length})
              </div>
              {cumRows.length === 0 && (
                <div className="text-muted-foreground text-center py-4 font-sans">
                  No cumulative events recorded yet.
                </div>
              )}
              {cumRows.slice(0, 500).map(r => (
                <LogRow key={r.id} r={r} />
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function fmtEAT(ms: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(new Date(ms)).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
    return `${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    return new Date(ms).toLocaleTimeString([], { hour12: false });
  }
}

function LogRow({ r }: { r: PLogEntry }) {
  return (
    <div className="border-b border-border/50 py-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-muted-foreground" title="Africa/Nairobi (EAT)">
          {fmtEAT(r.ts)}
        </span>
        <span className={`font-bold ${levelClass[r.level]}`}>
          {r.level.toUpperCase()}
        </span>
        <span className="text-primary">[{r.tag}]</span>
        {r.count && r.count > 1 && (
          <span className="text-amber-600">x{r.count}</span>
        )}
        {r.pinned === 1 && (
          <span className="text-[10px] bg-red-100 text-red-700 px-1 rounded">PIN</span>
        )}
        <span className="break-all">{r.message}</span>
      </div>
      {r.data && (
        <div className="text-muted-foreground break-all pl-2">{r.data}</div>
      )}
      {r.route && (
        <div className="text-[10px] text-muted-foreground/60 pl-2">
          {r.route} · v{r.version}
        </div>
      )}
    </div>
  );
}

/**
 * v2.10.95: Show the currently-selected dashboard context so log readers can
 * confirm at a glance which route/season/product the device is on when the
 * snapshot was captured. Pure read from localStorage — no side effects.
 */
function ActiveContextStrip() {
  const ctx = (() => {
    const out: { devcode?: string; tcode?: string; scode?: string; icode?: string; ccode?: string } = {};
    try {
      const raw = localStorage.getItem("active_session_data");
      if (raw) {
        const d = JSON.parse(raw);
        if (d?.route?.tcode) out.tcode = String(d.route.tcode).trim();
        if (d?.product?.icode) out.icode = String(d.product.icode).trim().toUpperCase();
        if (d?.session?.SCODE) out.scode = String(d.session.SCODE).trim();
      }
    } catch { /* noop */ }
    try {
      out.devcode = localStorage.getItem("devcode") || undefined;
      out.ccode = localStorage.getItem("device_ccode") || undefined;
    } catch { /* noop */ }
    return out;
  })();

  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Active context</div>
        <div className="flex flex-wrap gap-1.5 font-mono text-xs">
          <Badge variant="outline">devcode: {ctx.devcode || "?"}</Badge>
          <Badge variant="outline">tcode: {ctx.tcode || "?"}</Badge>
          <Badge variant="outline">scode: {ctx.scode || "?"}</Badge>
          <Badge variant="outline">icode: {ctx.icode || "?"}</Badge>
          {ctx.ccode && <Badge variant="outline">ccode: {ctx.ccode}</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}
