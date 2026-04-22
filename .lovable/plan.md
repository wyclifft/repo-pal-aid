

## Fix: Photo Audit Viewer jumps to top after closing a viewed image

### Problem (confirmed in code)

`src/components/PhotoAuditViewer.tsx` renders two separate dialogs:

```tsx
<Dialog open={open && !selectedPhoto}>   {/* photo list */}
<Dialog open={!!selectedPhoto}>           {/* photo detail */}
```

When you tap a thumbnail, `selectedPhoto` is set, which makes the **list dialog's `open` flip to false**. Radix unmounts its content, destroying the scrollable grid `<div className="max-h-[50vh] overflow-y-auto">`. When you close the detail, the list re-mounts as a fresh DOM node with `scrollTop = 0`, so you land at the latest images at the top.

This is purely a state/mount issue — not a routing issue, not a data issue.

### Fix

Keep the list dialog mounted the whole time the viewer is open. Layer the detail dialog on top (Radix supports stacked dialogs).

**Change 1 — keep the list open regardless of `selectedPhoto`:**

```tsx
// Before
<Dialog open={open && !selectedPhoto} onOpenChange={(isOpen) => !isOpen && onClose()}>

// After
<Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
```

This alone preserves the grid's scroll position because the scrollable `<div>` is no longer unmounted when you open a photo.

**Change 2 — defensive scroll restore (belt-and-braces):**

To guarantee the scroll position survives even if a future change re-introduces remounting, wrap the scrollable grid container with a `ref` and:

- On thumbnail click, capture `scrollTop` into a `useRef` (`savedScrollRef.current`) just before calling `setSelectedPhoto(photo)`.
- In a `useEffect` keyed on `selectedPhoto`, when it transitions back to `null`, restore `gridRef.current.scrollTop = savedScrollRef.current` on the next animation frame.

This handles the edge case where Radix briefly hides the underlying dialog while a stacked dialog is open on some browsers.

**Change 3 — small a11y/UX polish (optional, no behavior change):**

Add `data-photo-id={photo.ID}` to each thumbnail button so the restore effect can fall back to `scrollIntoView({ block: 'center' })` of the previously viewed photo if the saved scrollTop is no longer valid (e.g., after a list refresh while the detail was open).

### Files touched

| File | Change |
|---|---|
| `src/components/PhotoAuditViewer.tsx` | Drop `&& !selectedPhoto` from the list `Dialog` `open` prop. Add `gridRef` + `savedScrollRef` + restore `useEffect`. Add `data-photo-id` on each thumbnail. No other logic, no API change. |

### What does NOT change

- `fetchPhotos`, pagination, filters, search, broken-image handling — untouched.
- Backend `/api/transaction-photos` — untouched.
- Multi-tenant route + ccode filtering — untouched (memory: `audit-photo-multi-tenancy`, `backend-store-route-population`).
- Photo file existence check — untouched (memory: `audit-photo-file-verification`).
- Detail dialog content/layout — untouched.

### Verification

1. Open Photo Audit Viewer, scroll down to e.g. the 3rd row of thumbnails.
2. Tap a thumbnail → detail opens with the photo and items.
3. Close the detail (X button or backdrop tap) → list is still scrolled to the same row, **not jumped to the top**.
4. Repeat at page 2/3 → same behavior, scroll position preserved.
5. Change the date filter or search → list correctly resets to top (this path still calls `fetchPhotos` and doesn't go through the restore logic).
6. Refresh photos while detail is open → on close, fallback `scrollIntoView` brings the previously viewed photo back into view (or top if it's been removed).

### Out of scope

- Persisting scroll position across full close/reopen of the viewer (operator opens the viewer, closes the whole modal, reopens later — that resets, by design).
- Changing list ordering or pagination behavior.
- Any backend changes.

