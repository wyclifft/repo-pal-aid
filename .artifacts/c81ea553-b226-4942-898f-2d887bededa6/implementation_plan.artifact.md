# Filter Group Members and Restrict Portal Usage

This plan updates the `gender='group'` implementation to be exclusive to the **Buy Produce** portal and restricts the dropdown members to those with an **'M'** prefix in their `memberno` (e.g., `M00001`). It also removes the group-related logic from the **Sell Produce** portal.

## User Review Required

> [!IMPORTANT]
> The `gender='group'` logic will be completely removed from the Sell Produce portal. If any farmers in Sell Produce were intended to use this feature, they will now only have a standard text input for the "Delivered By" field.

## Proposed Changes

### [Buy Produce Component]

#### [MODIFY] [BuyProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/BuyProduceScreen.tsx)
- Filter the `allFarmers` prop to only include members whose `farmer_id` (memberno) starts with 'M' (case-insensitive).
- Pass this filtered list to the `DeliveredBySearch` component.

### [Sell Produce Component]

#### [MODIFY] [SellProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/SellProduceScreen.tsx)
- Remove the `useEffect` that auto-focuses the "Delivered By" input when a group member is selected.
- Remove the conditional rendering of `DeliveredBySearch` in the JSX, replacing it with a standard text input.
- Remove the asterisk (`*`) from the label when a group member is selected.
- Remove the `isGroup` logic from the `Capture` button's disabled state.
- Remove the `DeliveredBySearch` import if it's no longer used.

## Verification Plan

### Manual Verification
- **Buy Produce Portal**:
    - Select a farmer with `gender='group'`.
    - Verify that the "Delivered By" field shows a searchable dropdown.
    - Search for members and ensure ONLY those starting with 'M' are listed.
    - Ensure members starting with 'D' are NOT listed.
- **Sell Produce Portal**:
    - Select a farmer with `gender='group'`.
    - Verify that the "Delivered By" field remains a standard text input.
    - Verify that no searchable dropdown appears.
    - Verify that the "Capture" button is NOT blocked by an empty "Delivered By" field (other than the standard `weight > 0` check).
