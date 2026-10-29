import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv.slice(2);
const candidates = ['dist/tabs-chat.html', 'dist/tabs-chat-lite.html'].filter(name => fs.existsSync(path.join(root,name)));
for (const filename of requested.length ? requested : candidates.length ? candidates : ['index.html']) {
  const html = fs.readFileSync(path.resolve(root, filename), 'utf8');
  const encoded = html.match(/<script id="tabs-payload" type="application\/octet-stream">([^<]+)<\/script>/)?.[1];
  if (!encoded) throw new Error('Run npm run build before measuring the bundle');
  const packed = Buffer.from(encoded, 'base64');
  const raw = brotliDecompressSync(packed);
  const headerLength = raw.readUInt32LE(0);
  const index = JSON.parse(raw.subarray(4, 4 + headerLength));
  const groups = {};
  for (const [name, [,length]] of Object.entries(index)) {
    const group = name.startsWith('vendor/mermaid') ? 'Mermaid diagrams' : /vendor\/pdf/.test(name) ? 'PDF text/character maps' : /katex|auto-render|vendor\/fonts\//.test(name) ? 'Math/formula fonts' : name.includes('mammoth') ? 'DOCX parsing' : name.includes('NOTICES') ? 'Licenses' : name.startsWith('js/') || name.startsWith('css/') ? 'Application code/styles' : 'Markdown/highlighting/sanitizer';
    groups[group] = (groups[group] || 0) + length;
  }
  console.log(`\n${filename}: ${Buffer.byteLength(html).toLocaleString('en')} bytes`);
  console.log(`Compressed archive: ${packed.length.toLocaleString('en')} bytes + ${(encoded.length - packed.length).toLocaleString('en')} bytes of base64 encoding`);
  console.log(`HTML/bootstrap/icons: ${(Buffer.byteLength(html) - encoded.length).toLocaleString('en')} bytes`);
  console.log('\nArchive contents before shared compression (these are not HTML size allocations):');
  for (const [group, bytes] of Object.entries(groups).sort((a,b)=>b[1]-a[1])) console.log(`${group.padEnd(34)} ${bytes.toLocaleString('en')} bytes`);
}
