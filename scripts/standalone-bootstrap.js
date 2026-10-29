// The payload is a Brotli-compressed binary archive: uint32 header size, JSON index, raw files.
// Decode with a bundled JS implementation; no native Brotli support or network is required.
(async () => {
  const started = performance.now();
  const config = /* __BUNDLE_CONFIG__ */ null;
  const text = new TextDecoder();
  const from64 = data => Uint8Array.from(atob(data), char => char.charCodeAt(0));
  const execute = (source, name) => {
    const script = document.createElement('script');
    script.textContent = source + '\n//# sourceURL=tabs.chat/' + name;
    document.body.appendChild(script);
    script.remove();
  };
  const decoder = new Blob([from64(config.decoder)]).stream().pipeThrough(new DecompressionStream('gzip'));
  execute(await new Response(decoder).text(), 'brotli-decoder.js');
  const packed = document.getElementById('tabs-payload');
  const bytes = window.__tabsBrotli.decompress(from64(packed.textContent), config.rawBytes);
  packed.remove();
  const headerSize = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  const index = JSON.parse(text.decode(bytes.subarray(4, 4 + headerSize)));
  const files = Object.create(null);
  const start = 4 + headerSize;
  for (const [name, [offset, length]] of Object.entries(index)) files[name] = bytes.subarray(start + offset, start + offset + length);
  window.__TABS_STANDALONE_FILES__ = files;
  const urls = new Map();
  for (const name of config.styles) {
    const style = document.createElement('style');
    style.textContent = text.decode(files[name]).replace(/url\(\s*["']?([^\s)"']+)["']?\s*\)/g, (match, url) => {
      if (/^(data:|https?:|\/\/|#)/i.test(url)) return match;
      const local = new URL(url, 'https://bundle.invalid/' + name).pathname.slice(1);
      if (!files[local]) throw new Error('Missing embedded font: ' + local);
      if (!urls.has(local)) urls.set(local, URL.createObjectURL(new Blob([files[local]], { type: 'font/woff2' })));
      return 'url("' + urls.get(local) + '")';
    });
    document.head.appendChild(style);
  }
  for (const name of config.scripts) execute(text.decode(files[name]), name);
  document.getElementById('tabs-boot-style').remove();
  window.__tabsBootMs = performance.now() - started;
})().catch(error => {
  document.getElementById('tabs-boot-style')?.remove();
  const message = document.createElement('p');
  message.textContent = 'Unable to open tabs.chat: ' + error.message;
  document.body.replaceChildren(message);
  console.error(error);
});
