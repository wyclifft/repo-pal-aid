import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Trash2, Download, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { plog, type LogLevel, type PLogEntry } from "@/utils/persistentLogger";

const LEVELS: (LogLevel | "all")[] = ["all", "error", "warn", "info", "debug"];

const levelClass: Record<LogLevel, string> = {
  error: "text-red-600",
  warn: "text-amber-600",
  info: "text-blue-600",
  debug: "text-muted-foreground",
};

export default function DebugConsole() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PLogEntry[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [tag, setTag] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [stats, setStats] = useState<{ count: number; estBytes: number }>({ count: 0, estBytes: 0 });
  const [autoRefresh, setAutoRefresh] = useState(true);

  const reload = useCallback(async () => {
    await plog.flush();
    const [list, allTags, s] = await Promise.all([
      plog.list({
        level: level === "all" ? undefined : level,
        tag: tag || undefined,
        search: search || undefined,
        limit: 1000,
      }),
      plog.tags(),
      plog.stats(),
    ]);
    setRows(list);
    setTags(allTags);
    setStats(s);
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
    if (!confirm("Clear all debug logs? This cannot be undone.")) return;
    await plog.clear();
    await reload();
    toast.success("Debug logs cleared");
  };

  const downloadBlob = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `debug-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onExportNDJSON = async () => {
    const blob = await plog.exportNDJSON();
    downloadBlob(blob, "ndjson");
    toast.success("NDJSON exported");
  };

  const onExportCSV = async () => {
    const blob = await plog.exportCSV();
    downloadBlob(blob, "csv");
    toast.success("CSV exported");
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

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="flex items-center gap-2 p-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold flex-1">Debug Console</h1>
          <Button variant="ghost" size="icon" onClick={() => void reload()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onCopy} title="Copy visible">
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onExport} title="Export NDJSON">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClear} title="Clear all">
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>

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
      </div>

      <div className="p-3 space-y-1 font-mono text-xs">
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              No log entries match the current filters.
            </CardContent>
          </Card>
        )}
        {rows.map((r) => (
          <div key={r.id} className="border-b border-border/50 py-1.5">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-muted-foreground">
                {new Date(r.ts).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={`font-bold ${levelClass[r.level]}`}>
                {r.level.toUpperCase()}
              </span>
              <span className="text-primary">[{r.tag}]</span>
              {r.count && r.count > 1 && (
                <span className="text-amber-600">x{r.count}</span>
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
        ))}
      </div>
    </div>
  );
}
