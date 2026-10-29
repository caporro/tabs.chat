/* ------------------------- Provider Helpers ------------------------- */
function isLocalProviderType(type){
  return ["ollama", "llamacpp", "lmstudio"].includes(type);
}

function getProviders(){
  if(typeof getCurrentAgent === "function"){
    const agent = getCurrentAgent();
    if(agent && agent.config && Array.isArray(agent.config.providers)) return agent.config.providers;
  }
  return (state && state.config && Array.isArray(state.config.providers)) ? state.config.providers : [];
}

function getProvider(providerId){
  const providers = getProviders();
  if(!providerId) return providers[0] || null;
  return providers.find(p => p.id === providerId) || null;
}

function defaultBaseForType(type){
  if(type === "claude") return "https://api.anthropic.com/v1";
  if(type === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  if(type === "ollama") return "http://localhost:11434";
  if(type === "groq") return "https://api.groq.com/openai/v1";
  if(type === "openrouter") return "https://openrouter.ai/api/v1";
  if(type === "deepseek") return "https://api.deepseek.com/v1";
  if(type === "mistral") return "https://api.mistral.ai/v1";
  if(type === "xai") return "https://api.x.ai/v1";
  if(type === "lmstudio") return "http://localhost:1234/v1";
  if(type === "llamacpp") return "http://localhost:8080/v1";
  return "https://api.openai.com/v1";
}

function defaultNameForType(type){
  if(type === "claude") return "Anthropic Claude";
  if(type === "gemini") return "Google Gemini";
  if(type === "ollama") return "Local (Ollama)";
  if(type === "groq") return "Groq";
  if(type === "openrouter") return "OpenRouter";
  if(type === "deepseek") return "DeepSeek";
  if(type === "mistral") return "Mistral AI";
  if(type === "xai") return "xAI (Grok)";
  if(type === "lmstudio") return "LM Studio (Local)";
  if(type === "llamacpp") return "llama.cpp (Local)";
  return "OpenAI compatible";
}

function providerTypeLabel(type){
  if(type === "claude") return "Anthropic Claude";
  if(type === "gemini") return "Google Gemini";
  if(type === "ollama") return "Local models";
  if(type === "groq") return "Groq (LPU)";
  if(type === "openrouter") return "OpenRouter";
  if(type === "deepseek") return "DeepSeek";
  if(type === "mistral") return "Mistral AI";
  if(type === "xai") return "xAI (Grok)";
  if(type === "lmstudio") return "LM Studio";
  if(type === "llamacpp") return "llama.cpp";
  return "OpenAI compatible";
}

function badgeEmoji(type){
  if(type === "claude") return "🟣";
  if(type === "gemini") return "🔵";
  if(type === "ollama") return "🟠";
  if(type === "groq") return "⚡";
  if(type === "openrouter") return "🌐";
  if(type === "deepseek") return "🐋";
  if(type === "mistral") return "🌪️";
  if(type === "xai") return "✖️";
  if(type === "lmstudio") return "💻";
  if(type === "llamacpp") return "💻";
  return "🟢";
}

function parseCustomHeaders(val){
  if(!val) return {};
  if(typeof val === "object" && !Array.isArray(val)) return val;
  if(typeof val !== "string") return {};
  const trimmed = val.trim();
  if(!trimmed) return {};
  if(trimmed.startsWith("{")){
    try {
      const obj = JSON.parse(trimmed);
      if(obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch(e){}
  }
  const out = {};
  trimmed.split(/\r?\n/).forEach(line => {
    const l = line.trim();
    if(!l || l.startsWith("#") || l.startsWith("//")) return;
    const idx = l.indexOf(":");
    if(idx > 0){
      const k = l.slice(0, idx).trim();
      const v = l.slice(idx + 1).trim();
      if(k) out[k] = v;
    }
  });
  return out;
}

function formatCustomHeaders(headers){
  if(!headers) return "";
  if(typeof headers === "string") return headers;
  if(typeof headers === "object" && !Array.isArray(headers)){
    return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n");
  }
  return "";
}

function normalizeAgentProviders(agent){
  if(!agent || !agent.config || !Array.isArray(agent.config.providers)) return;
  agent.config.providers.forEach((p, i) => {
    if(!p.id) p.id = `prov_${p.type || "openai"}_${i+1}`;
    if(!p.type) p.type = "openai";
    if(!p.name) p.name = defaultNameForType(p.type);
    if(p.enabled === undefined) p.enabled = true;
    if(p.base === undefined) p.base = defaultBaseForType(p.type);
    if(p.key === undefined) p.key = "";
    if(p.models === undefined) p.models = "";
    if(p.headers && typeof p.headers === "string"){
      p.headers = parseCustomHeaders(p.headers);
    }
    if(p.type === "ollama"){
      if(!p.protocol) p.protocol = "auto";
    }
  });
}

function normalizeStateProviders(s){
  if(!s || typeof s !== "object") return;
  if(Array.isArray(s.agents)){
    s.agents.forEach(normalizeAgentProviders);
  }

}

// state is initialized in state.js / persistence.js
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
const COMPOSER_SEND_SVG = icon("arrow-up", { className: "fi", strokeWidth: 2.5 });
const COMPOSER_STOP_SVG = icon("square", { className: "fi", extra: 'style="width:12px;height:12px;fill:currentColor"' });
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

