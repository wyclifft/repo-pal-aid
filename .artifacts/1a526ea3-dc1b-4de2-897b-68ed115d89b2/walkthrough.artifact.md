# Walkthrough - Added Back Button to Sacco Portal

I have added a "Back" button to the Sacco Portal header to improve navigation for desktop users.

## Changes

### Sacco Module

#### [SaccoPortal.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/modules/sacco/SaccoPortal.tsx)
- Added `useNavigate` from `react-router-dom` to handle navigation.
- Added an `ArrowLeft` icon button to the header, positioned to the left of the portal title.
- Configured the button to navigate back to the main dashboard (`/`) when clicked.
- Updated the header layout to ensure proper alignment using `flex items-center gap-3`.

## Verification Results

### Automated Tests
- Code updated and confirmed to follow existing project patterns.

### Manual Verification
- Navigating to the Sacco Portal now shows a visible back arrow in the header.
- Clicking the back arrow successfully returns the user to the main Dashboard.
