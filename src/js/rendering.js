/* ------------------------- Rendering ------------------------- */
/* ---- Drag to reorder the chat list (desktop pointer drag) ---- */
let _dragChatId = null;
function clearDragMarks(){
  document.querySelectorAll(".chat-item.drag-before,.chat-item.drag-after")
    .forEach(x=>x.classList.remove("drag-before","drag-after"));
}
function moveChat(srcId, targetId, before){
  if(!srcId || srcId===targetId) return;
  const arr = state.chats;
  const from = arr.findIndex(c=>c.id===srcId);
  if(from<0) return;
  const [item] = arr.splice(from,1);
  let to = arr.findIndex(c=>c.id===targetId);
  if(to<0) arr.push(item);
  else arr.splice(before ? to : to+1, 0, item);
  saveState(); renderChatList();
}

function renderChatList(){
  const list = document.getElementById("chatList");
  list.innerHTML = "";
  for(const c of state.chats){
    const div = document.createElement("div");
    div.className = "chat-item"+(c.id===state.activeChatId?" active":"")+(isStreaming(c.id)?" streaming":"");
    div.draggable = true;
    div.dataset.id = c.id;
    const icon = c.kind === "scenario" ? "🎬" : "💬";
    const editBtn = c.kind === "scenario"
      ? `<button class="icon-btn" data-act="editScenario" title="${escapeHtml(t("scenario.edit.title"))}">⚙</button>`
      : "";
    div.innerHTML = `
      <span title="${c.kind==="scenario"?escapeHtml(t("scenario.badge")):""}">${icon}</span>
      <span class="title">${escapeHtml(c.title||t("chat.untitled"))}</span>
      ${isStreaming(c.id)?'<span class="stream-dot" title="正在生成…"></span>':""}
      <span class="actions">
        ${editBtn}
        <button class="icon-btn" data-act="rename" title="${escapeHtml(t("chat.action.rename"))}">✎</button>
        <button class="icon-btn" data-act="delete" title="${escapeHtml(t("chat.action.delete"))}">🗑</button>
      </span>`;
    div.addEventListener("click",(e)=>{
      const act = e.target.closest("button")?.dataset.act;
      if(act==="editScenario"){ e.stopPropagation(); openScenarioModal(c.id); }
      else if(act==="rename"){ e.stopPropagation(); renameChat(c.id); }
      else if(act==="delete"){ e.stopPropagation(); deleteChat(c.id); }
      else switchChat(c.id);
    });
    div.addEventListener("dragstart",(e)=>{
      _dragChatId = c.id; div.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try{ e.dataTransfer.setData("text/plain", c.id); }catch{}
    });
    div.addEventListener("dragend",()=>{ _dragChatId = null; div.classList.remove("dragging"); clearDragMarks(); });
    div.addEventListener("dragover",(e)=>{
      if(!_dragChatId || _dragChatId===c.id) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      const r = div.getBoundingClientRect();
      const before = e.clientY < r.top + r.height/2;
      clearDragMarks();
      div.classList.add(before ? "drag-before" : "drag-after");
    });
    div.addEventListener("dragleave",()=>{ div.classList.remove("drag-before","drag-after"); });
    div.addEventListener("drop",(e)=>{
      if(!_dragChatId || _dragChatId===c.id) return;
      e.preventDefault();
      const r = div.getBoundingClientRect();
      const before = e.clientY < r.top + r.height/2;
      clearDragMarks();
      moveChat(_dragChatId, c.id, before);
    });
    list.appendChild(div);
  }
  if(state.trash && state.trash.length > 0){
    const trashDiv = document.createElement("div");
    trashDiv.className = "chat-item trash-item";
    trashDiv.innerHTML = `
      <span style="opacity:0.8">🗑</span>
      <span class="title" style="color:var(--fg-3)">${escapeHtml(t("trash.title") || "Trash")} (${state.trash.length})</span>
      <span class="actions" style="opacity:1">
        <button class="icon-btn" data-act="openTrash" title="${escapeHtml(t("trash.title") || "Trash")}">›</button>
      </span>
    `;
    trashDiv.addEventListener("click", (e) => { e.stopPropagation(); openTrashModal(); });
    list.appendChild(trashDiv);
  }
}

