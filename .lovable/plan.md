## Goal
Rename shared debug-log files to embed the **device code**, **app version**, and a **Kenya-time** timestamp (Africa/Nairobi, UTC+3).

## New filename format

```
debug-logs-{DEVCODE}-v{APP_VERSION}-{YYYY-MM-DD_HH-MM-SS}{filter-suffix}.{ndjson|csv}
```

Example:
```
debug-logs-AG05-v2.10.93-2026-05-21_16-14-51-CUM.ndjson
```

- `DEVCODE` → `localStorage.getItem('devcode')`, fallback `UNKNOWN`. Sanitized to `[A-Z0-9]`.
- `APP_VERSION` → imported from `src/constants/appVersion.ts`.
- Timestamp → built from `new Date()` formatted via `Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', ... })`, reshaped to `YYYY-MM-DD_HH-MM-SS`. Note Kenya does not observe DST, so this is always UTC+3.
- Existing `filterSuffix()` (level / tag / search / CUM) is preserved unchanged.

## Files to change

**`src/pages/DebugConsole.tsx`** (only file)
1. Add import: `import { APP_VERSION } from "@/constants/appVersion";`
2. Add a small helper inside the component (or module-scope):
   ```ts
   const buildLogFilename = (ext: "ndjson" | "csv") => {
     const dev = (localStorage.getItem("devcode") || "UNKNOWN")
       .toUpperCase().replace(/[^A-Z0-9]/g, "") || "UNKNOWN";
     const parts = new Intl.DateTimeFormat("en-GB", {
       timeZone: "Africa/Nairobi",
       year: "numeric", month: "2-digit", day: "2-digit",
       hour: "2-digit", minute: "2-digit", second: "2-digit",
       hour12: false,
     }).formatToParts(new Date()).reduce<Record<string,string>>((a,p)=>{a[p.type]=p.value;return a;},{});
     const ts = `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
     return `debug-logs-${dev}-v${APP_VERSION}-${ts}${filterSuffix()}.${ext}`;
   };
   ```
3. Replace the two inline `debug-logs-${new Date().toISOString()...}` filename builders inside `onShareNDJSON` and `onShareCSV` with `buildLogFilename("ndjson")` / `buildLogFilename("csv")`.

## Non-goals / safety
- No changes to log capture, storage, or schema.
- No changes to copy-to-clipboard text format.
- No changes to web vs native export paths — `saveExportedFile` already handles both.
- No backend, Capacitor, or service-worker changes → production app remains untouched aside from the filename string.
