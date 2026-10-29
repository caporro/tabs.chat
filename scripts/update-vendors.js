#!/usr/bin/env node
// Build browser dependencies from the versions/integrities in package-lock.json.
// No downloads or lifecycle scripts run here. Use npm ci --ignore-scripts first.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'src/vendor');
const staging = fs.mkdtempSync(path.join(root, '.vendors-'));
const packages = new Map();
const artifacts = {};
const lockBytes = fs.readFileSync(path.join(root, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
const licenseName = /^(licen[cs]e|copying|notice|ofl|copyright)([._-]|$)/i;
const direct = ['marked', 'dompurify', 'highlight.js', 'katex', 'mammoth', 'pdfjs-dist', 'mermaid', 'brotli'];
function trackPackage(dir) {
  if (!packages.has(dir)) packages.set(dir, JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')));
}
function trackInput(filename) {
  let dir = path.dirname(path.resolve(root, filename));
  while (dir.startsWith(path.join(root, 'node_modules'))) {
    if (fs.existsSync(path.join(dir, 'package.json')) && JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name) { trackPackage(dir); const pkg = packages.get(dir); return `${pkg.name}@${pkg.version}`; }
    dir = path.dirname(dir);
  }
}
function copy(from, to) {
  const dest = path.join(staging, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, 'node_modules', from), dest);
  artifacts[to] = [trackInput(path.join('node_modules', from))];
}
function bundle(entry, name, globalName) {
  const result = esbuild.buildSync({
    absWorkingDir: root, entryPoints: [entry], outfile: path.join(staging, name),
    bundle: true, splitting: false, minify: true, platform: 'browser', target: 'es2022',
    format: globalName ? 'iife' : 'esm', ...(globalName ? { globalName } : {}),
    legalComments: 'inline', metafile: true, charset: 'utf8',
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }
  });
  artifacts[name] = [...new Set(Object.keys(result.metafile.inputs).map(trackInput))].sort();
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    const filename = path.join(dir, entry.name);
    return entry.isDirectory() ? (entry.name === 'node_modules' ? [] : walk(filename)) : [filename];
  });
}
try {
  for (const name of direct) {
    const dir = path.join(root, 'node_modules', name);
    trackPackage(dir);
    if (lock.packages[`node_modules/${name}`]?.version !== packages.get(dir).version) throw new Error(`Run npm ci: ${name} differs from package-lock.json`);
  }
  copy('marked/lib/marked.umd.js', 'marked.min.js');
  copy('dompurify/dist/purify.min.js', 'purify.min.js');
  bundle('node_modules/highlight.js/lib/common.js', 'highlight.min.js', 'hljs');
  copy('highlight.js/styles/github-dark.min.css', 'github-dark.min.css');
  for (const file of ['katex.min.js', 'contrib/auto-render.min.js']) copy(`katex/dist/${file}`, path.basename(file));
  // All supported browsers read WOFF2; shipping WOFF and TTF duplicates every font.
  const mathCss = fs.readFileSync(path.join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8').replace(/src:([^;}]+)/g, (match, sources) => {
    const modern = sources.split(',').find(source => /\.woff2\)/.test(source));
    if (!modern) throw new Error('KaTeX font has no WOFF2 source');
    return 'src:' + modern;
  });
  fs.writeFileSync(path.join(staging, 'katex.min.css'), mathCss);
  artifacts['katex.min.css'] = [`katex@${packages.get(path.join(root, 'node_modules/katex')).version}`];
  for (const filename of walk(path.join(root, 'node_modules/katex/dist/fonts')).filter(filename => filename.endsWith('.woff2'))) copy(path.relative(path.join(root, 'node_modules'), filename), `fonts/${path.basename(filename)}`);
  bundle('node_modules/mammoth/lib/index.js', 'mammoth.browser.min.js', 'mammoth');
  bundle('node_modules/mermaid/dist/mermaid.core.mjs', 'mermaid.esm.min.mjs');
  bundle('node_modules/brotli/decompress.js', 'brotli-decoder.min.js', '__tabsBrotli');
  copy('pdfjs-dist/build/pdf.min.mjs', 'pdf.min.mjs');
  copy('pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs');
  // Text extraction has Wasm and JS evaluation disabled; image/color decoders are unused.
  for (const dir of ['cmaps', 'standard_fonts']) {
    for (const filename of walk(path.join(root, 'node_modules/pdfjs-dist', dir))) {
      // With useSystemFonts=true, PDF.js fetches binary font data only for these symbols.
      if (dir === 'standard_fonts' && !['FoxitSymbol.pfb', 'FoxitDingbats.pfb'].includes(path.basename(filename))) continue;
      copy(path.relative(path.join(root, 'node_modules'), filename), `pdf/${dir}/${path.basename(filename)}`);
    }
  }
  const inventory = [];
  let notices = 'tabs.chat — third-party software notices\n\nThe application is MIT licensed. Third-party components retain their own licenses.\nVersions and npm archive integrities are pinned in package-lock.json.\n';
  for (const [dir, pkg] of [...packages].sort((a,b)=>`${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`, 'en'))) {
    const licenses = walk(dir).filter(filename => licenseName.test(path.basename(filename)) && !/\.(?:[cm]?js|ts|map)$/i.test(filename));
    if (pkg.name === 'brotli') {
      // npm omits license files. Preserve its MIT declaration and Google decoder notices.
      licenses.push(path.join(root, 'scripts/vendor-notices/brotli-NOTICE.txt'));
      licenses.push(path.join(root, 'node_modules/pdfjs-dist/LICENSE'));
    }
    if (!licenses.length) throw new Error(`Missing upstream license text: ${pkg.name}@${pkg.version}`);
    const id = `${pkg.name.replace(/[@/]/g, '_')}@${pkg.version}`;
    const locked = lock.packages[path.relative(root, dir).split(path.sep).join('/')];
    if (!locked || locked.version !== pkg.version) throw new Error(`Run npm ci: ${pkg.name}@${pkg.version} differs from package-lock.json`);
    // khroma omits its SPDX field; its shipped license file explicitly says MIT.
    const license = pkg.name === 'brotli' ? '(MIT AND Apache-2.0)' : pkg.license || (pkg.name === 'khroma' ? 'MIT' : null);
    if (!license) throw new Error(`Unclassified license: ${pkg.name}@${pkg.version}`);
    const distributionLicense = license === '(MPL-2.0 OR Apache-2.0)' ? 'Apache-2.0' : license === '(MIT OR GPL-3.0-or-later)' ? 'MIT' : license;
    const source = pkg.name === 'elkjs' && pkg.version === '0.9.3'
      ? 'https://github.com/kieler/elkjs/tree/a8304cf79fde75bc2ab1a89d28320f53f8637436'
      : null;
    const copied = [];
    notices += `\n${'='.repeat(72)}\n${pkg.name}@${pkg.version} — ${license}\nLicense used for this distribution: ${distributionLicense}\nRepository: ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || ''}\nUnmodified upstream package: ${locked.resolved}\n${source ? `Corresponding source and build instructions: ${source}\n` : ''}`;
    for (const filename of licenses) {
      const rel = filename.startsWith(dir + path.sep) ? path.relative(dir, filename).split(path.sep).join('/') : filename.endsWith('brotli-NOTICE.txt') ? 'NOTICE' : 'LICENSE-APACHE-2.0';
      const dest = `licenses/${id}/${rel}`;
      fs.mkdirSync(path.dirname(path.join(staging, dest)), { recursive: true });
      fs.copyFileSync(filename, path.join(staging, dest));
      copied.push(dest);
      notices += `\n--- ${rel} ---\n${fs.readFileSync(filename, 'utf8')}\n`;
    }
    inventory.push({ name: pkg.name, version: pkg.version, license, distributionLicense, repository: pkg.repository || null, archive: locked.resolved, ...(source ? { source } : {}), integrity: locked.integrity, licenseFiles: copied });
  }
  fs.writeFileSync(path.join(staging, 'THIRD_PARTY_NOTICES.txt'), notices);
  const files = Object.fromEntries(walk(staging).map(filename => {
    const bytes = fs.readFileSync(filename);
    return [path.relative(staging, filename).split(path.sep).join('/'), { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }];
  }));
  const vendors = Object.fromEntries(direct.map(name => [name, { version: packages.get(path.join(root, 'node_modules', name)).version }]));
  const lockSha256 = crypto.createHash('sha256').update(lockBytes).digest('hex');
  fs.writeFileSync(path.join(staging, 'vendors.json'), JSON.stringify({ version: 2, lockSha256, generator: { esbuild: require('esbuild/package.json').version }, vendors, packages: inventory, artifacts, files }, null, 2) + '\n');
  // Replace only after every bundle, resource and license has been produced.
  fs.rmSync(output, { recursive: true, force: true });
  fs.renameSync(staging, output);
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notices);
  console.log(`Built ${direct.length} browser libraries; recorded ${inventory.length} packages and ${Object.keys(files).length} file hashes.`);
} catch (error) {
  fs.rmSync(staging, { recursive: true, force: true });
  console.error(error.message);
  process.exitCode = 1;
}
