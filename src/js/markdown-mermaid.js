/* ------------------------- Marked setup ------------------------- */
marked.setOptions({
  gfm:true, breaks:true,
  highlight:(code,lang)=>{
    try{
      if(lang && hljs.getLanguage(lang)) return hljs.highlight(code,{language:lang}).value;
      return hljs.highlightAuto(code).value;
    }catch{ return code; }
  }
});

function renderMarkdown(text){
  // Protect math before markdown
  const placeholders = [];
  let safe = text
    .replace(/\\\[([\s\S]+?)\\\]/g,(_,m)=>{placeholders.push(`$$${m}$$`);return `@@MATH${placeholders.length-1}@@`;})
    .replace(/\\\(([\s\S]+?)\\\)/g,(_,m)=>{placeholders.push(`$${m}$`);return `@@MATH${placeholders.length-1}@@`;});
  let html = marked.parse(safe);
  html = html.replace(/@@MATH(\d+)@@/g,(_,i)=>placeholders[+i]);
  // Wrap markdown tables in a horizontal scroll container so wide tables don't
  // push the whole chat layout sideways on mobile.
  html = html.replace(/<table(\s|>)/g, '<div class="md-table-wrap"><table$1')
             .replace(/<\/table>/g, '</table></div>');
  html = DOMPurify.sanitize(html,{ADD_ATTR:["target"],ADD_TAGS:["div"]});
  return html;
}
/* ------------------------- Mermaid (lazy-loaded) ------------------------- */
let _mermaidPromise = null;

// Custom theme palettes — aligned with Minimal Studio (Indigo / Slate)
const MERMAID_LIGHT_VARS = {
  primaryColor:        "#e0e7ff",
  primaryBorderColor:  "#4f46e5",
  primaryTextColor:    "#312e81",
  secondaryColor:      "#f1f5f9",
  secondaryBorderColor:"#64748b",
  secondaryTextColor:  "#1e293b",
  tertiaryColor:       "#ecfdf5",
  tertiaryBorderColor: "#10b981",
  tertiaryTextColor:   "#065f46",
  lineColor:           "#64748b",
  textColor:           "#09090b",
  mainBkg:             "#e0e7ff",
  nodeBorder:          "#4f46e5",
  background:          "#ffffff",
  edgeLabelBackground: "#ffffff",
  clusterBkg:          "#f8fafc",
  clusterBorder:       "#e2e8f0",
  noteBkgColor:        "#fef3c7",
  noteTextColor:       "#78350f",
  noteBorderColor:     "#fbbf24"
};
const MERMAID_DARK_VARS = {
  primaryColor:        "#1e1b4b",
  primaryBorderColor:  "#6366f1",
  primaryTextColor:    "#e0e7ff",
  secondaryColor:      "#1e293b",
  secondaryBorderColor:"#94a3b8",
  secondaryTextColor:  "#f1f5f9",
  tertiaryColor:       "#064e3b",
  tertiaryBorderColor: "#34d399",
  tertiaryTextColor:   "#d1fae5",
  lineColor:           "#818cf8",
  textColor:           "#f4f4f5",
  mainBkg:             "#1e1b4b",
  nodeBorder:          "#6366f1",
  background:          "#111114",
  edgeLabelBackground: "#111114",
  clusterBkg:          "#09090b",
  clusterBorder:       "#27272a",
  noteBkgColor:        "#3a2e10",
  noteTextColor:       "#fde68a",
  noteBorderColor:     "#a16207"
};
function mermaidConfig(){
  const dark = state.theme === "dark";
  return {
    startOnLoad: false,
    // Use "base" so themeVariables fully apply; otherwise built-in dark theme
    // overrides several of our overrides.
    theme: "base",
    themeVariables: dark ? MERMAID_DARK_VARS : MERMAID_LIGHT_VARS,
    securityLevel: "strict",
    fontFamily: "inherit",
    // Disable HTML labels → no <foreignObject>, which is the root cause of
    // "Tainted canvas" errors when rasterizing the SVG to PNG.
    flowchart: { htmlLabels: false, useMaxWidth: true, curve: "basis" },
    class:     { htmlLabels: false, useMaxWidth: true },
    sequence:  { useMaxWidth: true },
    state:     { useMaxWidth: true },
    gantt:     { useMaxWidth: true }
  };
}
function loadMermaid(){
  if(_mermaidPromise) return _mermaidPromise;
  _mermaidPromise = import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")
    .then(mod=>{
      const mermaid = mod.default;
      mermaid.initialize(mermaidConfig());
      window.__mermaid = mermaid;
      return mermaid;
    })
    .catch(err=>{ _mermaidPromise = null; throw err; });
  return _mermaidPromise;
}
const MERMAID_HEAD_RE = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|sankey-beta|xychart-beta|block-beta|architecture-beta|C4Context|C4Container|C4Component)\b/;

