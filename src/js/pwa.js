/* ------------------------- Top page loader ------------------------- */
function finishPageLoader(){
  const el = document.getElementById("pageLoader");
  if(!el || el.dataset.done==="1") return;
  el.dataset.done = "1";
  el.classList.add("done");
  setTimeout(()=>{ if(el.parentNode) el.remove(); }, 500);
}
// Belt + suspenders: also complete on window load in case init() throws.
window.addEventListener("load", ()=>setTimeout(finishPageLoader, 100));

/* ------------------------- Standalone (installed PWA) detection ------------------------- */
function isStandalone(){
  try{
    if(navigator.standalone === true) return true; // legacy iOS
    if(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if(window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches) return true;
  }catch{}
  return false;
}
function applyStandaloneClass(){
  if(isStandalone()) document.body.classList.add("standalone");
  else document.body.classList.remove("standalone");
}

/* ------------------------- Reload (works inside installed PWA without browser chrome) ------------------------- */
function showReloadOverlay(){
  if(document.getElementById("reloadOverlay")) return;
  const ov = document.createElement("div");
  ov.id = "reloadOverlay";
  ov.className = "reload-overlay";
  const spinner = document.createElement("div"); spinner.className = "reload-spinner"; spinner.setAttribute("aria-hidden","true");
  const label = document.createElement("div"); label.className = "reload-label"; label.textContent = t("reload.refreshing");
  ov.appendChild(spinner); ov.appendChild(label);
  document.body.appendChild(ov);
}
function reloadApp(){
  const ta = document.getElementById("input");
  const hasInput = (ta && ta.value.trim().length>0) || pendingAttachments.length>0;
  if(hasInput && !confirm(t("reload.confirm"))) return;
  const btn = document.getElementById("reloadBtn");
  if(btn) btn.classList.add("spin");
  showReloadOverlay();
  // Give the overlay a chance to paint before navigation tears down the DOM
  setTimeout(()=>{ location.reload(); }, 80);
}

/* ------------------------- Pull-to-refresh (standalone only, touch only) ------------------------- */
function setupPullToRefresh(){
  if(!isStandalone()) return;
  if(!("ontouchstart" in window)) return;
  const scrollBox = document.getElementById("chatView");
  if(!scrollBox || scrollBox.dataset.ptrBound==="1") return;
  scrollBox.dataset.ptrBound = "1";

  // Mount indicator into the scroll container so it overlays the messages area
  const main = scrollBox;
  if(getComputedStyle(main).position === "static") main.style.position = "relative";
  const ind = document.createElement("div");
  ind.className = "ptr-indicator";
  ind.innerHTML = `<span class="ptr-icon">↓</span><span class="ptr-text"></span>`;
  ind.querySelector(".ptr-text").textContent = t("reload.pull");
  main.appendChild(ind);

  let startY = 0, pulling = false, pull = 0, refreshing = false;
  const THRESHOLD = 64;
  const MAX = 90;

  scrollBox.addEventListener("touchstart",(e)=>{
    if(refreshing) return;
    if(scrollBox.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
    pull = 0;
  }, {passive:true});

  scrollBox.addEventListener("touchmove",(e)=>{
    if(!pulling || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if(dy <= 0 || scrollBox.scrollTop > 0){
      // Cancel if user scrolled or reversed direction
      ind.style.opacity = 0;
      ind.style.transform = "translateY(-60px)";
      ind.classList.remove("ready");
      return;
    }
    pull = Math.min(dy * 0.55, MAX); // damped pull
    const y = Math.min(pull, MAX) - 60;
    ind.style.opacity = Math.min(pull / 50, 1);
    ind.style.transform = `translateY(${y}px)`;
    const ready = pull >= THRESHOLD;
    if(ready !== ind.classList.contains("ready")){
      ind.classList.toggle("ready", ready);
      ind.querySelector(".ptr-text").textContent = ready ? t("reload.release") : t("reload.pull");
    }
  }, {passive:true});

  scrollBox.addEventListener("touchend",()=>{
    if(!pulling) return;
    pulling = false;
    if(pull >= THRESHOLD && !refreshing){
      refreshing = true;
      ind.classList.remove("ready");
      ind.classList.add("refreshing");
      ind.style.transform = "translateY(8px)";
      ind.style.opacity = 1;
      ind.querySelector(".ptr-text").textContent = t("reload.refreshing");
      // Show full-screen overlay so iOS doesn't leave the (stale) UI looking interactive
      showReloadOverlay();
      setTimeout(()=>{ location.reload(); }, 220);
    }else{
      ind.style.transition = "transform .2s, opacity .2s";
      ind.style.transform = "translateY(-60px)";
      ind.style.opacity = 0;
      ind.classList.remove("ready");
      setTimeout(()=>{ ind.style.transition = ""; }, 220);
    }
  });
}

/* ------------------------- PWA manifest (inline, single-file) ------------------------- */
// Rasterize an SVG (referenced via URL) to a PNG data URL at the given size.
// Chrome's installability check rejects SVG-only manifests, so we synthesize
// PNG 192/512 icons on the fly from our inlined SVG.
function rasterizeSvgToPng(svgUrl, size){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>{
      try{
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL("image/png"));
      }catch(e){ reject(e); }
    };
    img.onerror = reject;
    img.src = svgUrl;
  });
}

