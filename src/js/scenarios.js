/* ------------------------- Scenario chats (context + memory) ------------------------- */
/* A scenario chat carries a reusable context definition (persona / tone / target
   language) plus a compressed long-term memory. The effective system prompt is
   composed from these on every request, mirroring ContextTranslate's design. */
const SCENARIO_PRESETS = [
  { emoji:"🎮", title:"Discord Gaming", lang:"English",
    desc:"Chatting on Discord while gaming with overseas players. Very colloquial, funny and natural tone, use gaming slang, abbreviations (lol, tbh, ggwp, cracked) and emojis." },
  { emoji:"💻", title:"GitHub Collaboration", lang:"English",
    desc:"Technical discussions in GitHub Issues or Pull Requests with global developers. Professional, precise, objective, polite and concise tone using standard software engineering terminology." },
  { emoji:"📧", title:"Business Email", lang:"English",
    desc:"Composing or replying to cross-team business emails. Professional, courteous, workplace-appropriate, with proper greetings and standard business correspondence formatting." },
  { emoji:"🌸", title:"Anime & Gaming Community", lang:"日本語 (Japanese)",
    desc:"Chatting with Japanese anime/gaming enthusiasts on social media. Enthusiastic, friendly, using common community slang and emoticons (🌸, www, 🥺)." },
  { emoji:"✈️", title:"Travel & Daily Conversation", lang:"English",
    desc:"Everyday travel conversations: asking for directions, ordering food, or casual social chat. Simple, clear, polite and practical phrases." },
  { emoji:"🗣️", title:"Language Speaking Practice", lang:"English",
    desc:"Act as a friendly native speaking partner practicing conversation. Briefly respond, naturally keep the topic flowing, and gently provide more natural alternatives in parentheses if I make noticeable mistakes." }
];

/* Compose the system prompt actually sent to the model. */
function effectiveSystemPrompt(chat){
  if(chat && chat.kind === "scenario"){
    return buildScenarioSystemPrompt(chat.scenario||{}, chat.contextSummary||"");
  }
  return chat ? chat.systemPrompt : "";
}

function buildScenarioSystemPrompt(scenario, summary){
  const lang = (scenario.lang||"").trim();
  const desc = (scenario.desc||"").trim();
  let p = "You are a context-aware conversational assistant operating inside a user-defined scenario.\n\n";
  p += "SCENARIO & TONE INSTRUCTIONS (follow these strictly):\n\"" + (desc || "(none specified)") + "\"";
  if(lang){
    p += "\n\nTARGET LANGUAGE: Always respond in " + lang + ", using native-level, natural phrasing appropriate to the scenario above. If the user writes in another language, treat it as content to respond to (or translate, if that is the scenario's intent) — your reply itself stays in " + lang + ".";
  }
  if((summary||"").trim()){
    p += "\n\nLONG-TERM MEMORY (compressed summary of earlier conversation — keep it consistent: relationships, names, pronouns, agreed facts and terminology):\n\"" + summary.trim().replace(/\n/g, " ") + "\"";
  }
  p += "\n\nStay in character and maintain continuity with both the recent messages and the long-term memory above.";
  return p;
}

/* Messages in the currently-active context window (after the last divider, excluding dividers). */
function activeWindowMessages(chat){
  const msgs = chat.messages || [];
  let start = 0;
  for(let i=msgs.length-1;i>=0;i--){ if(msgs[i].role==="divider"){ start=i+1; break; } }
  return msgs.slice(start).filter(m=>(m.role==="user"||m.role==="assistant") && (m.content||"").trim());
}

let _editingScenarioId = null;

function newScenarioChat(){ closeSettings(); openScenarioModal(null); }

function renderScenarioPresets(){
  const box = document.getElementById("scenarioPresets");
  box.innerHTML = "";
  SCENARIO_PRESETS.forEach(p=>{
    const b = document.createElement("button");
    b.type = "button"; b.className = "scenario-preset";
    b.innerHTML = `<span class="emoji">${p.emoji}</span><span>${escapeHtml(p.title)}</span>`;
    b.addEventListener("click",()=>{
      document.getElementById("sc_title").value = `${p.emoji} ${p.title}`;
      document.getElementById("sc_lang").value = p.lang || "";
      document.getElementById("sc_desc").value = p.desc || "";
    });
    box.appendChild(b);
  });
}

