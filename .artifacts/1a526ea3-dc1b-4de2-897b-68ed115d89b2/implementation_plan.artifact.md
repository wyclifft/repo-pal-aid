# Implementation Plan - Add Back Button to Sacco Portal

The Sacco Portal currently lacks a "Back" button in its header, which makes it difficult for users on desktop browsers to return to the main Dashboard after navigating to the portal via the menu. This plan adds a standard "Back" button to the Sacco Portal header.

## User Review Required

> [!IMPORTANT]
> The "Back" button will navigate to the root path (`/`), which is the standard Dashboard. This assumes the user has access to the main app dashboard. If some users are *only* intended to see the Sacco Portal and never the Dashboard, they might see a "Back" button that takes them to a page they can't use (though they would likely be redirected to login anyway). Given the current project state where `portalMode` is disabled, this is the correct approach.

## Proposed Changes

### Sacco Module

#### [MODIFY] [SaccoPortal.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/modules/sacco/SaccoPortal.tsx)
- Import `useNavigate` from `react-router-dom`.
- Import `ArrowLeft` from `lucide-react`.
- Add a "Back" button to the left of the portal title in the header.
- Implement the click handler to navigate to `/`.

## Verification Plan

### Manual Verification
- Open the application on a desktop browser.
- Login and navigate to the Sacco Portal via the menu.
- Verify that a "Back" button (arrow icon) is visible in the header.
- Click the "Back" button and verify it navigates back to the main Dashboard.
- Verify that the button is well-aligned with the title and other header elements.
