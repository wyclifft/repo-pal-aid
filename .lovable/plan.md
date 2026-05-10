## Goal

Clean up the printed Member Produce Statement (Periodic Report) so the header is properly centered on the thermal printer and the vertical spacing between sections is compact and consistent.

Scope: print output only (`printMemberProduceStatement` in `src/services/bluetooth.ts`). The on-screen preview (`PeriodicReportReceipt.tsx`) is already tight and will not be touched. No backend, no business logic, no new versions/SW bumps required.

## Problems observed on the printout

1. **Header drifts right** — `DEMO COFFEE FCS LTD` and `CENTER: KK FACTORY` are centered using space-padding to `W=32`. On printers whose actual column width is 48, the space-padded text shifts visually to the right. Switching to ESC/POS `ALIGN_CENTER` (already defined as `[ESC, 0x61, 0x01]`) makes the printer center the trimmed text natively, regardless of column width.
2. **Big gaps between sections** — blank `'\n'` lines exist after the header dash, after the title block, after member info, before TOTAL, and after TOTAL (5 blank lines plus internal padding). This produces the "very big spacing between 1st, 2nd and 3rd section" the user is seeing.
3. **Member info block** has a `dotLine` separator between every field plus a trailing blank line, adding 3 extra lines that aren't needed.

## Changes (single function, `printMemberProduceStatement`)

Inside `src/services/bluetooth.ts`, lines ~2667–2755:

1. **Use native ESC/POS centering for the header block** instead of `centerText(...)` space padding:
   - Emit `ALIGN_CENTER` bytes, write company name, optional `CENTER: <name>`, the title `MEMBER PRODUCE STATEMENT`, and the date range, then emit `ALIGN_LEFT` before the body.
   - Use the existing `ESC_POS.ALIGN_CENTER` / `ALIGN_LEFT` constants already defined around line 1918.
2. **Remove redundant blank lines**:
   - Drop the `'\n'` between header dashLine and title (line 2682).
   - Drop the `'\n'` between title dashLine and member info (line 2688).
   - Drop the `'\n'` after member info (line 2695).
   - Drop the `'\n'` before TOTAL (line 2744).
   - Drop the `'\n'` after TOTAL dashLine (line 2751).
   - Keep one feed before the footer and the final 3-line feed for paper tear.
3. **Compact member info**:
   - Print `MEMBER NO` and `MEMBER NAME` on consecutive lines with a single `dotLine` separator after the pair, instead of one between each.
4. **Reduce inter-group spacing** in the multi-product loop:
   - Replace the `if (idx > 0) receipt += '\n'` (line 2724) with no extra blank line; the dashLine under each section header already provides visual separation.
5. **Top feed**: keep the existing `'\n\n'` at the top so the company name doesn't print on the tear edge.

No changes to grouping logic, totals, hydration, or fallbacks — only formatting/whitespace.

## Verification

- Re-open the Periodic Report dialog and click Print on a member with multiple `icode` rows; confirm:
  - Company name and CENTER line are visually centered on the paper.
  - Sections (header / title / member / first product table / total / footer) sit close together with at most one blank line between them.
  - Multi-product receipts still show one labeled section per `icode` with subtotals, followed by a single TOTAL.
- Re-test with a single-product member to confirm the legacy single-section layout is still clean.

## Files touched

- `src/services/bluetooth.ts` (only the `printMemberProduceStatement` function body)