// Cache the generated PNGs so language switches that re-run setupPWA() don't
// re-rasterize.
let _pngIconCache = null;
async function getPwaPngIcons(svgUrl){
  if(_pngIconCache) return _pngIconCache;
  try{
    const [png192, png512] = await Promise.all([
      rasterizeSvgToPng(svgUrl, 192),
      rasterizeSvgToPng(svgUrl, 512)
    ]);
    _pngIconCache = { png192, png512 };
  }catch(e){
    console.warn("[pwa] icon rasterize failed:", e);
    _pngIconCache = { png192: null, png512: null };
  }
  return _pngIconCache;
}

async function setupPWA(){
  try{
    // Prefer a real manifest.webmanifest file when it's deployed alongside the
    // page: Chrome only treats a site as installable when the manifest is a
    // real http(s) resource — it rejects the blob: fallback below. So if the
    // static <link rel="manifest"> resolves, leave it in place and stop here.
    const staticLink = document.querySelector('link[rel="manifest"]');
    if(staticLink && staticLink.href && !staticLink.href.startsWith("blob:")){
      try{
        const res = await fetch(staticLink.href, { cache: "no-store" });
        if(res.ok){ await res.json(); return; } // real manifest works → installable, nothing to do
      }catch{ /* file missing (single-file use) → fall through to inline blob */ }
    }
    // Reuse the same SVG icon that's already inlined in the head
    const iconLink = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    const iconUrl = iconLink ? iconLink.href : "";
    if(!iconUrl) return;
    // Synthesize PNG icons — Chrome won't honor an SVG-only manifest for install
    const { png192, png512 } = await getPwaPngIcons(iconUrl);
    // Compute scope = directory of current document
    const dir = location.pathname.replace(/[^/]*$/, "") || "/";
    const icons = [];
    if(png192) icons.push({ src: png192, sizes: "192x192", type: "image/png", purpose: "any" });
    if(png512) icons.push({ src: png512, sizes: "512x512", type: "image/png", purpose: "any" });
    if(png512) icons.push({ src: png512, sizes: "512x512", type: "image/png", purpose: "maskable" });
    // Keep the SVG as a bonus for vector-capable browsers
    icons.push({ src: iconUrl, sizes: "any", type: "image/svg+xml", purpose: "any" });
    const manifest = {
      name: "AChat",
      short_name: "AChat",
      description: "Single-file browser-based multi-model chat",
      // start_url must stay inside scope. Stick to the document path (no query).
      start_url: location.pathname,
      scope: dir,
      display: "standalone",
      orientation: "any",
      background_color: "#09090b",
      theme_color: "#6366f1",
      lang: "en",
      icons
    };
    const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    const url = URL.createObjectURL(blob);
    let link = document.querySelector('link[rel="manifest"]');
    if(!link){
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    link.href = url;
  }catch(e){ console.warn("[pwa] setup failed:", e); }
}

/* ------------------------- Service worker (optional) ------------------------- */
// The manifest above is inlined, but a real service worker file CANNOT be —
// it must be a same-origin script served with a JS MIME type. So `sw.js` is an
// optional companion file: drop it next to index.html and the app becomes a
// fully installable, offline-capable Chrome/Edge app. Leave it out (or open the
// page from file://) and registration fails silently — the page keeps working
// as a plain single-page app.
function setupServiceWorker(){
  if(!("serviceWorker" in navigator)) return;
  // Service workers only run over https or localhost — never file:// or plain http.
  const isLocalhost = ["localhost","127.0.0.1","[::1]"].includes(location.hostname);
  if(location.protocol !== "https:" && !isLocalhost) return;
  window.addEventListener("load", ()=>{
    const swUrl = new URL("sw.js", location.href).href;
    navigator.serviceWorker.register(swUrl, { scope: "./" })
      .then(()=> console.info("[pwa] service worker registered — app is installable & offline-capable"))
      // Missing file (404) or wrong MIME → reject. That's the "no sw.js" case: keep running as a plain SPA.
      .catch((err)=> console.info("[pwa] no service worker; running as a plain single-page app:", err && err.message));
  });
}

