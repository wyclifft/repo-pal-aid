/**
 * v2.11.29 — ES5 regression gate for the Android 7 / WebView 51 build.
 *
 * Parses every emitted JS chunk, every inline <script> in the generated
 * index.html, and the downlevelled Capacitor bridge with `ecmaVersion: 5`.
 * Any modern syntax that reaches the APK fails the build instead of showing up
 * as a blank screen on a CS10 terminal in the field.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseEs5(label, code, failures) {
  try {
    acorn.parse(code, { ecmaVersion: 5 });
  } catch (error) {
    const pos = typeof error.pos === "number" ? error.pos : 0;
    failures.push({
      label,
      message: error.message,
      snippet: code.slice(Math.max(0, pos - 90), pos + 60).replace(/\s+/g, " "),
    });
  }
}

export function verifyEs5({ outDir = "dist", silent = false } = {}) {
  const failures = [];
  const dist = resolve(ROOT, outDir);
  let checked = 0;

  const assetsDir = join(dist, "assets");
  if (existsSync(assetsDir)) {
    for (const file of readdirSync(assetsDir).filter((f) => f.endsWith(".js"))) {
      parseEs5(`assets/${file}`, readFileSync(join(assetsDir, file), "utf8"), failures);
      checked++;
    }
  }

  const indexHtml = join(dist, "index.html");
  if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, "utf8");
    const inline = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/g) || [];
    inline.forEach((tag, i) => {
      if (/\bsrc=/.test(tag.split(">")[0])) return; // external script, checked above
      const body = tag.replace(/^<script\b[^>]*>/, "").replace(/<\/script>$/, "");
      if (!body.trim()) return;
      parseEs5(`index.html inline script #${i + 1}`, body, failures);
      checked++;
    });
  }

  const bridge = resolve(ROOT, "android/app/src/main/assets/native-bridge.js");
  if (existsSync(bridge)) {
    parseEs5("android native-bridge.js", readFileSync(bridge, "utf8"), failures);
    checked++;
  }

  if (failures.length) {
    console.error(`\n[es5-guard] ${failures.length} file(s) are NOT ES5 — WebView 51 will fail:`);
    for (const f of failures) {
      console.error(`  ✗ ${f.label}: ${f.message}\n    ...${f.snippet}...`);
    }
    return failures;
  }

  if (!silent) console.log(`[es5-guard] OK — ${checked} script(s) parse as ES5.`);
  return [];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = verifyEs5();
  if (failures.length) process.exit(1);
}
