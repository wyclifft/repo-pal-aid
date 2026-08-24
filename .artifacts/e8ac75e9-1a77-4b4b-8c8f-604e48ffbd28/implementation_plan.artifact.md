# Fix Visibility of Spinner and Progress Bar in SyncOverlay

The `SyncOverlay` component currently uses the `primary` color for the spinner, the pulse (ping) effect, and the progress bar indicator. In this project, the `primary` color is very dark (almost black). Since the `SyncOverlay` has a dark background (`#1A1F2C`), these elements are nearly invisible.

This plan will update these elements to use lighter colors (white/off-white) to ensure they are visible on the dark background.

## User Review Required

> [!IMPORTANT]
> I am assuming "purse" in the request refers to either the "pulse" (ping animation) or the "progress" bar indicator, both of which are currently dark and hard to see. I will update both to be visible.

## Proposed Changes

### [UI Components]

#### [MODIFY] [progress.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/ui/progress.tsx)
- Update the `Progress` component to accept an optional `indicatorClassName` prop to allow customizing the color of the progress indicator.

### [Components]

#### [MODIFY] [SyncOverlay.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/SyncOverlay.tsx)
- Change the `Loader2` spinner color from `text-primary` to `text-white`.
- Change the ping animation background from `bg-primary/20` to `bg-white/20`.
- Change the icon container background from `bg-primary/20` to `bg-white/10`.
- Pass `indicatorClassName="bg-white"` to the `Progress` component to make the progress bar visible.

## Verification Plan

### Manual Verification
- Trigger a sync operation in the app (e.g., by logging in or manually syncing) and verify that:
    - The circular spinner is clearly visible (white).
    - The pulse/ping animation around the spinner is visible.
    - The progress bar indicator is clearly visible (white) as it fills up.
