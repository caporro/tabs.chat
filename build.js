#!/usr/bin/env node
/**
 * tabs.chat Multi-Target Bundler & Compiler
 *
 * Supported targets:
 *   --target=standalone (default) : Compiles a single-file, 100% offline self-contained HTML.
 *   --target=hosted               : Compiles optimized multi-resource bundle (HTML, JS, CSS, vendor)
 *                                   for AWS S3 / CloudFront deployment.
 *
 * Options:
 *   --config=<path>               : Injects a JSON preconfiguration preset directly into the build.
 *   --out=<dir>                   : Custom output directory.
 *   --edition=normal|lite|all      : Standalone capability profile (normal by default).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ROOT_DIR = __dirname;
const SRC_DIR = path.join(ROOT_DIR, 'src');
const VENDOR_DIR = path.join(SRC_DIR, 'vendor');

// A partial/stale vendor update must fail the build, never ship broken features.
const vendorManifest = JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, 'vendors.json'), 'utf8'));
if (vendorManifest.version !== 2) throw new Error('Run npm ci --ignore-scripts and npm run update:vendors first.');
const dependencyLock = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package-lock.json'), 'utf8'));
if (crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT_DIR, 'package-lock.json'))).digest('hex') !== vendorManifest.lockSha256) throw new Error('The dependency lock changed. Run npm ci --ignore-scripts and npm run update:vendors.');
for (const [name, info] of Object.entries(vendorManifest.vendors)) {
  if (dependencyLock.packages[`node_modules/${name}`]?.version !== info.version) throw new Error(`Outdated vendored dependency: ${name}. Run npm run update:vendors.`);
}
for (const [name, info] of Object.entries(vendorManifest.files)) {
  const filename = path.join(VENDOR_DIR, name);
  if (!fs.existsSync(filename) || crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') !== info.sha256) throw new Error(`Missing or modified vendor file: ${name}. Run npm run update:vendors.`);
}

function inlineCssResources(css, cssPath) {
  return css.replace(/url\(\s*["']?([^\s)"']+)["']?\s*\)/g, (match, url) => {
    if (/^(data:|https?:|\/\/|#)/i.test(url)) return match;
    const filename = path.resolve(path.dirname(cssPath), url);
    if (!fs.existsSync(filename)) throw new Error(`Missing stylesheet resource: ${filename}`);
    const mime = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' }[path.extname(filename)] || 'application/octet-stream';
    return `url("data:${mime};base64,${fs.readFileSync(filename).toString('base64')}")`;
  });
}
function scriptText(text) {
  // JS can contain literal HTML closing tags, including inside upstream strings.
  return text.replace(/<\/script/gi, '<\\/script');
}
const sourceHtml = fs.readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8');
for (const match of sourceHtml.matchAll(/(?:src|href)=["']((?:vendor|js|css|assets)\/[^"']+)["']/g)) {
  if (!fs.existsSync(path.join(SRC_DIR, match[1]))) throw new Error(`Missing application resource: ${match[1]}`);
}
for (const name of Object.keys(vendorManifest.files).filter(name => name.endsWith('.css'))) {
  const filename = path.join(VENDOR_DIR, name);
  inlineCssResources(fs.readFileSync(filename, 'utf8'), filename);
}

// Parse CLI arguments
const args = process.argv.slice(2);
let target = 'standalone';
let configPresetPath = null;
let customOutDir = null;
let edition = 'normal';

for (const arg of args) {
  if (arg.startsWith('--target=')) {
    target = arg.split('=')[1].trim().toLowerCase();
  } else if (arg.startsWith('--config=')) {
    configPresetPath = arg.split('=')[1].trim();
  } else if (arg.startsWith('--preset=')) {
    const presetName = arg.split('=')[1].trim();
    configPresetPath = path.join(ROOT_DIR, 'presets', presetName.endsWith('.json') ? presetName : `${presetName}.json`);
  } else if (arg.startsWith('--out=')) {
    customOutDir = arg.split('=')[1].trim();
  } else if (arg.startsWith('--edition=')) {
    edition = arg.split('=')[1].trim().toLowerCase();
  }
}
if (!['standalone', 'hosted'].includes(target)) throw new Error('Unknown build target: ' + target);
if (!['normal', 'lite', 'all'].includes(edition)) throw new Error('Unknown edition: ' + edition);
if (target === 'hosted' && edition !== 'normal') throw new Error('Edition selection applies to standalone builds; hosted builds use Normal.');
function profileFor(name) { return { edition: name, diagrams: name !== 'lite', math: name !== 'lite', pdf: name !== 'lite', docx: name !== 'lite' }; }
function resourceInEdition(name, selected) {
  return selected !== 'lite' || !/^(?:vendor\/)?(?:katex|auto-render|mammoth|mermaid|pdf|fonts\/)/.test(name);
}
function prepareScript(source, name, selected) {
  if (name === 'js/features.js') source = source.replace('/* __BUILD_PROFILE__ */ null', () => JSON.stringify(profileFor(selected)));
  if (name === 'js/state.js') source = source.replace('/* __PRECONFIGURED_STATE__ */ null', () => preconfiguredStateJson);
  return source.replace(/__APP_VERSION__/g, appVersion);
}
function noticesFor(resources, selected) {
  if (selected !== 'lite') return fs.readFileSync(path.join(VENDOR_DIR, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  if (!vendorManifest.artifacts) throw new Error('Run npm run update:vendors to generate artifact license mappings.');
  const ids = new Set();
  for (const name of [...Object.keys(resources).filter(name => name.startsWith('vendor/')).map(name => name.slice(7)), 'brotli-decoder.min.js']) {
    if (!vendorManifest.artifacts[name]) throw new Error('Missing package attribution for ' + name);
    vendorManifest.artifacts[name].forEach(id => ids.add(id));
  }
  let text = 'tabs.chat Lite — third-party software notices\n\nThe application is MIT licensed. Components retain the licenses below.\n';
  for (const pkg of vendorManifest.packages.filter(pkg => ids.has(`${pkg.name}@${pkg.version}`))) {
    text += `\n${'='.repeat(72)}\n${pkg.name}@${pkg.version} — ${pkg.license}\nLicense used for this distribution: ${pkg.distributionLicense}\nRepository: ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || ''}\nUnmodified upstream package: ${pkg.archive}\n`;
    for (const filename of pkg.licenseFiles) text += `\n--- ${filename} ---\n${fs.readFileSync(path.join(VENDOR_DIR, filename), 'utf8')}\n`;
  }
  return text;
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
const appVersion = pkg.version || '1.0.0';

console.log(`\n======================================================`);
console.log(`📦 tabs.chat Builder v${appVersion}`);
console.log(`🎯 Target: [${target.toUpperCase()}]`);
if (configPresetPath) {
  console.log(`⚙️ Preset Config: ${configPresetPath}`);
}
console.log(`======================================================\n`);

// Load optional preconfigured state
let preconfiguredStateJson = 'null';
if (configPresetPath) {
  const resolvedPreset = path.isAbsolute(configPresetPath) ? configPresetPath : path.join(ROOT_DIR, configPresetPath);
  if (fs.existsSync(resolvedPreset)) {
    try {
      const parsedPreset = JSON.parse(fs.readFileSync(resolvedPreset, 'utf8'));
      preconfiguredStateJson = JSON.stringify(parsedPreset);
      console.log(`✓ Loaded and validated preset config from: ${resolvedPreset}`);
    } catch (e) {
      console.error(`❌ Failed to parse preset JSON: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.warn(`⚠️ Warning: Preset config file not found: ${resolvedPreset}`);
  }
}

// Simple safe CSS minifier
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove comments
    .replace(/\s+/g, ' ')             // collapse whitespace
    .replace(/\s*([\{\}\:\;\,])\s*/g, '$1') // remove space around delimiters
    .replace(/\;}/g, '}')             // remove trailing semicolons
    .trim();
}

// Simple safe JS cleaner (collapses excessive empty lines and trailing whitespace)
function cleanJs(js) {
  return js
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

// Inlines local asset files (images/icons) as Base64 Data URIs
function inlineAssets(html, baseDir) {
  const assetRegex = /(href|src)=["'](assets\/[^"']+)["']/gi;
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
  };
  return html.replace(assetRegex, (match, attr, assetRelPath) => {
    const assetFullPath = path.join(baseDir, assetRelPath);
    if (fs.existsSync(assetFullPath)) {
      const ext = path.extname(assetFullPath).toLowerCase();
      const mime = mimeTypes[ext] || 'application/octet-stream';
      const b64 = fs.readFileSync(assetFullPath).toString('base64');
      return `${attr}="data:${mime};base64,${b64}"`;
    }
    return match;
  });
}

// Recursive directory copy
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ============================================================================
// TARGET: STANDALONE (Single self-contained HTML file)
// ============================================================================
function buildStandalone(selected) {
  const outDir = customOutDir ? path.resolve(customOutDir) : path.join(ROOT_DIR, 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const resources = {};
  const styles = [], scripts = [];
  let compiled = sourceHtml;
  compiled = compiled.replace(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["']\s*\/?>/gi, (_, name) => {
    if (!resourceInEdition(name, selected)) return '';
    const filename = path.join(SRC_DIR, name);
    resources[name] = Buffer.from(minifyCss(fs.readFileSync(filename, 'utf8')));
    styles.push(name);
    return '';
  });
  compiled = compiled.replace(/<script\s+src=["']((?:js|vendor)\/[^"']+)["']><\/script>/gi, (_, name) => {
    if (!resourceInEdition(name, selected)) return '';
    resources[name] = Buffer.from(prepareScript(fs.readFileSync(path.join(SRC_DIR, name), 'utf8'), name, selected));
    scripts.push(name);
    return '';
  });
  for (const name of Object.keys(vendorManifest.files)) {
    if (!resourceInEdition(name, selected)) continue;
    if (name === 'mermaid.esm.min.mjs' || name === 'pdf.min.mjs' || name === 'pdf.worker.min.mjs' || name.startsWith('fonts/') || ((name.startsWith('pdf/cmaps/') || name.startsWith('pdf/standard_fonts/')) && !/\/(LICENSE|NOTICE)/i.test(name))) {
      resources['vendor/' + name] = fs.readFileSync(path.join(VENDOR_DIR, name));
    }
  }
  resources['vendor/THIRD_PARTY_NOTICES.txt'] = Buffer.from(fs.readFileSync(path.join(ROOT_DIR, 'LICENSE'), 'utf8') + '\n\n' + noticesFor(resources, selected));
  const index = {}, chunks = [];
  let offset = 0;
  for (const [name, bytes] of Object.entries(resources).sort(([a],[b]) => a.localeCompare(b, 'en'))) {
    index[name] = [offset, bytes.length]; chunks.push(bytes); offset += bytes.length;
  }
  const header = Buffer.from(JSON.stringify(index));
  const size = Buffer.alloc(4); size.writeUInt32LE(header.length);
  const archive = Buffer.concat([size, header, ...chunks]);
  // Cache by content, never by timestamps; tests and repeated builds reuse the same archive.
  const key = crypto.createHash('sha256').update('brotli-q10-w24-v1').update(archive).digest('hex');
  const cacheDir = path.join(require('node:os').tmpdir(), 'tabs-chat-build-' + require('node:os').userInfo().uid);
  const cacheFile = path.join(cacheDir, key + '.br');
  let packed;
  try {
    packed = fs.readFileSync(cacheFile);
    if (!zlib.brotliDecompressSync(packed).equals(archive)) packed = null;
  } catch { packed = null; }
  if (!packed) {
    packed = zlib.brotliCompressSync(archive, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 10, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } });
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const temporary = cacheFile + '.' + process.pid;
    fs.writeFileSync(temporary, packed); fs.renameSync(temporary, cacheFile);
  }
  const config = { styles, scripts, rawBytes: archive.length, decoder: zlib.gzipSync(fs.readFileSync(path.join(VENDOR_DIR, 'brotli-decoder.min.js')), { level: 9 }).toString('base64') };
  let bootstrap = fs.readFileSync(path.join(ROOT_DIR, 'scripts/standalone-bootstrap.js'), 'utf8');
  bootstrap = bootstrap.replace('/* __BUNDLE_CONFIG__ */ null', () => JSON.stringify(config));
  compiled = compiled.replace(/<link\s+rel="manifest"[^>]*>/i, '');
  compiled = compiled.replace('</head>', '<style id="tabs-boot-style">body{visibility:hidden}html:before{content:"";position:fixed;top:0;left:0;width:100%;height:3px;background:#5b56fc}html{background:#fff}@media(prefers-color-scheme:dark){html{background:#09090b}}</style>\n</head>');
  const payload = '<script id="tabs-payload" type="application/octet-stream">' + packed.toString('base64') + '</script>\n<script>\n' + scriptText(bootstrap) + '\n</script>\n';
  compiled = compiled.replace(/<\/body>\s*<\/html>\s*$/i, match => payload + match);
  compiled = inlineAssets(compiled, SRC_DIR).replace(/__APP_VERSION__/g, appVersion).replace(/__APP_EDITION__/g, selected).replace(/[ \t]+$/gm, '');
  if (/<(?:script|link)[^>]+(?:src|href)=["'](?:vendor|js|css|assets)\//i.test(compiled)) throw new Error('Standalone build still references external files.');
  const bytes = Buffer.byteLength(compiled);
  const budget = selected === 'lite' ? pkg.tabsChatBuild?.maxLiteBytes : pkg.tabsChatBuild?.maxStandaloneBytes;
  if (budget && bytes > budget) throw new Error(`Standalone size ${bytes} bytes exceeds the ${budget}-byte budget.`);
  const filename = selected === 'lite' ? 'tabs-chat-lite.html' : 'tabs-chat.html';
  fs.writeFileSync(path.join(outDir, filename), compiled);
  if (selected === 'normal') {
    fs.writeFileSync(path.join(outDir, 'index.html'), compiled);
    if (!customOutDir) fs.writeFileSync(path.join(ROOT_DIR, 'index.html'), compiled);
  }
  console.log(`✅ ${filename}: ${bytes.toLocaleString('en')} bytes; ${Object.keys(resources).length} embedded files, no network dependencies.`);
}

// ============================================================================
// TARGET: HOSTED (Separated resources for CloudFront / S3 Web deployment)
// ============================================================================
function buildHosted() {
  const outDir = customOutDir ? path.resolve(customOutDir) : path.join(ROOT_DIR, 'dist-hosted');
  if (outDir === ROOT_DIR || outDir === SRC_DIR || SRC_DIR.startsWith(outDir + path.sep)) throw new Error('Hosted output must have its own directory.');
  fs.mkdirSync(outDir, { recursive: true });

  const distVendor = path.join(outDir, 'vendor');
  const distAssets = path.join(outDir, 'assets');
  const distCss = path.join(outDir, 'css');
  const distJs = path.join(outDir, 'js');
  fs.mkdirSync(distVendor, { recursive: true });
  fs.mkdirSync(distAssets, { recursive: true });
  fs.mkdirSync(distCss, { recursive: true });
  fs.mkdirSync(distJs, { recursive: true });

  console.log(`📁 Copying verified third-party libraries to dist-hosted/vendor/...`);
  fs.rmSync(distVendor, { recursive: true, force: true });
  copyDirSync(path.join(SRC_DIR, 'vendor'), distVendor);

  console.log(`📁 Copying assets to dist-hosted/assets/...`);
  copyDirSync(path.join(SRC_DIR, 'assets'), distAssets);
  fs.copyFileSync(path.join(VENDOR_DIR, 'THIRD_PARTY_NOTICES.txt'), path.join(outDir, 'THIRD_PARTY_NOTICES.txt'));
  fs.copyFileSync(path.join(ROOT_DIR, 'LICENSE'), path.join(outDir, 'LICENSE'));

  // 1. Bundle and minify local CSS
  console.log(`🎨 Bundling CSS into dist-hosted/css/style.css...`);
  const srcCss = fs.readFileSync(path.join(SRC_DIR, 'css', 'style.css'), 'utf8');
  fs.writeFileSync(path.join(distCss, 'style.css'), minifyCss(srcCss), 'utf8');

  // 2. Bundle local application JS into app.js
  console.log(`⚡ Bundling application scripts into dist-hosted/js/app.js...`);
  const scriptRegex = /<script\s+src=["'](js\/[^"']+)["']><\/script>/gi;
  const srcHtml = fs.readFileSync(path.join(SRC_DIR, 'index.html'), 'utf8');
  const localScripts = [];
  let match;
  while ((match = scriptRegex.exec(srcHtml)) !== null) {
    const src = match[1];
    const scriptPath = path.join(SRC_DIR, src);
    if (fs.existsSync(scriptPath)) {
      const content = prepareScript(fs.readFileSync(scriptPath, 'utf8'), src, 'normal');
      localScripts.push(`/* --- ${src} --- */\n` + cleanJs(content));
    } else {
      throw new Error(`Script not found: ${scriptPath}`);
    }
  }
  const bundledAppJs = localScripts.join('\n\n');
  fs.writeFileSync(path.join(distJs, 'app.js'), bundledAppJs, 'utf8');

  // 3. Generate clean hosted index.html
  console.log(`📄 Generating hosted index.html...`);
  let hostedHtml = srcHtml;

  // Replace all individual js/*.js script tags with a single <script src="js/app.js"></script>
  let replacedFirstScript = false;
  hostedHtml = hostedHtml.replace(/<script\s+src=["']js\/[^"']+["']><\/script>\s*/gi, () => {
    if (!replacedFirstScript) {
      replacedFirstScript = true;
      return `<script src="js/app.js"></script>\n`;
    }
    return '';
  });

  // Inject App Version
  hostedHtml = hostedHtml.replace(/__APP_VERSION__/g, appVersion).replace(/__APP_EDITION__/g, 'normal');
  if (!fs.existsSync(path.join(ROOT_DIR, 'manifest.webmanifest'))) {
    hostedHtml = hostedHtml.replace(/<link\s+rel="manifest"[^>]*>/i, '');
  }

  const distIndex = path.join(outDir, 'index.html');
  fs.writeFileSync(distIndex, hostedHtml, 'utf8');

  // Copy manifest if present
  if (fs.existsSync(path.join(ROOT_DIR, 'manifest.webmanifest'))) {
    fs.copyFileSync(path.join(ROOT_DIR, 'manifest.webmanifest'), path.join(outDir, 'manifest.webmanifest'));
  }

  console.log(`\n✅ Hosted web distribution ready at: ${outDir}`);
  console.log(`   - index.html   (${(hostedHtml.length / 1024).toFixed(1)} KB)`);
  console.log(`   - css/style.css (${(srcCss.length / 1024).toFixed(1)} KB)`);
  console.log(`   - js/app.js    (${(bundledAppJs.length / 1024).toFixed(1)} KB)`);
  console.log(`   - vendor/      (${fs.readdirSync(distVendor).length} files)`);
}

// Execute based on target
if (target === 'hosted') {
  buildHosted();
} else {
  for (const selected of edition === 'all' ? ['normal', 'lite'] : [edition]) buildStandalone(selected);
}
