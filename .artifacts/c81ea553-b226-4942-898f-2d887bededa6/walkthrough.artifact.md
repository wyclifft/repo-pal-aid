# Restricted Group Member Logic and Portal Specificity

I have updated the `gender='group'` implementation to be exclusive to the **Buy Produce** portal and restricted the searchable dropdown to only include members with an **'M'** prefix.

## Changes Made

### [Buy Produce Portal]
- **[BuyProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/BuyProduceScreen.tsx)**:
    - Added a `useMemo` hook to filter `allFarmers` into `groupSearchFarmers`, including only those whose `farmer_id` starts with **'M'** (case-insensitive).
    - Updated the `DeliveredBySearch` component to use this filtered list.
    - Kept the mandatory field logic (asterisk and capture button block) for group members in this portal.

### [Sell Produce Portal]
- **[SellProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/SellProduceScreen.tsx)**:
    - Removed the `useEffect` that auto-focused the "Delivered By" input when a group member was selected.
    - Removed the `DeliveredBySearch` dropdown, replacing it with a standard text input for all farmers, regardless of their `gender` value.
    - Removed the red asterisk (`*`) from the "Delivered By" label.
    - Simplified the `Capture` button logic to no longer block for empty "Delivered By" values even if the farmer is a group member.
    - Cleaned up unused imports (`DeliveredBySearch`).

## Verification Results

### Manual Verification
- **Buy Produce**: Selecting a group member now opens a searchable dropdown that only lists 'M' members. 'D' members are correctly hidden.
- **Sell Produce**: Selecting a group member no longer triggers any special behavior. The "Delivered By" field remains a simple text box, and no mandatory field restrictions are applied for group members.

> [!TIP]
> The `groupSearchFarmers` filter in `BuyProduceScreen.tsx` uses `toUpperCase().startsWith('M')`, which ensures that any member ID starting with 'M' (or 'm') is included, while 'D' (Debtors) and others are excluded.
