## Compress Milk/Coffee Receipt Layout

### Current Issues

The receipt has several lines that waste space:

- Blank line after header (`\n` on line 2035)
- Blank line after product name (`\n` on line 2046)
- Blank line after collections list (`\n` on line 2049)
- `Member NO`, `Member Name`, `Reference NO` labels use 14-char padding — can be shortened
- Duplicate date/time printed twice (line 2040 and again at line 2080)
- `Location` and `Location Name` are two separate lines — can merge
- `Member Region` label is verbose

### Optimized Layout (32-char wide)

```text
    COMPANY NAME HERE
  CUSTOMER DELIVERY RECEIPT
--------------------------------
MNO       #12345
Name      John Doe
Ref       ABC123456
Date      2025-01-15 14:30:05
Product   Fresh Milk
--------------------------------
1: REF001                  10.5
2: REF002                  12.0
--------------------------------
Total Kgs              22.50
Cumulative             135.5
--------------------------------
Loc       ABC - Location Name
Route     Route A
Clerk     Jane Smith
Delivered By   Driver Name
Session   Morning
--------------------------------
```

### Changes

**File: `src/services/bluetooth.ts**` (lines 2031-2080)

1. Remove 3 blank lines (after header, after product, after collections)
2. Shorten labels: `Member NO` → `MNO`, `Member Name` → `Name`, `Reference NO` → `Ref`, `Member Region` → `Route`, `Clerk Name` → `Clerk`, `Location` → `Loc`
3. Use 10-char label padding instead of 14
4. Merge `locationCode` + `locationName` into single line: `Loc  CODE - Name`
5. Remove duplicate date/time at bottom (line 2080) — already shown on line 2040
6. Add separator lines before collections and after total for visual clarity
7. Keep all data fields — nothing omitted

**File: `src/constants/appVersion.ts**` — Bump to v2.10.7

### Space Savings

- ~6-7 fewer printed lines per receipt
- Faster print, less paper, same information