function updateTopBar(){
  const c = currentChat();
  document.getElementById("chatTitle").textContent = c?.title || t("chat.new.default");
  updateScenarioUI();
}

function renderMessages(){
  const box = document.getElementById("messages");
  const chat = currentChat();
  box.innerHTML = "";
  if(!chat || chat.messages.length===0){
    const mkBtn = (n)=>`<button data-p="${escapeHtml(t("empty.prompt."+n+".text"))}">${escapeHtml(t("empty.prompt."+n+".label"))}</button>`;
    box.innerHTML = `
      <div class="empty-state">
        <h2>${escapeHtml(t("empty.title"))}</h2>
        <p>${escapeHtml(t("empty.subtitle"))}</p>
        <div class="prompts">
          ${mkBtn(1)}${mkBtn(2)}${mkBtn(3)}${mkBtn(4)}
        </div>
      </div>`;
    box.querySelectorAll("[data-p]").forEach(b=>b.addEventListener("click",()=>{
      document.getElementById("input").value = b.dataset.p;
      autoresize(document.getElementById("input"));
      document.getElementById("input").focus();
    }));
    return;
  }
  const wrap = document.createElement("div"); wrap.className="msg-wrap";
  for(let i=0;i<chat.messages.length;i++){
    wrap.appendChild(renderMessageEl(chat.messages[i], i));
  }
  box.appendChild(wrap);
  // Welcome chat: show suggestion chips below greeting until first user message
  if(chat.isWelcome && !chat.messages.some(m=>m.role==="user")){
    const chips = document.createElement("div");
    chips.className = "welcome-suggestions";
    WELCOME_SUGGESTIONS.forEach(k=>{
      const b = document.createElement("button");
      b.textContent = t(k);
      b.addEventListener("click",()=>{
        const ta = document.getElementById("input");
        ta.value = t(k+".text");
        autoresize(ta);
        ta.focus();
        sendMessage();
      });
      chips.appendChild(b);
    });
    box.appendChild(chips);
  }
  // 显式动作（新建/切换/发送/重发）→ 强制贴底
  stickToBottom = true;
  _scrollProgrammatic++;
  const scrollBox = document.getElementById("chatView");
  if(scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
  updateScrollBtn();
}

function deriveAvatarText(name){
  const chars = Array.from(String(name||"").trim());
  if(!chars.length) return "?";
  // 英文/数字开头：取前 2 个并大写；其它（中文/emoji/符号）取首字
  if(/^[A-Za-z0-9]/.test(chars[0])) return chars.slice(0,2).join("").toUpperCase();
  return chars[0];
}

/* 消息时间：相对易读格式 + hover 完整时间 */
function _pad2(n){ return String(n).padStart(2,"0"); }
function _clock(d){ return _pad2(d.getHours())+":"+_pad2(d.getMinutes()); }
function fmtMsgTime(ts){
  if(!ts) return "";
  const now = Date.now(), d = new Date(ts), diff = now - ts;
  if(diff < 0) return _clock(d);
  if(diff < 60000) return t("time.justNow");
  if(diff < 3600000) return t("time.minAgo", Math.floor(diff/60000));
  if(diff < 6*3600000) return t("time.hourAgo", Math.floor(diff/3600000));
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if(dayDiff <= 0) return _clock(d);
  if(dayDiff === 1) return t("time.yesterday", _clock(d));
  if(d.getFullYear() === new Date().getFullYear()) return _pad2(d.getMonth()+1)+"-"+_pad2(d.getDate())+" "+_clock(d);
  return d.getFullYear()+"-"+_pad2(d.getMonth()+1)+"-"+_pad2(d.getDate())+" "+_clock(d);
}
function fmtMsgTimeFull(ts){
  if(!ts) return "";
  try{ return new Date(ts).toLocaleString("en-US"); }catch{ return ""; }
}

/* 消息操作图标（单色线性，风格与侧栏统一） */
const MSG_ICON = {
  copy: '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  note: '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>',
  regen: '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  inspect: '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  edit: '<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
};

function getAssistantDisplayName(m){
  const mid = (m && m.model) || (currentChat() && currentChat().model) || state.lastModel || document.getElementById("modelSelect")?.value;
  if(mid){
    const models = getAllModels();
    const found = models.find(x => x.id === mid) || models.find(x => x.model === mid);
    if(found) return found.nick || found.model;
    if(mid.includes("::")) return mid.split("::")[1];
    return mid;
  }
  return state.general.aiName || t("aiName.default");
}

function estimateTokenCount(text){
  if(!text) return 0;
  const str = String(text);
  const cjk = str.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjk ? cjk.length : 0;
  const nonCjk = str.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, " ");
  const words = nonCjk.trim().split(/\s+/).filter(Boolean);
  const wordTokens = Math.ceil(words.length * 1.3);
  return Math.max(1, cjkCount + wordTokens);
}

