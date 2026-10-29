import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startLiveServer } from './dev.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'tabs-live-test-'));
const messages = [];
let live, stream, reader;
const waitFor = async predicate => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for live build.\n' + messages.join('\n'));
};
try {
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'package.json'), '{}');
  await writeFile(path.join(root, 'src/index.html'), '<body>First version</body>');
  await writeFile(path.join(root, 'build.js'), `
    const fs=require('node:fs'),path=require('node:path');
    const html=fs.readFileSync(path.join(__dirname,'src/index.html'),'utf8');
    if(html==='FAIL')throw new Error('Fixture build failure');
    const out=process.argv.find(arg=>arg.startsWith('--out=')).slice(6);
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'index.html'),html);
    fs.mkdirSync(path.join(out,'css'));fs.writeFileSync(path.join(out,'css/style.css'),'body{color:red}');
  `);
  live = await startLiveServer({ root, port: 0, log: message => messages.push(message) });
  const html = await fetch(live.url).then(response => response.text());
  assert.match(html, /First version/); assert.match(html, /data-tabs-live/);
  assert.equal((await fetch(live.url)).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(live.url + 'css/style.css')).headers.get('content-type'), 'text/css');
  assert.equal((await fetch(live.url + 'package.json')).status, 404);
  assert.equal((await fetch(live.url + '%2e%2e%2fpackage.json')).status, 403);
  assert.equal((await fetch(live.url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(live.url, { method: 'HEAD' })).status, 200);
  const first = await fetch(live.url + '__tabs_dev/status').then(response => response.json());
  assert.equal(first.mode, 'live');
  await assert.rejects(startLiveServer({ root, port: Number(new URL(live.url).port), log() {} }), { code: 'EADDRINUSE' });

  stream = new AbortController();
  reader = (await fetch(live.url + '__tabs_dev/events', { signal: stream.signal })).body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
  await writeFile(path.join(root, 'src/index.html'), '<body>Updated version</body>');
  await waitFor(async () => (await fetch(live.url + '__tabs_dev/status').then(response => response.json())).revision !== first.revision);
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: built/);
  assert.match(await fetch(live.url).then(response => response.text()), /Updated version/);

  await writeFile(path.join(root, 'src/index.html'), 'FAIL');
  await waitFor(() => messages.some(message => message.includes('Fixture build failure')));
  assert.match(await fetch(live.url).then(response => response.text()), /Updated version/);
  await writeFile(path.join(root, 'src/replacement.html'), '<body>Recovered version</body>');
  await rename(path.join(root, 'src/replacement.html'), path.join(root, 'src/index.html'));
  await waitFor(async () => (await fetch(live.url).then(response => response.text())).includes('Recovered version'));
  await reader.cancel(); reader = undefined; stream.abort();
  const url = live.url;
  await live.close(); live = undefined;
  await assert.rejects(fetch(url));
  console.log('✓ Live HTTP preview, source watching, SSE reload, atomic saves, failed-build recovery, occupied ports, path boundaries and shutdown');
} finally {
  await reader?.cancel().catch(() => {}); stream?.abort();
  await live?.close();
  await rm(root, { recursive: true, force: true });
}
