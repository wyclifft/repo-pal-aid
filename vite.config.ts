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
      renderModernChunks: false,
      modernPolyfills: true,
      additionalLegacyPolyfills: ["regenerator-runtime/runtime"],
    }),
    {
      name: 'webview-51-hardened-fix',
      transformIndexHtml(html: string) {
        // WebView 51 crashes on modern module scripts and detection logic.
        // 1. Remove ALL module and preload tags
        var cleanHtml = html
          .replace(/<script type="module".*?><\/script>/g, '')
          .replace(/<script async type="module".*?><\/script>/g, '')
          .replace(/<link rel="modulepreload".*?>/g, '')
          .replace(/<link rel="preload".*?as="script".*?>/g, '');

        // 2. Remove Vite's modern browser detection block (nomodule fix)
        cleanHtml = cleanHtml.replace(/<script nomodule>.*?<\/script>/gs, function(match: string) {
           if (match.indexOf('System.import') !== -1) {
             return match.replace('nomodule', 'type="text/javascript"');
           }
           return '';
        });

        // 3. Force all remaining scripts to be plain text/javascript
        cleanHtml = cleanHtml.replace(/nomodule/g, '');

        return cleanHtml;
      }
    },
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    // esbuild cannot downlevel to ES5 (no async/const/let/destructuring transforms).
    // Emit ES2015 here; @vitejs/plugin-legacy (Babel) handles the final ES5 pass
    // for the nomodule bundle that WebView 51 actually loads.
    target: "es2015",
  },
  build: {
    // plugin-legacy overrides this for the legacy bundle anyway; keep aligned
    // with esbuild target for the intermediate transform.
    target: "es2015",
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