/* Mermaid source from LLMs sometimes has small syntax glitches that the parser
   rejects but that a human would auto-correct. Fix the most common ones. */
function fixMermaidSource(src){
  if(!src) return src;
  let out = src;

  // Rule 1: Whitespace between node terminator and `:::className` class assignment.
  //   e.g. `Start([开始项目]) :::startEnd`  →  `Start([开始项目]):::startEnd`
  out = out.replace(/([\)\]\}\w])[ \t]+:::([A-Za-z_])/g, "$1:::$2");

  // Rule 2: Subgraph declarations using non-identifier titles (Chinese chars,
  //   full-width punctuation, spaces, leading digits, etc.). LLMs often abuse
  //   the title slot as if it were a referencable id (e.g.
  //   `subgraph 阶段一：规划` + later `阶段一：规划 --> P2`). Mermaid's lexer
  //   can't tokenize that. We:
  //     1) generate a synthetic clean id (_sg1, _sg2, …);
  //     2) rewrite the declaration to `subgraph _sgN ["original title"]`;
  //     3) replace every standalone occurrence of the original title elsewhere
  //        in the source with the synthetic id.
  const idMap = new Map();
  let counter = 0;
  out = out.replace(/^([ \t]*subgraph[ \t]+)(.+?)[ \t]*$/gm, (m, pre, title)=>{
    // Skip if already in `id [title]` form
    if(/^[A-Za-z_][A-Za-z0-9_]*[ \t]*\[/.test(title)) return m;
    // Skip if already quoted at start
    if(title.startsWith('"') || title.startsWith("'")) return m;
    // Skip clean identifiers — they're fine as-is
    if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(title)) return m;
    counter++;
    const cleanId = `_sg${counter}`;
    idMap.set(title, cleanId);
    return `${pre}${cleanId} ["${title.replace(/"/g, "&quot;")}"]`;
  });
  if(idMap.size){
    // Replace longer titles first so that titles which are prefixes of others
    // don't shadow the match.
    const titles = [...idMap.keys()].sort((a,b)=>b.length-a.length);
    out = out.split("\n").map(line=>{
      if(line.trim().startsWith("%%")) return line; // leave comments alone
      let cur = line;
      for(const title of titles){
        const cleanId = idMap.get(title);
        const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Match the title as a standalone token (preceded by SOL or whitespace,
        // followed by whitespace or EOL). This safely skips occurrences inside
        // labels like `["…"]` (preceded by `"`).
        cur = cur.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"), `$1${cleanId}`);
      }
      return cur;
    }).join("\n");
  }

  // Rule 3: Bracketed labels `[text]` that contain a literal `(` confuse the parser —
  //   Mermaid sees `(` as the start of another shape. Auto-quote those labels.
  //   Skip cylinder syntax `[(text)]` by requiring the first inner char ≠ `(`.
  out = out.replace(/\[([^\]\n"\(][^\]\n"]*\([^\]\n]*)\]/g, (_, inner)=>{
    const safe = inner.replace(/"/g, "&quot;");
    return `["${safe}"]`;
  });

  return out;
}

function isMermaidCode(text, lang){
  if(lang === "mermaid") return true;
  if(!text) return false;
  // Look at the first non-empty line — Mermaid diagrams declare type at the top
  const head = text.split(/\r?\n/).map(s=>s.trim()).find(Boolean) || "";
  return MERMAID_HEAD_RE.test(head);
}

async function enhanceMermaid(root){
  if(!root) return;
  const codes = root.querySelectorAll("pre > code");
  const targets = [];
  codes.forEach(code=>{
    const lang = (code.className.match(/language-([a-z0-9-]+)/i) || [])[1] || "";
    const text = code.textContent || "";
    if(isMermaidCode(text, lang)){
      targets.push({code, text});
    }
  });
  if(!targets.length) return;
  let mermaid;
  try{ mermaid = await loadMermaid(); }
  catch(e){
    // Network/CDN issue — leave code blocks intact, log once
    console.warn("[mermaid] load failed:", e);
    return;
  }
  for(const {code, text} of targets){
    const pre = code.parentElement;
    if(!pre || pre.dataset.mermaidDone === "1") continue;
    pre.dataset.mermaidDone = "1";
    try{
      const id = "mmd_" + Math.random().toString(36).slice(2,10);
      const fixed = fixMermaidSource(text);
      const result = await mermaid.render(id, fixed);
      const svg = result?.svg || "";
      if(!svg) throw new Error("empty SVG");
      // Keep the original text in dataset.source — sanitizer is deterministic
      // so re-renders (e.g., theme switch) re-apply the same fix.
      mountMermaidBlock(pre, svg, text);
    }catch(e){
      delete pre.dataset.mermaidDone;
      const warn = document.createElement("div");
      warn.className = "mermaid-warn";
      warn.textContent = "⚠ " + t("mermaid.error") + (e && e.message ? ": " + String(e.message).slice(0,160) : "");
      pre.parentNode.insertBefore(warn, pre);
    }
  }
}

