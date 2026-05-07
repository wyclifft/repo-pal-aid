/**
 * DebugConsole — persistent in-app log viewer (v2.10.77)
 * Hidden route at /debug. Survives logout & app restart.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, Download, Copy, RefreshCw, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import {
  getLogs,
  clearLogs,
  exportLogsAsText,
  type LogEntry,
  type LogLevel,
} from "@/utils/persistentLogger";

const LEVELS: LogLevel[] = ["log", "info", "warn", "error"];
const RANGES: Array<{ label: string; ms: number | undefined }> = [
  { label: "5m", ms: 5 * 60 * 1000 },
  { label: "1h", ms: 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "All", ms: undefined },
];

const levelColor: Record<LogLevel, string> = {
  log: "bg-muted text-muted-foreground",
  info: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
};

const DebugConsole = () => {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(new Set(LEVELS));
  const [rangeMs, setRangeMs] = useState<number | undefined>(60 * 60 * 1000);
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const rows = await getLogs({ sinceMs: rangeMs, search: search || undefined, limit: 1000 });
    setEntries(rows);
  }, [rangeMs, search]);

  useEffect(() => {
    void refresh();
    if (paused) return;
    const t = setInterval(() => { void refresh(); }, 2000);
    return () => clearInterval(t);
  }, [refresh, paused]);

  const filtered = useMemo(
    () => entries.filter((e) => enabledLevels.has(e.level)),
    [entries, enabledLevels]
  );

  const toggleLevel = (lvl: LogLevel) => {
    setEnabledLevels((prev) => {
      const n = new Set(prev);
      if (n.has(lvl)) n.delete(lvl); else n.add(lvl);
      return n;
    });
  };

  const handleClear = async () => {
    if (!window.confirm("Clear ALL stored logs? This cannot be undone.")) return;
    await clearLogs();
    await refresh();
    toast.success("Logs cleared");
  };

  const handleExport = async () => {
    const all = await getLogs({ limit: 10000 });
    const text = exportLogsAsText(all);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `delicoop-logs-${stamp}.txt`;

    try {
      // Try Capacitor Filesystem on native
      if (Capacitor.isNativePlatform()) {
        const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
        await Filesystem.writeFile({
          path: filename,
          data: text,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        toast.success(`Saved to Documents/${filename}`);
        return;
      }
    } catch (e) {
      console.warn("[DebugConsole] native export failed, falling back", e);
    }
    // Web fallback
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Logs downloaded");
  };

  const handleCopy = async () => {
    const text = exportLogsAsText(filtered);
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${filtered.length} entries`);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center gap-2 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/settings")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-base font-semibold flex-1">Debug Console</h1>
          <Badge variant="secondary">{filtered.length}</Badge>
          <Button size="icon" variant="ghost" onClick={() => setPaused((p) => !p)} title={paused ? "Resume" : "Pause"}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => void refresh()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-4 pb-3 space-y-2">
          <div className="flex flex-wrap gap-1">
            {LEVELS.map((lvl) => (
              <Button
                key={lvl}
                size="sm"
                variant={enabledLevels.has(lvl) ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => toggleLevel(lvl)}
              >
                {lvl.toUpperCase()}
              </Button>
            ))}
            <span className="w-2" />
            {RANGES.map((r) => (
              <Button
                key={r.label}
                size="sm"
                variant={rangeMs === r.ms ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setRangeMs(r.ms)}
              >
                {r.label}
              </Button>
            ))}
          </div>

          <Input
            placeholder="Search log text…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
          />

          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={handleCopy}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={handleExport}>
              <Download className="h-3.5 w-3.5 mr-1" /> Export
            </Button>
            <Button size="sm" variant="destructive" className="flex-1" onClick={handleClear}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-1.5">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No log entries match the current filters.
            </CardContent>
          </Card>
        ) : (
          filtered.map((e, idx) => {
            const id = e.id ?? idx;
            const isOpen = expanded === id;
            const time = new Date(e.ts).toLocaleTimeString();
            const date = new Date(e.ts).toLocaleDateString();
            const preview = e.message.length > 200 && !isOpen ? e.message.slice(0, 200) + "…" : e.message;
            return (
              <button
                key={id}
                onClick={() => setExpanded(isOpen ? null : id)}
                className="w-full text-left rounded-md border bg-card p-2 hover:bg-accent/30 transition"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-medium ${levelColor[e.level]}`}>
                    {e.level.toUpperCase()}
                  </span>
                  <span className="text-muted-foreground font-mono">{time}</span>
                  {isOpen && <span className="text-muted-foreground text-[10px]">{date}</span>}
                  {e.route && <span className="text-muted-foreground text-[10px] ml-auto truncate max-w-[40%]">{e.route}</span>}
                </div>
                <pre className="mt-1 text-xs whitespace-pre-wrap break-words font-mono leading-snug">
                  {preview}
                </pre>
                {isOpen && (e.user || e.version) && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {e.user && <span>user: {e.user}</span>}
                    {e.user && e.version && <span> · </span>}
                    {e.version && <span>v{e.version}</span>}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default DebugConsole;
