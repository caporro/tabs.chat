/* Local lazy dependencies. Standalone builds embed compressed resources in the HTML. */
const _vendorUrls = new Map();
async function vendorBytes(name) {
  const local = window.__TABS_STANDALONE_FILES__?.[`vendor/${name}`];
  // Return an independent buffer: PDF worker transfers must not detach the shared archive.
  if (local) return local.slice();
  if (window.__TABS_STANDALONE_FILES__) throw new Error('This resource is not included in this edition: ' + name);
  const embedded = window.__TABS_VENDOR_FILES__?.[name];
  if (embedded) {
    const bytes = Uint8Array.from(atob(embedded.data), char => char.charCodeAt(0));
    if (embedded.encoding !== 'gzip') return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const res = await fetch(new URL(`vendor/${name}`, document.baseURI));
  if (!res.ok) throw new Error(`Unable to load local dependency ${name}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
function vendorModuleUrl(name) {
  if(window.__TABS_STANDALONE_FILES__ && !window.__TABS_STANDALONE_FILES__[`vendor/${name}`]) return Promise.reject(new Error('This resource is not included in this edition: ' + name));
  if (!_vendorUrls.has(name)) {
    const url = window.__TABS_STANDALONE_FILES__?.[`vendor/${name}`] || window.__TABS_VENDOR_FILES__?.[name]
      ? vendorBytes(name).then(bytes => URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' })))
      : Promise.resolve(new URL(`vendor/${name}`, document.baseURI).href);
    _vendorUrls.set(name, url);
  }
  return _vendorUrls.get(name);
}
async function showThirdPartyLicenses() {
  const bytes = await vendorBytes('THIRD_PARTY_NOTICES.txt');
  triggerDownload(new Blob([bytes], { type: 'text/plain;charset=utf-8' }), 'tabs-chat-licenses.txt');
}
let _pdfLibraryPromise;
function loadPdfLibrary() {
  if(!appHasFeature('pdf')) return Promise.reject(new Error('PDF import is available in the Normal edition.'));
  if (!_pdfLibraryPromise) {
    _pdfLibraryPromise = (async () => {
      const pdf = await import(await vendorModuleUrl('pdf.min.mjs'));
      pdf.GlobalWorkerOptions.workerSrc = await vendorModuleUrl('pdf.worker.min.mjs');
      return pdf;
    })().catch(error => { _pdfLibraryPromise = null; throw error; });
  }
  return _pdfLibraryPromise;
}
// PDF.js asks for bundled CMaps/fonts on demand; this also works under file://.
class LocalPdfBinaryDataFactory {
  async fetch({ kind, filename }) {
    const dir = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }[kind];
    if (!dir || !/^[\w.-]+$/.test(filename)) throw new Error('Invalid PDF resource');
    return vendorBytes(`pdf/${dir}/${filename}`);
  }
}
