# Browser dependencies and distribution

The application uses local, vendored browser libraries. No CDN is required at runtime. `package.json` pins the browser libraries, Brotli decoder and esbuild exactly; `package-lock.json` pins transitive dependencies and npm archive integrities. All are development dependencies because users run the built HTML rather than a Node.js server.

The generated `src/vendor/vendors.json` records direct versions, the actual packages contributing to browser bundles, license choices, upstream archive URLs, file sizes and SHA-256 hashes. It also records the lockfile hash and bundler version. This inventory includes transitive code discovered through esbuild's input graph and notices shipped inside upstream packages, including PDF fonts, character maps and decoders.

The artifact-to-package mapping lets the Lite build include license texts only for the libraries it actually carries (including the decoder's transitive dependencies).

## Regeneration

Use Node.js 22.13 or later and npm:

```sh
npm ci --ignore-scripts
npm run update:vendors
npm audit
npm run test:resources
npm run test:ui
npm run build
npm run build:hosted
```

The update script uses installed packages, never downloads scripts itself, and runs no lifecycle scripts. It builds a temporary vendor directory and replaces the generated files only after bundling and license collection succeed. To change versions, install explicit versions with `npm install --save-dev --save-exact --ignore-scripts`, inspect the lockfile/audit, then regenerate and run the checks above. Commit the lockfile, generated vendor files and notices together.

Builds need only Node and the checked-in source/vendor files. They verify vendor checksums and the lockfile before producing output, so a missing font, incomplete update or changed dependency lock stops the build. Normal builds do not run npm install or use the network.

## Distribution behavior

`npm run build` creates `dist/tabs-chat.html` (Normal) and `dist/tabs-chat-lite.html` (Lite). Normal also has the entrypoint copies `dist/index.html` and root `index.html`. Individual scripts `build:normal` and `build:lite` are available; building Lite never overwrites Normal. The direct CLI accepts `--target=standalone --edition=normal|lite|all --out=<directory>`. Hosted builds use Normal.

Lite retains Markdown, HTML sanitization, syntax highlighting, chat/agent/MCP behavior, notes, configuration sharing and backups. It omits Mermaid, KaTeX/fonts, PDF.js/worker/data and Mammoth. Diagrams keep their text and copy button; formulas remain text. PDF/DOCX and binary attachments are skipped with a message, while images, text and code work. Edition capabilities are immutable executable metadata, independent of imported settings or persisted state. Existing extracted attachment text remains usable in imported conversations.

- Hosted: Mermaid is bundled as one ESM file, including its diagram modules. PDF.js, its worker and auxiliary resources are served from the same site. KaTeX fonts are under `vendor/fonts/`.
- Standalone: one Brotli-compressed binary archive contains styles, WOFF2 fonts, scripts, Mermaid, PDF.js/worker, character maps and full notices. Files share a compression dictionary and binary data is not base64-encoded individually. A bundled JavaScript decoder restores the archive; native Brotli support is not needed. Only the small decoder uses gzip/`DecompressionStream`. Mermaid and PDF modules are still executed on demand. No adjacent `vendor/` directory is required, including when opened from `file://`. Current browser requirements remain Safari 17.4+ and current Chromium/Firefox.
- PDF import extracts text with JavaScript evaluation, Wasm and XFA disabled. It uses system font metrics; PDF.js skips standard font binaries in that mode except Symbol and ZapfDingbats, whose data is included. All 168 character maps remain available locally. Image/color decoders and unused standard-font files are omitted. It does not perform OCR on scanned images.

Standalone builds fail above the budgets in `package.json`: 4,000,000 bytes for Normal, 750,000 for Lite. `npm run size` reports both file sizes, archive/encoding overhead and raw contents. Compression results are cached in the OS temporary directory by input hash and verified before reuse. Fonts use WOFF2 only, avoiding duplicate WOFF/TTF copies. The hosted version keeps lazy modules separate so they do not delay the initial page load. Provider/MCP requests continue to use the user's connection settings.

## Licenses and sources

The application is MIT licensed; bundled dependencies retain their own terms. `THIRD_PARTY_NOTICES.txt` preserves full upstream license and notice texts with package versions, repositories and exact npm archive URLs. Individual copies are also under `src/vendor/licenses/`. Both distributions include the notices; the standalone includes the application's MIT license as well. **About → Third-party licenses** exports them locally without network access. Brotli's npm archive omits license files, so the generated inventory supplements its MIT declaration and retained Google Apache-2.0 decoder notices from `scripts/vendor-notices/`, with the full Apache text.

For alternative licenses this distribution selects Apache-2.0 for DOMPurify and MIT where an upstream package offers MIT or GPL. `khroma`'s package metadata omits a license field; its included `license` file explicitly grants MIT. The inventory reflects that file.

Mermaid also bundles `elkjs` under EPL-2.0. Its corresponding source/build instructions are linked at the exact upstream commit in the notices and inventory, alongside the unmodified npm archive. Its upstream source is [kieler/elkjs at the published 0.9.3 commit](https://github.com/kieler/elkjs/tree/a8304cf79fde75bc2ab1a89d28320f53f8637436). Upstream component source files are not edited; esbuild bundles/minifies them for browser distribution. Retain the notices and source references when redistributing either artifact.

`npm audit` checks advisories known to the npm registry for the locked dependency tree. The browser regressions exercise sanitizer behavior and rendering, but do not constitute a complete security audit of the application or all upstream code.
