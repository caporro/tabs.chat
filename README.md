# AChat 💬

A lightweight, private, single-file browser-based multi-provider LLM chat interface.

AChat connects directly from your browser to leading AI providers (OpenAI, Anthropic Claude, Google Gemini, Ollama, LM Studio, and OpenAI-compatible endpoints) without any intermediate backend or tracking. All API keys and chat histories remain strictly in your browser's `localStorage`.

---

## ✨ Features

- **Multi-Provider Support**:
  - **OpenAI & OpenAI-Compatible** (DeepSeek, Groq, OpenRouter, Together AI, vLLM, LM Studio)
  - **Anthropic Claude** (Claude 3.5 Sonnet, Claude 3 Haiku, Claude 3 Opus)
  - **Google Gemini** (Gemini 2.5 Flash, Gemini 1.5 Pro, thinking budgets)
  - **Ollama** (Local models with CORS support, language locking, and context tuning)
- **Rich Output Rendering**:
  - Full Markdown formatting
  - Syntax highlighting for code blocks with one-click copy
  - Math formula rendering via **KaTeX**
  - Architecture and flowchart diagrams via **Mermaid**
  - Collapsible model reasoning / thinking blocks
- **Multimodal & Attachments**:
  - Image vision support (drag-and-drop, clipboard paste, or file upload)
  - Document parsing for PDF, DOCX, TXT, and source code files
  - Configurable image quality downscaling to save input tokens
- **Agentic & Extensible**:
  - Built-in **Model Context Protocol (MCP)** client for connecting tools and external servers
  - Multi-turn autonomous tool execution loops
- **Productivity Tools**:
  - **Scenarios**: Custom system prompts with automatic memory summarization
  - **Notepad**: Built-in markdown notes and task list with due dates
  - **Call Inspector**: Inspect exact request payloads, response headers, token usage, and latency
- **Privacy & Portability**:
  - 100% client-side architecture (zero external backend)
  - Encrypted/private in browser `localStorage`
  - JSON import and export for effortless local backups
  - Installable as a Progressive Web App (PWA) on desktop and mobile

---

## 🚀 Quick Start

### Option 1: Open Directly
Simply open `index.html` in any modern web browser. No installation or build steps required.

### Option 2: Local HTTP Server
```bash
# Clone the repository
git clone https://github.com/caporro/achat.git
cd achat

# Start a local web server
npm start
# or: python3 -m http.server 3000
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠️ Development & Building

The source code is modularized inside `src/`:
- `src/index.html` — Base layout and templates
- `src/css/style.css` — Modern responsive styles
- `src/js/` — Modular JavaScript files (providers, MCP client, UI wiring, rendering, state)

To compile the modular source into a single distribution file (`dist/index.html` and root `index.html`):

```bash
# Rebuild single-file distribution
npm run build

# Watch mode (automatically rebuilds on file changes)
npm run watch
```

---

## ☁️ Deployment

Since AChat is a completely static, client-side web application, you can deploy it to any static hosting service in seconds:

- **AWS CloudFront + S3**: Fast global distribution with Origin Access Control (OAC) and free SSL.
- **GitHub Pages**: Go to *Repository Settings → Pages* and set root or `dist` as the source.
- **Cloudflare Pages / Vercel**: Connect the repository with zero build configuration.

---

## 🔒 Security & CORS Tips

- **Local Storage**: API keys are saved exclusively in your browser's `localStorage`. Never use on untrusted public machines.
- **Browser CORS**:
  - Official APIs (OpenAI, Anthropic, Gemini) support browser-direct CORS requests.
  - For **Ollama**, start the server with origins allowed:
    ```bash
    OLLAMA_ORIGINS="*" ollama serve
    ```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
