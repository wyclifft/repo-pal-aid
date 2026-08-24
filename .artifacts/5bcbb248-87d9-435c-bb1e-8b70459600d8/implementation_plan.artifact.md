# Implementation Plan - Store Portal Member Served Confirmation

Implement a confirmation prompt in the Store Portal that triggers when selecting a member who has already been served on the same device today.

## User Review Required

> [!IMPORTANT]
> The confirmation prompt will use the standard `Dialog` component for consistency with the existing Store UI. It will appear immediately upon member selection (either via manual ID entry or search).

## Proposed Changes

### [Store Portal]

#### [NEW] [servedMemberTracker.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/utils/servedMemberTracker.ts)
- Create a utility to track member IDs served on the current date using `localStorage`.
- Methods: `markMemberAsServed(memberId: string)`, `isMemberServedToday(memberId: string)`.
- Key format: `store_served_members_${YYYY-MM-DD}`.

#### [MODIFY] [Store.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/Store.tsx)
- Import the new tracker utility.
- Add state for a new confirmation dialog: `showAlreadyServedConfirm`, `pendingFarmer`.
- Update `handleEnter` and search selection to check `isMemberServedToday`.
- If served, show the confirmation dialog instead of selecting immediately.
- Update `handleSubmit` to call `markMemberAsServed` after a successful sale (both online and offline paths).
- Add the confirmation `Dialog` JSX.

## Verification Plan

### Manual Verification
1. Open the Store Portal.
2. Select a member (e.g., M00001).
3. Add an item and click **SUBMIT**.
4. Confirm the sale is completed.
5. Attempt to select the same member (M00001) again.
6. **Expect**: A confirmation prompt "Member already served today. Do you want to sell again?" should appear.
7. Click **Cancel**: Selection is aborted.
8. Click **Continue**: Selection proceeds normally.
9. Verify that other members do not trigger the prompt unless they are also served today.
10. Verify that the check persists across app restarts but resets on the next calendar day.
