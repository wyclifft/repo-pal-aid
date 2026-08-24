# Tasks: Dairy Session Logic Fixes

- [x] Implement `findActiveSessionDairy` helper in `server.js`
- [x] Update `/api/sessions/active/` to use the helper
- [x] Update `POST /api/milk-collection` to use the helper for session resolution
- [x] Update `POST /api/sales` to use the helper for session resolution
- [x] Verify fixes for boundary, midnight, and 18:35 cases