function mountMermaidBlock(preEl, svgHTML, source){
  const wrap = document.createElement("div");
  wrap.className = "mermaid-block";
  wrap.dataset.source = source;
  wrap.innerHTML =
    `<div class="mermaid-svg">${svgHTML}</div>` +
    `<div class="mermaid-actions">` +
      `<button class="mmd-btn" data-act="enlarge" title="${escapeHtml(t("mermaid.enlarge"))}">🔍</button>` +
      `<button class="mmd-btn" data-act="png" title="${escapeHtml(t("mermaid.download.png"))}">⬇</button>` +
    `</div>`;
  // Let CSS control width; some Mermaid SVGs have explicit width attr
  const svgEl = wrap.querySelector("svg");
  if(svgEl){ svgEl.removeAttribute("width"); svgEl.removeAttribute("height"); svgEl.style.maxWidth="100%"; svgEl.style.height="auto"; }
  preEl.replaceWith(wrap);
  // Actions
  wrap.querySelector('[data-act="enlarge"]').addEventListener("click",(e)=>{
    e.stopPropagation();
    openMermaidLightbox(wrap.querySelector(".mermaid-svg").innerHTML);
  });
  wrap.querySelector('[data-act="png"]').addEventListener("click",(e)=>{
    e.stopPropagation();
    downloadMermaid(wrap.querySelector(".mermaid-svg").innerHTML, "png");
  });
  wrap.addEventListener("click",(e)=>{
    if(e.target.closest(".mermaid-actions")) return;
    openMermaidLightbox(wrap.querySelector(".mermaid-svg").innerHTML);
  });
}

function openMermaidLightbox(svgHTML){
  let lb = document.getElementById("mermaidLightbox");
  if(!lb){
    lb = document.createElement("div");
    lb.id = "mermaidLightbox";
    lb.className = "mermaid-lightbox-mask hide";
    lb.innerHTML =
      `<div class="mermaid-lightbox">` +
        `<div class="mermaid-lightbox-actions">` +
          `<button class="mmd-btn" data-act="png">⬇ PNG</button>` +
          `<button class="mmd-btn" data-act="png-hd">⬇ PNG HD</button>` +
          `<button class="mmd-btn" data-act="svg">⬇ SVG</button>` +
          `<button class="mmd-btn" data-act="close">✕</button>` +
        `</div>` +
        `<div class="mermaid-lightbox-content"></div>` +
      `</div>`;
    document.body.appendChild(lb);
    lb.addEventListener("click",(e)=>{ if(e.target === lb) closeMermaidLightbox(); });
    lb.querySelector('[data-act="close"]').addEventListener("click", closeMermaidLightbox);
    lb.querySelector('[data-act="png"]').addEventListener("click",()=>{
      downloadMermaid(lb.querySelector(".mermaid-lightbox-content").innerHTML, "png", {targetLong: MERMAID_PNG_STD});
    });
    lb.querySelector('[data-act="png-hd"]').addEventListener("click",()=>{
      downloadMermaid(lb.querySelector(".mermaid-lightbox-content").innerHTML, "png", {targetLong: MERMAID_PNG_HD, tag: "hd"});
    });
    lb.querySelector('[data-act="svg"]').addEventListener("click",()=>{
      downloadMermaid(lb.querySelector(".mermaid-lightbox-content").innerHTML, "svg");
    });
    document.addEventListener("keydown",(e)=>{
      if(e.key === "Escape" && !lb.classList.contains("hide")) closeMermaidLightbox();
    });
  }
  // Refresh dynamic tooltips on each open
  lb.querySelector('[data-act="png"]').title = t("mermaid.download.png");
  lb.querySelector('[data-act="png-hd"]').title = t("mermaid.download.png.hd");
  lb.querySelector('[data-act="svg"]').title = t("mermaid.download.svg");
  lb.querySelector('[data-act="close"]').title = t("mermaid.close");
  lb.querySelector(".mermaid-lightbox-content").innerHTML = svgHTML;
  // Strip fixed dims so it scales nicely
  const svgEl = lb.querySelector(".mermaid-lightbox-content svg");
  if(svgEl){ svgEl.removeAttribute("width"); svgEl.removeAttribute("height"); svgEl.style.maxWidth="100%"; svgEl.style.height="auto"; }
  lb.classList.remove("hide");
}
function closeMermaidLightbox(){
  const lb = document.getElementById("mermaidLightbox");
  if(lb) lb.classList.add("hide");
}

