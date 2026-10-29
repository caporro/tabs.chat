#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { watch, realpathSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.wasm':'application/wasm' };

export async function startLiveServer({ root = projectRoot, port = 3000, log = console.log } = {}) {
  root = await realpath(root);
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tabs-chat-live-')));
  const clients = new Set(), watchers = [];
  let output, revision, child, building, timer, closing = false, dirty = false;
  const reloadScript = () => `<script data-tabs-live>
(() => {
  const revision = ${JSON.stringify(revision)};
  const events = new EventSource('/__tabs_dev/events');
  events.addEventListener('ready', event => { if (event.data !== revision) location.reload(); });
  events.addEventListener('built', () => location.reload());
})();
</script>`;

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/__tabs_dev/status') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ app: 'tabs.chat', mode: 'live', root, revision })); return;
      }
      if (pathname === '/__tabs_dev/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        res.write(`event: ready\ndata: ${revision}\n\n`);
        clients.add(res);
        const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15000);
        res.on('close', () => { clients.delete(res); clearInterval(keepalive); });
        return;
      }
      if (!output) { res.writeHead(503); res.end('Building tabs.chat…'); return; }
      const base = output;
      const filename = path.resolve(base, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!filename.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
      const resolved = await realpath(filename);
      if (!resolved.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
      let body = await readFile(resolved);
      if (path.extname(filename) === '.html') body = Buffer.from(body.toString().replace('</body>', reloadScript() + '\n</body>'));
      res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      res.writeHead(['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code) ? 404 : 400); res.end();
    }
  });

  async function build() {
    dirty = true;
    if (building) return building;
    building = (async () => {
      while (dirty && !closing) {
        dirty = false;
        const next = path.join(scratch, randomUUID());
        let diagnostics = '';
        const success = await new Promise(resolve => {
          child = spawn(process.execPath, [path.join(root, 'build.js'), '--target=hosted', `--out=${next}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
          for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-20000); });
          child.on('error', error => { diagnostics += error.message; resolve(false); });
          child.on('close', code => resolve(code === 0));
        });
        child = undefined;
        if (closing) break;
        if (success) {
          const previous = output;
          output = next; revision = randomUUID();
          for (const client of clients) client.write(`event: built\ndata: ${revision}\n\n`);
          log(`✓ Updated ${new Date().toLocaleTimeString()} — watching for changes`);
          // Keep the previous files briefly for requests already in flight.
          if (previous) setTimeout(() => rm(previous, { recursive: true, force: true }).catch(() => {}), 2000).unref();
        } else {
          await rm(next, { recursive: true, force: true });
          log(`Build failed. Fix the source and save again.\n${diagnostics.trim()}`);
        }
      }
    })().finally(() => { building = undefined; });
    return building;
  }

  let closePromise;
  function close() {
    return closePromise ||= (async () => {
      closing = true; clearTimeout(timer);
      watchers.forEach(watcher => watcher.close());
      for (const client of clients) client.end();
      child?.kill('SIGTERM');
      await building;
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
      await rm(scratch, { recursive: true, force: true });
    })();
  }

  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => build().catch(error => log(error.message)), 200); };
    watchers.push(watch(path.join(root, 'src'), { recursive: true }, schedule));
    watchers.push(watch(root, (event, file) => { if (['build.js', 'package.json'].includes(String(file))) schedule(); }));
    await build();
    if (!output) throw new Error('Initial build failed.');
    return { url: `http://localhost:${server.address().port}/`, close };
  } catch (error) {
    await close(); throw error;
  }
}

async function openBrowser(url) {
  const commands = process.platform === 'darwin' ? [['open', [url]], ['open', ['-a', 'Google Chrome', url]]] : process.platform === 'win32' ? [['rundll32', ['url.dll,FileProtocolHandler', url]]] : [['xdg-open', [url]]];
  for (const [command, args] of commands) {
    if (await new Promise(resolve => {
      const browser = spawn(command, args, { stdio: 'ignore' });
      browser.on('error', () => resolve(false)); browser.on('close', code => resolve(code === 0));
    })) return;
  }
  console.log(`Open ${url} in your browser.`);
}

async function main() {
  const { values } = parseArgs({ options: { port: { type: 'string', short: 'p', default: '3000' }, 'no-open': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) { console.log('Usage: tabs [--port 3000] [--no-open]\n\nBuild, serve and reload tabs.chat as source files change. Stop with Ctrl+C.'); return; }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  const url = `http://localhost:${port}/`;
  try {
    const status = await fetch(url + '__tabs_dev/status', { signal: AbortSignal.timeout(500) }).then(response => response.json());
    if (status.app === 'tabs.chat' && status.mode === 'live' && status.root === realpathSync(projectRoot)) {
      console.log(`tabs.chat is already running in live mode: ${url}`);
      if (!values['no-open']) await openBrowser(url);
      return;
    }
  } catch {}
  const live = await startLiveServer({ port });
  console.log(`\ntabs.chat live: ${live.url}\nSave a source file to rebuild and reload. Stop with Ctrl+C.\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => live.close().then(() => process.exit(0)));
  if (!values['no-open']) await openBrowser(live.url);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.code === 'EADDRINUSE' ? 'Port is in use. Stop the other server, or use tabs --port 3001.' : error.message);
    process.exitCode = 1;
  });
}