/* Populate the memory-rollback dropdown for a scenario chat, most recent first. */
function renderMemoryHistorySelect(chat){
  const row = document.getElementById("sc_memoryHistoryRow");
  const sel = document.getElementById("sc_memory_history");
  const hist = (chat && chat.memoryHistory) || [];
  if(!hist.length){ row.style.display = "none"; sel.innerHTML = ""; return; }
  row.style.display = "";
  sel.innerHTML = "";
  [...hist].reverse().forEach((h, revIdx)=>{
    const idx = hist.length - 1 - revIdx;
    const o = document.createElement("option");
    o.value = String(idx);
    const label = new Date(h.time).toLocaleString("en-US", {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"});
    const preview = h.text.replace(/\n/g," ").slice(0,28);
    o.textContent = `${label} · ${preview}${h.text.length>28?"…":""}`;
    sel.appendChild(o);
  });
}

function openScenarioModal(editId){
  _editingScenarioId = editId || null;
  renderScenarioPresets();
  const titleEl = document.getElementById("scenarioModalTitle");
  const saveEl = document.getElementById("saveScenario");
  const summaryRow = document.getElementById("sc_summaryRow");
  if(editId){
    const c = state.chats.find(x=>x.id===editId);
    const sc = (c && c.scenario) || {};
    document.getElementById("sc_title").value = c?.title || "";
    document.getElementById("sc_lang").value = sc.lang || "";
    document.getElementById("sc_desc").value = sc.desc || "";
    document.getElementById("sc_summary").value = c?.contextSummary || "";
    renderMemoryHistorySelect(c);
    summaryRow.style.display = "";
    titleEl.textContent = t("scenario.modal.titleEdit");
    saveEl.textContent = t("scenario.save.edit");
  }else{
    const first = SCENARIO_PRESETS[0];
    document.getElementById("sc_title").value = `${first.emoji} ${first.title}`;
    document.getElementById("sc_lang").value = first.lang;
    document.getElementById("sc_desc").value = first.desc;
    document.getElementById("sc_summary").value = "";
    document.getElementById("sc_memoryHistoryRow").style.display = "none";
    summaryRow.style.display = "none";
    titleEl.textContent = t("scenario.modal.titleNew");
    saveEl.textContent = t("scenario.save");
  }
  document.getElementById("scenarioModal").classList.remove("hide");
}
function closeScenarioModal(){ document.getElementById("scenarioModal").classList.add("hide"); _editingScenarioId = null; }

function saveScenario(){
  const title = document.getElementById("sc_title").value.trim();
  const lang = document.getElementById("sc_lang").value;
  const desc = document.getElementById("sc_desc").value.trim();
  if(!desc){ alert(t("scenario.desc.required")); return; }
  const scenario = { lang, desc };
  if(_editingScenarioId){
    const c = state.chats.find(x=>x.id===_editingScenarioId);
    if(c){
      c.title = title || c.title;
      c.scenario = scenario;
      const newSummary = document.getElementById("sc_summary").value.trim();
      if(newSummary !== (c.contextSummary||"")){
        // Manual edits (including restoring an older version) are snapshotted
        // too, so the rollback history covers the full edit chain, not just
        // automatic compressions.
        pushMemoryHistory(c, c.contextSummary);
        c.contextSummary = newSummary;
      }
    }
    closeScenarioModal();
    saveState(); renderChatList(); renderMessages(); updateTopBar();
  }else{
    const id = uid();
    const chat = {
      id, title: title || t("chat.new.default"),
      model: state.lastModel || "",
      kind: "scenario", scenario, contextSummary: "", memoryHistory: [],
      messages: [], createdAt: Date.now()
    };
    state.chats.unshift(chat);
    state.activeChatId = id;
    closeScenarioModal();
    saveState(); populateModelSelect(); renderChatList(); renderMessages(); updateTopBar();
    closeMobileSidebar();
    if(window.matchMedia && !window.matchMedia("(max-width: 768px)").matches){
      document.getElementById("input").focus();
    }
  }
}

/* Show/hide scenario-only controls for the active chat. */
function updateScenarioUI(){
  const c = currentChat();
  const isScenario = !!(c && c.kind === "scenario");
  const sb = document.getElementById("scenarioBtn");
  if(sb) sb.style.display = isScenario ? "" : "none";
}

/* One-shot (non-streaming-consumed) completion reusing the provider callers. */
async function oneShotLLM(modelId, systemPrompt, userContent, signal){
  const idx = (modelId||"").indexOf("::");
  const providerId = idx >= 0 ? modelId.slice(0, idx) : modelId;
  const model = idx >= 0 ? modelId.slice(idx + 2) : "";
  const prov = getProvider(providerId);
  if(!prov) throw new Error("No provider configured");
  const cfg = prov;
  const provider = prov.type;
  // 内部任务（场景记忆压缩等）自带语言要求，别让语言锁把摘要语言改掉
  const tmpChat = { systemPrompt, noLangLock:true, messages:[{role:"user", content:userContent, time:Date.now()}] };
  let out = "";
  const onContent = (d)=>{ out += d; };
  const onReasoning = ()=>{};
  if(provider==="ollama"){
    const useNative = await pickLocalProtocol(cfg);
    if(useNative) await callOllamaNative({cfg, model, chat:tmpChat, signal, onContent, onReasoning});
    else await callOpenAICompat({cfg, model, chat:tmpChat, signal, onContent, onReasoning, provider:"ollama"});
  }else if(provider==="openai"){ await callOpenAICompat({cfg, model, chat:tmpChat, signal, onContent, onReasoning, provider}); }
  else if(provider==="claude"){ await callClaude({cfg, model, chat:tmpChat, signal, onContent, onReasoning}); }
  else if(provider==="gemini"){ await callGemini({cfg, model, chat:tmpChat, signal, onContent, onReasoning}); }
  else throw new Error("Unknown provider: " + provider);
  return out.trim();
}

/* Memory only ever holds TEXT — attachments (images/files) are intentionally never
   passed to the summarizer, so images can never bloat or leak into long-term memory. */
function scenarioMemoryMaxChars(){
  return Math.max(200, Number(state.general.scenarioMemoryMaxChars) || 800);
}
function buildScenarioSummarizerPrompt(maxChars){
  // Rough word budget so the instruction scales with the configured cap (works
  // decently for both CJK, ~1 char/word, and Latin scripts, ~5 chars/word).
  const wordBudget = Math.max(40, Math.round(maxChars / 3));
  return `You are a conversation memory compression engine. Read the prior memory (if any) and the new conversation turns, then output an UPDATED consolidated memory in under ${wordBudget} words (hard cap: the memory storage itself is limited to ${maxChars} characters, so stay concise).

Capture and preserve, in priority order:
1. The established relationship, persona and tone.
2. Names, nicknames, pronouns and agreed terminology.
3. Concrete facts, decisions, preferences and open threads.

Attachments (images/files) are NOT included above and must NOT be described or invented — summarize only the text of the conversation. Merge the new turns into the prior memory; drop the least important details first if space is tight, deduplicate, keep it factual. Write in the same language the conversation mainly uses. Output ONLY a concise bulleted list — no preamble, no commentary.`;
}

/* Prefer cutting at a natural boundary (bullet line, then sentence end) instead of
   a blind character cut, so a forced truncation doesn't chop a fact mid-sentence.
   Only used as a safety net when the model ignores the length instruction. */
function truncateMemoryText(text, maxChars){
  if(text.length <= maxChars) return text;
  let cut = text.slice(0, maxChars);
  if(/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1); // never split a surrogate pair

  const lastNewline = cut.lastIndexOf("\n");
  if(lastNewline > maxChars * 0.5) return cut.slice(0, lastNewline).trim() + "\n…";

  const boundary = Math.max(
    cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"),
    cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? ")
  );
  if(boundary > maxChars * 0.5) return cut.slice(0, boundary+1).trim() + "…";

  return cut.trim() + "…"; // last resort: still bounded, just no clean boundary found
}

/* Snapshot the memory value that's about to be replaced, so a bad compression or
   edit can be manually rolled back later from the scenario editor. Local-only —
   never sent to the model, so it doesn't cost tokens; capped to avoid unbounded
   localStorage growth over a long-lived chat. */
const SCENARIO_MEMORY_HISTORY_CAP = 10;
function pushMemoryHistory(chat, prevValue){
  if(!(prevValue||"").trim()) return;
  if(!Array.isArray(chat.memoryHistory)) chat.memoryHistory = [];
  chat.memoryHistory.push({ text: prevValue, time: Date.now() });
  if(chat.memoryHistory.length > SCENARIO_MEMORY_HISTORY_CAP){
    chat.memoryHistory = chat.memoryHistory.slice(-SCENARIO_MEMORY_HISTORY_CAP);
  }
}

/* Keep the most recent N real messages live; everything older gets folded into memory. */
const SCENARIO_KEEP_RECENT = 4;
let _autoCompressing = false;

/* Approximate "context size" of the active window, in characters. */
function estimateWindowSize(chat){
  return activeWindowMessages(chat).reduce((n,m)=>n + ((m.content||"").length), 0);
}

/* Core compression: fold the older part of the active window into chat.contextSummary,
   leaving a divider before the kept-recent messages. Returns true on success. */
async function runCompression(chat, opts={}){
  const keepRecent = Math.max(0, opts.keepRecent ?? 0);
  const win = activeWindowMessages(chat);
  const toCompress = keepRecent > 0 ? win.slice(0, Math.max(0, win.length - keepRecent)) : win.slice();
  if(toCompress.length < 2){ if(!opts.silent) flashStatus(t("scenario.compress.tooFew")); return false; }
  const modelId = chat.model || document.getElementById("modelSelect").value || state.lastModel;
  if(!modelId){ if(!opts.silent) alert(t("alert.modelRequiredSend")); return false; }

  flashStatus(t("scenario.compress.running"), 60000);
  const ctrl = new AbortController();
  // Text only — attachments are deliberately never dumped into the summarizer input.
  let dump = "";
  toCompress.forEach(m=>{ dump += `${m.role === "user" ? "User" : "Assistant"}: ${m.content||""}\n\n`; });
  let userContent = "";
  if((chat.contextSummary||"").trim()) userContent += "【Prior memory】:\n" + chat.contextSummary.trim() + "\n\n";
  userContent += "【New conversation turns to merge】:\n" + dump;

  const maxChars = scenarioMemoryMaxChars();
  const summary = await oneShotLLM(modelId, buildScenarioSummarizerPrompt(maxChars), userContent, ctrl.signal);
  if(!summary) return false;
  pushMemoryHistory(chat, chat.contextSummary);
  // Hard cap as a safety net in case the model ignores the length instruction —
  // this is what actually bounds the overall size of "memory", not just a hint.
  chat.contextSummary = truncateMemoryText(summary, maxChars);
  // Drop the compressed turns from the active window (keep them visible) via a divider.
  const firstKeep = keepRecent > 0 ? win[win.length - keepRecent] : null;
  const at = firstKeep ? chat.messages.indexOf(firstKeep) : -1;
  if(at >= 0) chat.messages.splice(at, 0, { role:"divider", time: Date.now() });
  else if(chat.messages[chat.messages.length-1]?.role !== "divider") chat.messages.push({ role:"divider", time: Date.now() });
  saveState(); renderMessages();
  flashStatus(t("scenario.compress.done"));
  return true;
}

/* Called after each scenario reply: auto-fold history into memory once the live
   context grows past the configured size. No button, no user action required. */
async function maybeAutoCompress(chat){
  if(!chat || chat.kind !== "scenario") return;
  if(state.general.scenarioAutoCompress === false) return;
  if(_autoCompressing) return;
  const threshold = Math.max(500, Number(state.general.scenarioCompressChars) || 4000);
  if(estimateWindowSize(chat) < threshold) return;
  if(activeWindowMessages(chat).length <= SCENARIO_KEEP_RECENT + 1) return; // too little to gain from
  _autoCompressing = true;
  try{ await runCompression(chat, { keepRecent: SCENARIO_KEEP_RECENT, silent: true }); }
  catch(e){ flashStatus(t("scenario.compress.failed", e.message||String(e)), 4000); }
  finally{ _autoCompressing = false; }
}

