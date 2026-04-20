

## Fix Add Member Modal: Toast Visibility + Numeric-Only ID Field — v2.10.47

### Problems
1. **Toast blocked by modal**: The Sonner toast appears behind the `Dialog` overlay, so users never see success/error feedback while the modal is open.
2. **ID Number accepts letters**: The `idno` field regex allows `A-Za-z`, but national ID numbers should be digits only.

### Changes

| File | Change |
|------|--------|
| `src/components/AddMemberModal.tsx` | **Toast z-index**: Add `style={{ zIndex: 99999 }}` or a custom Sonner `toastOptions` className isn't needed — instead, move the Sonner `<Toaster />` to render with a higher z-index. However since `<Toaster>` is global, the simpler fix is to ensure the inline success `<Alert>` banner (already in the modal) is the primary feedback, and additionally set `toast.success(msg, { position: 'top-center' })` so the toast renders above the dialog. **Alternatively and more reliably**: set the Dialog's `modal` prop behavior so toasts render above it by adding a custom CSS class. The cleanest fix: add a `className` with `z-[9999]` to the Sonner Toaster in the app root. |
| `src/components/AddMemberModal.tsx` | **ID Number validation**: Change the Zod regex from `/^[0-9A-Za-z\-]+$/` to `/^[0-9]+$/` (digits only). Update the `<Input>` for `idno` to use `type="tel"` and `inputMode="numeric"` so mobile keyboards show the number pad. Update placeholder to `"e.g. 12345678"`. |
| `src/components/ui/sonner.tsx` | Add `style={{ zIndex: 99999 }}` to the `<Toaster>` component so toasts always render above dialogs (Radix Dialog uses z-index ~50). |
| `src/constants/appVersion.ts` | Bump to **v2.10.47 (Code 69)** |

### Detail

**Toast fix** — Radix `Dialog` portal renders at z-index ~50. Sonner's default `<Toaster>` doesn't set a z-index high enough to appear above it. Adding `style={{ zIndex: 99999 }}` to the Sonner `<Toaster>` in `sonner.tsx` fixes this globally for all modals, not just AddMember.

**ID field fix** — Change the regex to `/^[0-9]+$/`, set `type="tel"` and `inputMode="numeric"` on the input, and update the error message to `"ID number must contain only digits"`.

### No Other Changes
- No backend changes.
- No schema changes.
- Inline success banner already works — this just ensures the toast fallback is also visible.

