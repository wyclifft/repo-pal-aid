# Task Checklist - Linked Account 7136 Recovery Handling

- `[x]` Update `backend-api/yetuService.js`
    - `[x]` Update `resolveMember` for prefix fallback
    - `[x]` Update `listTransactions` for prefix-based recovery filtering
    - `[x]` Update `getSummary` for prefix-based recovery filtering
- `[x]` Update `backend-api/yetuRoutes.js`
    - `[x]` Pass all linked accounts to service functions
- `[x]` Update `src/modules/sacco/SaccoPortal.tsx`
    - `[x]` Logic to identify prefix vs specific accounts
    - `[x]` Add recovery selector beside main account picker
- `[x]` Verification
    - `[x]` Verify webhook allocation for mistyped accounts
    - `[x]` Verify portal filtering for recovery accounts
    - `[x]` Verify raw storage of InvoiceNumber (no trim/upper)
    - `[x]` Verify console logs have ISO timestamps
    - `[x]` Verify recovery filter matches prefix exactly as well