function computeFallbackSpeed(m){
  if(!m || m.role !== "assistant" || !m.content) return 0;
  const dur = m.rawCall?.response?.durationMs;
  if(dur && dur > 200){
    const tok = estimateTokenCount((m.content||"") + (m.reasoning||""));
    if(tok >= 2){
      return Number((tok / (dur / 1000)).toFixed(1));
    }
  }
  return 0;
}

function renderMessageEl(m, idx){
  // Context divider — visual-only marker, not sent to the model
  if(m.role === "divider"){
    const d = document.createElement("div");
    d.className = "msg-divider";
    const lbl = document.createElement("span"); lbl.className = "lbl";
    const ico = document.createElement("span"); ico.className = "ico"; ico.textContent = "✂";
    const text = document.createElement("span"); text.className = "text"; text.textContent = t("context.divider");
    const x = document.createElement("span"); x.className = "x"; x.textContent = "×";
    x.title = t("context.divider.remove");
    x.setAttribute("role","button");
    x.setAttribute("aria-label", t("context.divider.remove"));
    x.addEventListener("click",(e)=>{ e.stopPropagation(); removeDivider(idx); });
    lbl.appendChild(ico); lbl.appendChild(text); lbl.appendChild(x);
    d.appendChild(lbl);
    return d;
  }
  const div = document.createElement("div"); div.className = "msg "+m.role;
  const userName = state.general.userName || t("userName.default");
  const aiName = m.role === "assistant" ? getAssistantDisplayName(m) : (state.general.aiName || t("aiName.default"));
  const isTool = m.role === "tool";
  const avatar = m.role==="user" ? deriveAvatarText(userName)
               : isTool ? "⚙️"
               : m.role==="assistant" ? deriveAvatarText(aiName)
               : "S";
  const roleLabel = m.role==="user" ? userName
                  : isTool ? `Tool: ${m.name || "call"}`
                  : m.role==="assistant" ? aiName
                  : t("msg.role.system");
  const html = m.role==="user"
    ? `<div class="content"></div>`
    : `<div class="content"></div>`;
  div.innerHTML = `
    <div class="avatar">${escapeHtml(avatar)}</div>
    <div class="body">
      <div class="role">${escapeHtml(roleLabel)}${m.time?`<span class="msg-time" title="${escapeHtml(fmtMsgTimeFull(m.time))}">${escapeHtml(fmtMsgTime(m.time))}</span>`:""}</div>
      <div class="thinking-slot"></div>
      ${html}
      <div class="attachments"></div>
      ${m.meta?`<div class="meta">${escapeHtml(m.meta)}</div>`:""}
      <div class="msg-actions"></div>
    </div>`;
  // render existing thinking (历史消息)
  if(m.role==="assistant" && (m.thought || m.reasoning)){
    const slot = div.querySelector(".thinking-slot");
    const dur = m.reasoningMs ? ` · ${(m.reasoningMs/1000).toFixed(1)}s` : "";
    const showContent = state.general.showThinking && m.reasoning;
    const label = (showContent ? t("thinking.done") : t("thinking.done.hidden")) + dur;
    const det = document.createElement("details"); det.className="thinking-panel";
    det.innerHTML = `<summary><span class="dot"></span><span class="label">${escapeHtml(label)}</span></summary><div class="thinking-content"></div>`;
    if(showContent) det.querySelector(".thinking-content").textContent = m.reasoning;
    slot.appendChild(det);
  }
  const contentEl = div.querySelector(".content");
  // virtualized content: messages with i18nKey re-translate at render time
  const liveContent = m.i18nKey ? t(m.i18nKey) : (m.content || "");
  if(m.role==="user"){
    // user shows raw text (no markdown by default, but keep newlines)
    contentEl.style.whiteSpace = "pre-wrap";
    contentEl.textContent = liveContent;
  }else if(m.role==="tool"){
    contentEl.innerHTML = `
      <details class="tool-result-panel" open>
        <summary><span class="tool-badge">⚙️ Result: ${escapeHtml(m.name || "Tool")}</span></summary>
        <div class="tool-result-body"><pre><code>${escapeHtml(liveContent)}</code></pre></div>
      </details>
    `;
  }else{
    if(m.tool_calls && m.tool_calls.length){
      const callsHtml = m.tool_calls.map(tc => {
        const fnName = tc.function?.name || "unknown";
        const argsStr = tc.function?.arguments || "{}";
        return `<div class="tool-call-badge" title="${escapeHtml(argsStr)}">🛠️ Called <b>${escapeHtml(fnName)}</b></div>`;
      }).join("");
      const callWrap = document.createElement("div");
      callWrap.className = "tool-calls-container";
      callWrap.innerHTML = callsHtml;
      div.querySelector(".body").insertBefore(callWrap, contentEl);
    }
    if(liveContent){
      contentEl.innerHTML = renderMarkdown(liveContent);
      enhanceCodeBlocks(contentEl);
      renderMathIn(contentEl);
      enhanceMermaid(contentEl);
    }else if(!m.thought && !m.reasoning && (!m.tool_calls || !m.tool_calls.length)){
      // 等待首个 token：显示三点跳动占位
      contentEl.innerHTML = `<span class="typing-dots" aria-label="${escapeHtml(t("waiting.aria"))}"><span></span><span></span><span></span></span>`;
    }
  }
  // attachments
  const attEl = div.querySelector(".attachments");
  for(const a of (m.attachments||[])){
    if(a.kind==="image"){
      const img = document.createElement("img"); img.src = a.dataUrl; img.title = a.name||"image";
      attEl.appendChild(img);
    }else{
      const c = document.createElement("div"); c.className="att";
      c.textContent = "📎 "+(a.name||"file")+ (a.text?` (${a.text.length} chars)`:"");
      attEl.appendChild(c);
    }
  }
  // 操作入口统一放在对话块右下角：图标 + 文字（单色线性，风格与侧栏一致）
  const actionBar = div.querySelector(".msg-actions");
  if(m.role === "assistant"){
    const speed = m.tokPerSec || m.rawCall?.response?.tokPerSec || computeFallbackSpeed(m);
    if(speed && speed > 0){
      const badge = document.createElement("span");
      badge.className = "tok-speed";
      badge.innerHTML = `<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span class="lbl">${speed} tok/s</span>`;
      const tokCount = m.tokens || m.rawCall?.response?.tokens;
      badge.title = `${tokCount ? tokCount + " tokens · " : ""}${speed} tokens/s`;
      actionBar.appendChild(badge);
    }
  }
  const mkAction = (icon, label, title, onClick, cls)=>{
    const el = document.createElement("span");
    el.className = cls || "act";
    el.innerHTML = icon + `<span class="lbl">${escapeHtml(label)}</span>`;
    if(title) el.title = title;
    el.addEventListener("click",(e)=>{ e.stopPropagation(); onClick(el); });
    actionBar.appendChild(el);
    return el;
  };
  // 复制
  mkAction(MSG_ICON.copy, t("msg.copy"), t("msg.copy"), (el)=>{
    navigator.clipboard.writeText(m.i18nKey ? t(m.i18nKey) : (m.content||""));
    const lbl = el.querySelector(".lbl"); const orig = lbl.textContent;
    lbl.textContent = t("msg.copied"); setTimeout(()=>{ lbl.textContent = orig; }, 1200);
  }, "copy");
  // 存入记事本（用户 & AI 消息都可）
  if(m.role==="user" || m.role==="assistant"){
    mkAction(MSG_ICON.note, t("notepad.msg.save"), t("notepad.msg.save.title"),
      (el)=>saveMessageToNotepad(m, el.querySelector(".lbl")));
  }
  // 重发（AI）
  if(m.role === "assistant" && idx != null){
    mkAction(MSG_ICON.regen, t("msg.regenerate"), t("msg.regenerate.title"), ()=>regenerateAssistant(idx));
    mkAction(MSG_ICON.inspect, t("msg.rawCall") || "Raw Call", t("msg.rawCall.title") || "View input & output of this call", ()=>openRawCallDrawer(m, idx));
  }
  // 编辑（用户）
  if(m.role === "user" && idx != null){
    mkAction(MSG_ICON.edit, t("msg.edit"), t("msg.edit.title"), ()=>editUserMessage(idx));
  }
  return div;
}

