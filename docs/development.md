# Development and verification

[Project overview](../README.md) · [Dependencies](dependencies.md) · [Deployment](deployment.md)

## Requirements and setup

Use Node.js 22.13+ and npm. The optional preview command also needs Python 3. Browser regression checks need Google Chrome.

```sh
git clone https://github.com/caporro/tabs.chat.git
cd tabs.chat
npm ci --ignore-scripts
npm run build
```

Builds use the checked-in source and vendored dependencies. They verify the dependency lockfile and each vendor file's SHA-256 before producing output. An incomplete vendor checkout or stale lockfile stops the build. Ordinary builds do not download browser libraries.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/index.html` | Application layout and templates. |
| `src/css/style.css` | Responsive styles. |
| `src/js/` | State, persistence, providers, chat, rendering, notes and settings. |
| `src/js/prompt-context.js` | Identity resolution, allowlisted prompt variables and request snapshots. |
| `src/js/agent/` | MCP client, tool registry and execution loop. |
| `src/vendor/` | Generated browser libraries, resources, inventory and licenses. |
| `scripts/` | Vendor generation, standalone bootstrap, size reporting and checks. |
| `deploy/` | AWS deployment script and CloudFormation template. |

## Build outputs

| Command | Output |
| --- | --- |
| `npm run build` or `npm run build:standalone` | Both `dist/tabs-chat.html` (Normal) and `dist/tabs-chat-lite.html` (Lite). |
| `npm run build:normal` | Normal, plus entrypoint copies at `dist/index.html` and root `index.html`. |
| `npm run build:lite` | Lite; does not replace Normal entrypoints. |
| `npm run build:hosted` | Normal as separate HTML, JS, CSS and vendor resources in `dist-hosted/`. |
| `npm run watch` | Rebuilds both standalone editions when files in `src/` change. |
| `npm run size` | File sizes, compressed archive contents and encoding overhead for the standalone editions. |

For isolated output directories, use the build CLI:

```sh
node build.js --target=standalone --edition=all --out=/tmp/tabs-chat-standalone
node build.js --target=hosted --out=/tmp/tabs-chat-hosted
```

Builds enforce the budgets in `package.json`: 4,000,000 bytes for Normal and 750,000 for Lite. Hosted builds always use Normal. Standalone files include their supporting resources and work from `file://` without adjacent files or CDN downloads; provider requests still need access to the chosen service.

Lite omits the optional diagram, math, PDF and DOCX libraries/resources entirely. Capabilities are fixed in the executable, not imported settings. See [distribution behavior](dependencies.md#distribution-behavior) for archive compression, PDF resources, lazy loading and license selection.

## Local preview

For live development, run:

```sh
npm run dev
```

This builds the hosted Normal edition in a temporary directory, opens [http://localhost:3000](http://localhost:3000), and watches `src/`, `build.js` and `package.json`. Saving a source file rebuilds and reloads the browser. A failed rebuild keeps the last successful build available; fixing the source resumes updates. Stop with **Ctrl+C**. Generated release HTML files are not modified.

Use `npm run dev -- --no-open` to skip opening the browser, or `npm run dev -- --port 3001` to choose a different port. A different port has separate browser storage. Running the command again reuses an existing live server for this checkout at that port.

To make the `tabs` command available from any directory on macOS/Linux, link the executable into a directory already on your `PATH`:

```sh
chmod +x scripts/dev.mjs
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/scripts/dev.mjs" "$HOME/.local/bin/tabs"
```

Then run `tabs`, `tabs --no-open` or `tabs --port 3001`. On macOS this takes precedence over the system utility with the same name when `~/.local/bin` comes earlier in `PATH`.

After a standalone build, serve the repository root:

```sh
npm start
```

This runs `python3 -m http.server 3000`. Open [http://localhost:3000](http://localhost:3000). The root entrypoint is Normal; Lite is at [http://localhost:3000/dist/tabs-chat-lite.html](http://localhost:3000/dist/tabs-chat-lite.html). HTTP preview also gives local servers a stable origin to allow in CORS settings.

To preview the hosted distribution:

```sh
npm run build:hosted
python3 -m http.server 3000 --directory dist-hosted
```

## Verification

| Command | Coverage |
| --- | --- |
| `npm run test:agents` | Agent/global name precedence, safe templates, prompt inheritance/overrides, request snapshots, environment capabilities and configuration links and archive round trips. |
| `npm run test:dev` | Live preview, source watching, reload events, failed-build recovery, port conflicts, file boundaries and shutdown. |
| `npm run test:ui` | Settings, sharing, notes, inspection and desktop/mobile behavior, using an isolated Chrome profile and local API/MCP fixtures. |
| `node scripts/test_connection_access.mjs` | Direct/proxy transport, streaming, stale-result invalidation and credential-sharing behavior without external API calls. |
| `npm run test:resources` | Normal diagrams/formulas and PDF/CJK/DOCX extraction; Lite Markdown, code/copy, attachments, chat and MCP; resource omission, size budgets, licenses and failure on incomplete vendor data. |

The browser checks build temporary distributions. Resource checks open both standalone editions from `file://` with HTTP(S) blocked. Set `CHROME_PATH` if Chrome is outside the default macOS location or Linux command. Set `UI_ARTIFACT_DIR` to retain desktop/mobile screenshots.

These are fixture-based regressions, not certification of live generation with every provider/browser or a complete security audit.

## Dependency updates

Versions are pinned in `package.json` and `package-lock.json`; generated files and full notices live under `src/vendor/`. The update procedure, inventory and license choices are documented in [dependencies](dependencies.md).

The note editor currently adds no third-party editor dependency. The CodeMirror 6/EasyMDE comparison, measured sizes and license considerations remain in [markdown-editor-cost.json](markdown-editor-cost.json).

## CI and publication

GitHub Actions runs the checks and builds both standalone editions on pushes to main and pull requests. Version tags repeat verification, publish the two HTML files and checksums as a GitHub Release, then deploy the tested hosted artifact to CloudFront using AWS OIDC. See [deployment](deployment.md) for configuration and recovery steps.

## Data model

Configuration links use `v:1`, an `agents` array and an optional `activeAgent` name. Full application archives use `schemaVersion:1`, `agents` and `activeAgentId`. Notes are stored in one shared `notes` array, with a nullable `agentId` association. Agent IDs, providers and conversations are local to the archive; shared links carry configuration only.

The in-memory source of truth uses the same `state.agents` and `state.activeAgentId` fields. `state.config`, `state.chats` and `state.toolSettings` are nonenumerable views of the current agent. Tool execution settings are stored in `agent.config.agent`.
