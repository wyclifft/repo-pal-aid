import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import legacy from "@vitejs/plugin-legacy";

// https://vitejs.dev/config/
// v2.11.11 — WebView 51 (Chromium 51) compatibility build.
// Force ES5 output and drop the modern chunk + module-detection block so the
// bundle parses on Android 7 / WebView 51.0.2704.91. See .lovable/plan.md.
export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    legacy({
      targets: ["chrome >= 51", "Android >= 5.0"],
      // Emit ONLY the legacy nomodule bundle. This also removes the inline
      // module/dynamic-import detection block that WebView 51 cannot parse
      // (the "Uncaught SyntaxError: Unexpected token (" at index.html:54).
      renderModernChunks: false,
      modernPolyfills: true,
      additionalLegacyPolyfills: ["regenerator-runtime/runtime"],
    }),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    // Belt & braces: refuse to keep syntax Chromium 51 can't parse, even in
    // third-party dependencies that ship pre-transpiled ESM.
    target: "es5",
    supported: {
      "async-await": false,
      "object-rest-spread": false,
      "optional-chain": false,
      "nullish-coalescing": false,
    },
  },
  build: {
    target: "es5",
    minify: "esbuild",
    cssCodeSplit: true,
    cssMinify: true,
    sourcemap: false,
    // Aggressive code splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router': ['react-router-dom'],
          'query': ['@tanstack/react-query', '@tanstack/react-query-persist-client'],
          'ui': ['@radix-ui/react-dialog', '@radix-ui/react-select', '@radix-ui/react-toast'],
        },
        // Consistent chunk names for better caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
  },
  // Optimize dependencies
  optimizeDeps: {
    // v2.11.11: DO NOT exclude @capacitor/core — excluding it skips the
    // esbuild down-level pass and re-introduces optional chaining that
    // WebView 51 cannot parse.
    include: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
  },
  // Enable caching
  cacheDir: 'node_modules/.vite',
}));
