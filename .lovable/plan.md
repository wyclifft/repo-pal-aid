

# Fix Build Error: Missing Terser Dependency

## Problem
The build fails with: `terser not found. Since Vite v3, terser has become an optional dependency. You need to install it.`

This happens because `@vitejs/plugin-legacy` (used for Android 7/Chrome 51 compatibility) requires `terser` to minify the legacy transpiled chunks. It's not in `package.json`.

## Fix

### File: `package.json`
Add `terser` as a dev dependency:
```json
"devDependencies": {
  ...existing entries...,
  "terser": "^5.31.0"
}
```

This is a single-line addition. No other files need changes. The legacy plugin will then find terser and produce the transpiled bundles for Android 7.

