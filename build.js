#!/usr/bin/env node
/**
 * AChat Compiler / Bundler
 * Compiles modular files in `src/` into a single standalone `dist/index.html`
 * and updates root `index.html`.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');
const ROOT_INDEX = path.join(ROOT_DIR, 'index.html');

function build() {
  console.log('📦 Building AChat single-file distribution...');
  
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const srcIndex = fs.readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8');

  // 1. Inlining CSS
  const cssRegex = /<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["']\s*\/?>/gi;
  let compiled = srcIndex.replace(cssRegex, (match, href) => {
    // Only inline local relative CSS files
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
      return match;
    }
    const cssPath = path.join(SRC_DIR, href);
    if (fs.existsSync(cssPath)) {
      console.log(`  ✓ Inlining CSS: ${href}`);
      const cssContent = fs.readFileSync(cssPath, 'utf8');
      return `<style>\n${cssContent}\n</style>`;
    }
    console.warn(`  ⚠️ CSS file not found: ${cssPath}`);
    return match;
  });

  // 2. Inlining Local Scripts
  // Group consecutive local script tags into a single <script> block to preserve behavior and cleanliness
  const scriptRegex = /<script\s+src=["']([^"']+)["']><\/script>/gi;
  const localScripts = [];
  
  // Find all local script references
  compiled = compiled.replace(scriptRegex, (match, src) => {
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
      return match;
    }
    const scriptPath = path.join(SRC_DIR, src);
    if (fs.existsSync(scriptPath)) {
      console.log(`  ✓ Inlining JS: ${src}`);
      const jsContent = fs.readFileSync(scriptPath, 'utf8');
      return `/* __INLINE_SCRIPT_PLACEHOLDER_${localScripts.push(jsContent) - 1}__ */`;
    }
    console.warn(`  ⚠️ Script file not found: ${scriptPath}`);
    return match;
  });

  // Merge placeholders into one script block
  if (localScripts.length > 0) {
    const combinedJs = localScripts.join('\n\n');
    let first = true;
    for (let i = 0; i < localScripts.length; i++) {
      const placeholder = `/* __INLINE_SCRIPT_PLACEHOLDER_${i}__ */`;
      if (first) {
        // Use a replacer function to avoid treating `$` in JS code as regex replacement patterns ($&, $', etc.)
        compiled = compiled.replace(placeholder, () => `<script>\n${combinedJs}\n</script>`);
        first = false;
      } else {
        compiled = compiled.split(placeholder).join('');
      }
    }
  }

  // Write to dist/index.html
  fs.writeFileSync(DIST_INDEX, compiled, 'utf8');
  console.log(`  ✅ Successfully written ${DIST_INDEX} (${(compiled.length / 1024).toFixed(1)} KB)`);

  // Also write to root index.html to maintain direct root usability
  fs.writeFileSync(ROOT_INDEX, compiled, 'utf8');
  console.log(`  ✅ Successfully synced ${ROOT_INDEX}`);
}

build();
