import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import legacy from "@vitejs/plugin-legacy";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "/",
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
  react(),
  legacy({
    targets: ["chrome >= 51"],
    modernPolyfills: true,
    renderLegacyChunks: true,
    // Explicit polyfills for Chrome 51 (Android 7) compatibility
    polyfills: [
      'es.promise',
      'es.promise.finally',
      'es.symbol',
      'es.symbol.description',
      'es.array.iterator',
      'es.object.assign',
      'es.object.keys',
      'es.object.values',
      'es.object.entries',
      'es.array.from',
      'es.array.includes',
      'es.string.includes',
      'es.string.starts-with',
      'es.string.ends-with',
      'es.string.pad-start',
      'es.string.pad-end',
      'es.map',
      'es.set',
      'es.weak-map',
      'es.weak-set',
      'web.url',
      'web.url-search-params',
    ],
    // Ensure regenerator-runtime is included for async/await transpilation
    additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
  }),
  mode === "development" && componentTagger(),
].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: 'es2015',
    minify: 'esbuild',
    cssCodeSplit: true,
    cssMinify: true,
    sourcemap: false,
    // Aggressive code splitting for better caching
    // NOTE: manualChunks removed — it conflicts with @vitejs/plugin-legacy
    // chunk generation and causes untranspiled syntax in legacy bundles.
    rollupOptions: {
      output: {
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
    include: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
    exclude: ['@capacitor/core'],
  },
  // Enable caching
  cacheDir: 'node_modules/.vite',
}));
