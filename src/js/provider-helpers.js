/* ------------------------- Provider Helpers ------------------------- */
function getProviders(){
  return (state && state.config && Array.isArray(state.config.providers)) ? state.config.providers : [];
}

function getProvider(providerId){
  const providers = getProviders();
  if(!providerId) return providers[0] || null;
  let found = providers.find(p => p.id === providerId);
  if(found) return found;
  // Fallback match by provider type (e.g. legacy model IDs "openai::gpt-4o")
  found = providers.find(p => p.type === providerId);
  if(found) return found;
  return null;
}

function defaultBaseForType(type){
  if(type === "claude") return "https://api.anthropic.com/v1";
  if(type === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  if(type === "ollama") return "http://localhost:11434";
  return "https://api.openai.com/v1";
}

function defaultModelsForType(type){
  if(type === "claude") return "claude-opus-4-6\nclaude-sonnet-4-6\nclaude-haiku-4-5-20251001";
  if(type === "gemini") return "gemini-2.0-flash-exp\ngemini-1.5-pro\ngemini-1.5-flash";
  if(type === "ollama") return "llama3.2\nqwen2.5:7b\nllava";
  return "gpt-4o\ngpt-4o-mini\ngpt-4-turbo";
}

function defaultNameForType(type){
  if(type === "claude") return "Anthropic Claude";
  if(type === "gemini") return "Google Gemini";
  if(type === "ollama") return "Local (Ollama)";
  return "OpenAI compatible";
}

function providerTypeLabel(type){
  if(type === "claude") return "Anthropic Claude";
  if(type === "gemini") return "Google Gemini";
  if(type === "ollama") return "Local models";
  return "OpenAI compatible";
}

function badgeEmoji(type){
  if(type === "claude") return "🟣";
  if(type === "gemini") return "🔵";
  if(type === "ollama") return "🟠";
  return "🟢";
}

function normalizeStateProviders(s){
  if(!s || typeof s !== "object") return;
  if(!s.config || typeof s.config !== "object") s.config = {};
  if(!Array.isArray(s.config.providers)){
    const migrated = [];
    for(const p of ["openai","claude","gemini","ollama"]){
      const old = s.config[p];
      if(old && typeof old === "object"){
        const hasKey = !!(old.key && old.key.trim());
        const isCustomOllama = p === "ollama" && (hasKey || (old.base && old.base !== "http://localhost:11434"));
        if(hasKey || isCustomOllama){
          migrated.push({
            id: p,
            type: p,
            name: defaultNameForType(p),
            enabled: old.enabled !== false,
            base: old.base || defaultBaseForType(p),
            key: old.key || "",
            models: old.models || defaultModelsForType(p),
            protocol: old.protocol || "auto",
            langLock: old.langLock || "off"
          });
        }
      }
    }
    s.config.providers = migrated;
  }
  s.config.providers.forEach((p, i) => {
    if(!p.id) p.id = `prov_${p.type || "openai"}_${i+1}`;
    if(!p.type) p.type = "openai";
    if(!p.name) p.name = defaultNameForType(p.type);
    if(p.enabled === undefined) p.enabled = true;
    if(p.base === undefined) p.base = defaultBaseForType(p.type);
    if(p.key === undefined) p.key = "";
    if(p.models === undefined) p.models = defaultModelsForType(p.type);
    if(p.type === "ollama"){
      if(!p.protocol) p.protocol = "auto";
      if(!p.langLock) p.langLock = "off";
    }
  });
}

let state = loadState();
let pendingAttachments = []; // {kind:'image'|'file', name, mime, dataUrl?, text?}
// 每个会话独立的流式状态：chatId -> { controller, phase }
// 这样不同会话的输出互不干扰，可以同时进行。
const activeStreams = new Map();

function streamStart(chatId, controller, phase){
  activeStreams.set(chatId, { controller, phase: phase || "" });
  if(state.activeChatId === chatId) syncComposerUI();
  renderChatList(); // 侧栏显示后台流式指示
}
function streamPhase(chatId, phase){
  const s = activeStreams.get(chatId);
  if(!s) return;
  s.phase = phase;
  if(state.activeChatId === chatId) syncComposerUI();
}
function streamEnd(chatId){
  activeStreams.delete(chatId);
  if(state.activeChatId === chatId) syncComposerUI();
  renderChatList();
}
function isStreaming(chatId){ return activeStreams.has(chatId); }
function abortStream(chatId){ activeStreams.get(chatId)?.controller?.abort(); }

/* 根据当前激活会话的流式状态，同步发送/停止按钮与状态提示。 */
const COMPOSER_SEND_SVG = '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>';
const COMPOSER_STOP_SVG = '<svg class="fi" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:12px;height:12px"><rect width="14" height="14" x="5" y="5" rx="2"/></svg>';
function syncComposerUI(){
  const btn = document.getElementById("sendBtn");
  const hint = document.getElementById("statusHint");
  if(!btn) return;
  const s = activeStreams.get(state.activeChatId);
  if(s){
    btn.classList.add("stop-btn"); btn.innerHTML = COMPOSER_STOP_SVG; btn.title = t("stop.title");
    btn.onclick = ()=>abortStream(state.activeChatId);
    if(hint) hint.innerHTML = `<span class="status-pulse">${escapeHtml(s.phase || t("status.connecting"))}</span>`;
  }else{
    btn.classList.remove("stop-btn"); btn.innerHTML = COMPOSER_SEND_SVG; btn.title = t("send.title");
    btn.onclick = sendMessage;
    if(hint) hint.textContent = "";
  }
}
let stickToBottom = true;     // 自动滚动开关：用户滚离底部即关闭
let _scrollProgrammatic = 0;  // 程序触发的滚动次数（不应改变 stick）

/* 自动滚动控制 */
function isNearBottom(box){
  return (box.scrollHeight - box.scrollTop - box.clientHeight) < 40;
}
function updateScrollBtn(hasNew){
  const btn = document.getElementById("scrollBottomBtn");
  if(!btn) return;
  btn.classList.toggle("show", !stickToBottom);
  if(stickToBottom) btn.classList.remove("has-new");
  else if(hasNew) btn.classList.add("has-new");
}
function scrollToBottom(smooth){
  const box = document.getElementById("chatView");
  if(!box) return;
  _scrollProgrammatic++;
  if(smooth) box.scrollTo({top:box.scrollHeight, behavior:"smooth"});
  else box.scrollTop = box.scrollHeight;
  stickToBottom = true;
  updateScrollBtn();
}
function maybeAutoScroll(){
  if(!stickToBottom) { updateScrollBtn(true); return; }
  const box = document.getElementById("chatView");
  if(!box) return;
  _scrollProgrammatic++;
  box.scrollTop = box.scrollHeight;
}