async function regenerateAssistant(idx){
  const chat = currentChat(); if(!chat) return;
  if(isStreaming(chat.id)){ abortStream(chat.id); await new Promise(r=>setTimeout(r,80)); }
  // 删掉该 assistant 消息及之后所有消息（通常之后没有）
  chat.messages = chat.messages.slice(0, idx);
  const sel = document.getElementById("modelSelect").value;
  if(!sel){ alert(t("alert.modelRequired")); return; }
  chat.model = sel; state.lastModel = sel;
  const aiMsg = { role:"assistant", content:"", reasoning:"", reasoningMs:0, thought:false, time:Date.now() };
  chat.messages.push(aiMsg);
  saveState(); renderMessages();
  await streamResponse(chat, aiMsg, sel);
  maybeAutoCompress(chat);
}

async function editUserMessage(idx){
  const chat = currentChat(); if(!chat) return;
  const msg = chat.messages[idx]; if(!msg || msg.role !== "user") return;
  if(isStreaming(chat.id)){ abortStream(chat.id); await new Promise(r=>setTimeout(r,80)); }
  const ta = document.getElementById("input");
  ta.value = msg.content || "";
  pendingAttachments = (msg.attachments||[]).map(a=>({...a}));
  renderAttachStrip();
  // 从该消息开始截断
  chat.messages = chat.messages.slice(0, idx);
  saveState(); renderMessages();
  autoresize(ta); ta.focus();
}

function enhanceCodeBlocks(root){
  root.querySelectorAll("pre code").forEach(code=>{
    const lang = (code.className.match(/language-([a-z0-9-]+)/i) || [])[1] || "";
    const text = code.textContent || "";
    // Mermaid blocks become rendered diagrams later — skip highlighting and copy button
    if(isMermaidCode(text, lang)) return;
    try{ hljs.highlightElement(code); }catch{}
    const pre = code.parentElement;
    if(pre.querySelector(".copy-code")) return;
    const btn = document.createElement("button"); btn.className="copy-code"; btn.textContent=t("msg.copy");
    btn.addEventListener("click",(e)=>{ e.stopPropagation(); navigator.clipboard.writeText(code.textContent); btn.textContent=t("msg.copied"); setTimeout(()=>btn.textContent=t("msg.copy"),1200); });
    pre.appendChild(btn);
  });
}

function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