// PNG long-side targets (px). Standard = good for docs/slides; HD = print/zoom.
const MERMAID_PNG_STD = 1800;
const MERMAID_PNG_HD  = 3600;

function downloadMermaid(svgHTML, format, opts){
  opts = opts || {};
  const tmp = document.createElement("div");
  tmp.innerHTML = svgHTML;
  const svgEl = tmp.querySelector("svg");
  if(!svgEl) return;
  if(!svgEl.getAttribute("xmlns")) svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Inline a generic font-family so the rasterizer doesn't need to load remote fonts
  // (loading remote fonts via SVG would otherwise taint the canvas).
  if(!svgEl.getAttribute("font-family")){
    svgEl.setAttribute("font-family", "-apple-system, BlinkMacSystemFont, 'PingFang SC', system-ui, sans-serif");
  }
  // Determine SVG natural dimensions from viewBox (or fall back to attributes)
  const vb = svgEl.viewBox?.baseVal;
  const vbW = vb?.width || parseFloat(svgEl.getAttribute("width")) || 800;
  const vbH = vb?.height || parseFloat(svgEl.getAttribute("height")) || 600;
  // Give the SVG explicit width/height so any image viewer that ignores viewBox
  // still renders at the correct intrinsic size.
  svgEl.setAttribute("width", vbW);
  svgEl.setAttribute("height", vbH);
  // Inject a background rect that matches the theme. Without this, opening the
  // SVG on a white-default viewer makes the light-on-dark text vanish.
  const bgColor = state.theme === "dark" ? "#111114" : "#ffffff";
  if(!svgEl.querySelector(":scope > rect[data-bg]")){
    const bg = svgEl.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("data-bg", "1");
    bg.setAttribute("x", vb?.x ?? 0);
    bg.setAttribute("y", vb?.y ?? 0);
    bg.setAttribute("width", vbW);
    bg.setAttribute("height", vbH);
    bg.setAttribute("fill", bgColor);
    svgEl.insertBefore(bg, svgEl.firstChild);
  }
  const xml = new XMLSerializer().serializeToString(svgEl);
  const ts = new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
  if(format === "svg"){
    const blob = new Blob([xml], {type:"image/svg+xml;charset=utf-8"});
    triggerDownload(blob, `diagram-${ts}.svg`);
    return;
  }
  // PNG via canvas — use a data: URL (not blob:) so cross-origin checks
  // can't taint the canvas under any browser.
  const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  const targetLong = opts.targetLong || MERMAID_PNG_STD;
  const img = new Image();
  img.onload = ()=>{
    let w = img.naturalWidth || vbW;
    let h = img.naturalHeight || vbH;
    w = w || 800; h = h || 600;
    // Target a specific longest-side pixel size. Both down- and up-scales,

    const longer = Math.max(w, h);
    let scale = targetLong / longer;
    scale = Math.max(0.5, Math.min(scale, 6));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    const tag = opts.tag ? `-${opts.tag}` : "";
    try{
      canvas.toBlob(blob=>{
        if(blob) triggerDownload(blob, `diagram-${ts}${tag}.png`);
      }, "image/png");
    }catch(e){
      // Safety net: if the canvas is still tainted somehow, fall back to SVG
      console.warn("[mermaid] PNG export blocked, falling back to SVG:", e);
      const blob = new Blob([xml], {type:"image/svg+xml;charset=utf-8"});
      triggerDownload(blob, `diagram-${ts}.svg`);
    }
  };
  img.onerror = ()=>{ console.warn("[mermaid] PNG image load failed"); };
  img.src = dataUrl;
}
function triggerDownload(blob, filename){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

/* Re-render existing diagrams after theme toggle so colors match. */
async function reRenderAllMermaid(){
  const mermaid = window.__mermaid;
  if(!mermaid) return;
  try{ mermaid.initialize(mermaidConfig()); }catch{}
  const blocks = document.querySelectorAll(".mermaid-block");
  for(const block of blocks){
    const src = block.dataset.source;
    if(!src) continue;
    try{
      const id = "mmd_" + Math.random().toString(36).slice(2,10);
      const {svg} = await mermaid.render(id, fixMermaidSource(src));
      block.querySelector(".mermaid-svg").innerHTML = svg;
      const svgEl = block.querySelector("svg");
      if(svgEl){ svgEl.removeAttribute("width"); svgEl.removeAttribute("height"); svgEl.style.maxWidth="100%"; svgEl.style.height="auto"; }
    }catch{}
  }
}

function renderMathIn(el){
  try{
    renderMathInElement(el,{
      delimiters:[
        {left:"$$",right:"$$",display:true},
        {left:"$",right:"$",display:false},
        {left:"\\(",right:"\\)",display:false},
        {left:"\\[",right:"\\]",display:true}
      ],
      throwOnError:false
    });
  }catch(e){}
}

