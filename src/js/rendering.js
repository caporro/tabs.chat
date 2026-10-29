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

let _activeMenuChatId = null;

function closeChatMenu(){
  const menu = document.getElementById("chatMenuDropdown");
  if(menu && !menu.classList.contains("hide")){
    menu.classList.add("hide");
    menu.innerHTML = "";
  }
  _activeMenuChatId = null;
  document.querySelectorAll(".chat-item.menu-open").forEach(el => el.classList.remove("menu-open"));
}

function togglePinChat(cid){
  const chat = (state.chats || []).find(c => c.id === cid);
  if(!chat) return;
  chat.pinned = !chat.pinned;
  saveState();
  renderChatList();
}

function copyChatToClipboard(chatId){
  const chat = (state.chats || []).find(c => c.id === chatId);
  if(!chat || !chat.messages || !chat.messages.length){
    if(typeof showToast === "function") showToast(t("toast.chatEmpty") || "Chat is empty");
    return;
  }
  let txt = `# ${chat.title || "Chat"}\n\n`;
  for(const m of chat.messages){
    if(m.role === "system") continue;
    const identity = resolvedIdentity(getAgentForChat(chat));
    const author = m.role === "user" ? (identity.userName || "User") : identity.agentName;
    txt += `### ${author}\n${m.content || ""}\n\n`;
  }
  navigator.clipboard.writeText(txt.trim()).then(()=>{
    if(typeof showToast === "function") showToast("✓ " + (t("toast.chatCopied") || "Chat copied to clipboard"));
  }).catch(()=>{
    if(typeof showToast === "function") showToast(t("toast.copyFailed") || "Copy failed");
  });
}

function toggleChatMenu(chatId, btnEl, evt){
  let menu = document.getElementById("chatMenuDropdown");
  if(!menu){
    menu = document.createElement("div");
    menu.id = "chatMenuDropdown";
    menu.className = "chat-menu-dropdown hide";
    document.body.appendChild(menu);
  }
  if(!menu.classList.contains("hide") && _activeMenuChatId === chatId){
    closeChatMenu();
    return;
  }
  _activeMenuChatId = chatId;
  const targetChat = (state.chats || []).find(x => x.id === chatId);
  const hasMem = !!(targetChat?.contextSummary && targetChat.contextSummary.trim());
  const isPinned = !!targetChat?.pinned;

  menu.innerHTML = `
    <button type="button" class="chat-menu-item" data-menu-act="rename">
      ${typeof icon === "function" ? icon("pencil", { size: 17 }) : '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>'}
      <span>${escapeHtml(t("chat.action.rename") || "Rinomina")}</span>
    </button>
    <button type="button" class="chat-menu-item" data-menu-act="pin">
      ${typeof icon === "function" ? icon("pin", { size: 17 }) : '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>'}
      <span>${escapeHtml(isPinned ? (t("chat.action.unpin") || "Rimuovi da fissati") : (t("chat.action.pin") || "Fissa"))}</span>
    </button>
    <div class="chat-menu-divider"></div>
    <button type="button" class="chat-menu-item" data-menu-act="share">
      ${typeof icon === "function" ? icon("share", { size: 17 }) : '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>'}
      <span>${escapeHtml(t("chat.action.share") || "Condividi")}</span>
    </button>
    <button type="button" class="chat-menu-item" data-menu-act="memory">
      ${typeof icon === "function" ? icon("brain", { size: 17 }) : '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a5 5 0 0 0-5 5v1a4 4 0 0 0-2 7.46V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.54A4 4 0 0 0 17 8V7a5 5 0 0 0-5-5Z"/><path d="M10 12h4"/><path d="M10 16h4"/></svg>'}
      <span>${escapeHtml(t("memory.btn.title") || "Memoria")}${hasMem ? " •" : ""}</span>
    </button>
    <div class="chat-menu-divider"></div>
    <button type="button" class="chat-menu-item danger" data-menu-act="delete">
      ${typeof icon === "function" ? icon("trash", { size: 17 }) : '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>'}
      <span>${escapeHtml(t("chat.action.delete") || "Elimina")}</span>
    </button>
  `;

  const rect = btnEl.getBoundingClientRect();
  const menuWidth = 195;
  const menuHeight = 220;

  // Align left with the mouse pointer so the popup expands to the right
  let left = (evt && typeof evt.clientX === "number") ? evt.clientX : rect.right;
  let top = (evt && typeof evt.clientY === "number") ? (evt.clientY - 6) : rect.top;

  // Prevent overflowing right edge of window
  if(left + menuWidth > window.innerWidth - 8){
    left = Math.max(8, window.innerWidth - menuWidth - 8);
  }
  // Prevent overflowing bottom edge of window
  if(top + menuHeight > window.innerHeight - 8){
    top = Math.max(8, window.innerHeight - menuHeight - 8);
  }
  if(top < 8) top = 8;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.classList.remove("hide");

  document.querySelectorAll(".chat-item.menu-open").forEach(el => el.classList.remove("menu-open"));
  btnEl.closest(".chat-item")?.classList.add("menu-open");
}

// Global listener for chat action menu dropdown
document.addEventListener("click", (e) => {
  const menuItem = e.target.closest(".chat-menu-item");
  if(menuItem && _activeMenuChatId){
    e.stopPropagation();
    const act = menuItem.dataset.menuAct;
    const cid = _activeMenuChatId;
    closeChatMenu();
    if(act === "rename") renameChat(cid);
    else if(act === "pin") togglePinChat(cid);
    else if(act === "share") copyChatToClipboard(cid);
    else if(act === "memory") openMemoryModal(cid);
    else if(act === "delete") deleteChat(cid);
    return;
  }
  if(!e.target.closest("#chatMenuDropdown") && !e.target.closest("[data-act='more']")){
    closeChatMenu();
  }
});
window.addEventListener("resize", closeChatMenu, { passive: true });

function renderChatList(){
  closeChatMenu();
  const list = document.getElementById("chatList");
  list.innerHTML = "";
  const agent = (typeof getCurrentAgent === "function") ? getCurrentAgent() : null;
  const agentChats = (agent && Array.isArray(agent.chats)) ? agent.chats : (state.chats || []);
  agentChats.sort((a,b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  for(const c of agentChats){
    const div = document.createElement("div");
    div.className = "chat-item"+(c.id===state.activeChatId?" active":"")+(isStreaming(c.id)?" streaming":"");
    div.draggable = true;
    div.dataset.id = c.id;

    div.innerHTML = `
      <span class="title">${escapeHtml(c.title||t("chat.untitled"))}</span>
      ${isStreaming(c.id)?'<span class="stream-dot" title="Generating…"></span>':""}
      <span class="actions">
        <button class="icon-btn" data-act="more" title="${escapeHtml(t("chat.action.more") || "Options")}" aria-label="Chat options">
          <svg class="fi" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="1.3"/>
            <circle cx="12" cy="5" r="1.3"/>
            <circle cx="12" cy="19" r="1.3"/>
          </svg>
        </button>
        <button class="icon-btn" data-act="delete" title="${escapeHtml(t("chat.action.delete") || "Delete")}" aria-label="Delete chat">
          <svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
        </button>
      </span>`;

    div.addEventListener("click",(e)=>{
      const btn = e.target.closest("button");
      const act = btn?.dataset.act;
      if(act==="more"){
        e.stopPropagation();
        toggleChatMenu(c.id, btn, e);
      } else if(act==="delete"){
        e.stopPropagation();
        closeChatMenu();
        deleteChat(c.id);
      } else {
        closeChatMenu();
        switchChat(c.id);
      }
    });
    div.addEventListener("contextmenu",(e)=>{
      e.preventDefault();
      e.stopPropagation();
      const btn = div.querySelector("[data-act='more']") || div;
      toggleChatMenu(c.id, btn, e);
    });
    div.addEventListener("dragstart",(e)=>{
      closeChatMenu();
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
      <span class="title" style="color:var(--fg-3)">${escapeHtml(t("trash.title") || "Trash")} (${state.trash.length})</span>
      <span class="actions" style="opacity:1">
        <button class="icon-btn" data-act="openTrash" title="${escapeHtml(t("trash.title") || "Trash")}">
          <svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </span>
    `;
    trashDiv.addEventListener("click", (e) => { e.stopPropagation(); closeChatMenu(); openTrashModal(); });
    list.appendChild(trashDiv);
  }
}

function updateTopBar(){
  const c = currentChat();
  document.getElementById("chatTitle").textContent = c?.title || t("chat.new.default");
  updateMemoryUI();
}

function renderMessages(){
  const box = document.getElementById("messages");
  const chat = currentChat();
  box.innerHTML = "";

  const curAgent = (typeof getCurrentAgent === "function") ? getCurrentAgent() : null;
  const hasCustomWelcome = !!(curAgent?.welcomeTitle || curAgent?.welcomePrompts?.length || state.general?.welcomeTitle || state.general?.welcomePrompts?.length);

  // First-run / unconfigured state: render the interactive onboarding hero (only if no custom welcome screen is set)
  if(!hasCustomWelcome && !hasConfiguredLLM() && (!chat || !chat.messages.some(m => m.role === "user"))){
    if(typeof renderOnboardingHero === "function"){
      renderOnboardingHero(box);
    }
    if(typeof updateComposerPlaceholder === "function") updateComposerPlaceholder();
    stickToBottom = false;
    updateScrollBtn();
    return;
  }

  if(typeof updateComposerPlaceholder === "function") updateComposerPlaceholder();

  if(!chat || chat.messages.length===0){
    const title = (curAgent?.welcomeTitle || state.general?.welcomeTitle || t("empty.title")).trim();
    const desc = (curAgent?.welcomeDesc || state.general?.welcomeDesc || t("empty.subtitle")).trim();

    let promptsList = [];
    if(curAgent && Array.isArray(curAgent.welcomePrompts) && curAgent.welcomePrompts.length > 0){
      promptsList = curAgent.welcomePrompts;
    } else if(Array.isArray(state.general?.welcomePrompts) && state.general.welcomePrompts.length > 0){
      promptsList = state.general.welcomePrompts;
    } else if(typeof getDefaultEmptyPrompts === "function"){
      promptsList = getDefaultEmptyPrompts();
    } else {
      promptsList = [
        { label: t("empty.prompt.1.label"), text: t("empty.prompt.1.text") },
        { label: t("empty.prompt.2.label"), text: t("empty.prompt.2.text") },
        { label: t("empty.prompt.3.label"), text: t("empty.prompt.3.text") },
        { label: t("empty.prompt.4.label"), text: t("empty.prompt.4.text") }
      ];
    }

    const buttonsHtml = promptsList.map(p => {
      const lbl = escapeHtml(p.label || p.title || p.text || "");
      const desc = escapeHtml(p.desc || (p.text && p.text !== p.label ? p.text : ""));
      const txt = escapeHtml(p.text || p.prompt || p.label || "");
      return `
        <button type="button" data-p="${txt}">
          <div class="prompt-title">${lbl}</div>
          ${desc ? `<div class="prompt-desc">${desc}</div>` : ""}
        </button>
      `;
    }).join("");

    box.innerHTML = `
      <div class="empty-state">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(desc)}</p>
        <div class="prompts">
          ${buttonsHtml}
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
    const m = chat.messages[i];
    if(m.role === "tool"){
      // Tool results are integrated into their calling assistant turn's accordion.
      // Only render standalone msg.tool if orphaned (no preceding assistant message).
      const hasPrecedingAssistant = chat.messages.slice(0, i).some(prev => prev.role === "assistant");
      if(hasPrecedingAssistant) continue;
    }
    wrap.appendChild(renderMessageEl(m, i));
  }
  box.appendChild(wrap);
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
  copy: icon("copy", { className: "mi" }),
  note: icon("file-text", { className: "mi" }),
  regen: icon("refresh-cw", { className: "mi" }),
  inspect: icon("code", { className: "mi" }),
  edit: icon("pencil", { className: "mi" })
};

function getAssistantDisplayName(m){
  return resolvedIdentity(getAgentForChat(currentChat())).agentName;
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

function formatToolArgsSummary(argsStrOrObj){
  let args = {};
  try {
    args = typeof argsStrOrObj === "string" ? JSON.parse(argsStrOrObj) : (argsStrOrObj || {});
  } catch(e){
    return typeof argsStrOrObj === "string" ? argsStrOrObj.slice(0, 32) : "";
  }
  if(!args || typeof args !== "object") return "";
  const keys = Object.keys(args);
  if(keys.length === 0) return "";
  const priorityKeys = ["title", "name", "query", "q", "id", "path", "url", "command", "prompt", "text"];
  for(const pk of priorityKeys){
    if(args[pk] !== undefined && args[pk] !== null && String(args[pk]).trim() !== ""){
      const val = String(args[pk]);
      const shortVal = val.length > 24 ? val.slice(0, 14) + "…" + val.slice(-6) : val;
      return `${pk}: "${shortVal}"`;
    }
  }
  const firstKey = keys[0];
  const firstVal = String(args[firstKey]);
  const shortVal = firstVal.length > 24 ? firstVal.slice(0, 18) + "…" : firstVal;
  return `${firstKey}: "${shortVal}"`;
}

function isAssistantContinuation(messages, idx){
  if(!messages || idx <= 0 || messages[idx]?.role !== "assistant") return false;
  for(let j = idx - 1; j >= 0; j--){
    const prev = messages[j];
    if(prev.role === "tool") continue;
    if(prev.role === "assistant") return true;
    return false;
  }
  return false;
}

function renderToolCallsAccordion(toolCalls, chatMessages){
  if(!toolCalls || !toolCalls.length) return null;
  const container = document.createElement("div");
  container.className = "tool-calls-accordion-wrap";

  const isSingle = toolCalls.length === 1;
  const tcList = toolCalls.map(tc => {
    const fnName = tc.function?.name || "tool";
    const rawArgs = tc.function?.arguments || "{}";
    const argsSummary = formatToolArgsSummary(rawArgs);

    let parsedArgs = null;
    try { parsedArgs = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs; } catch {}
    const formattedArgs = parsedArgs ? JSON.stringify(parsedArgs, null, 2) : String(rawArgs);

    const resMsg = (chatMessages || []).find(m => m.role === "tool" && m.tool_call_id === tc.id);
    const hasResult = !!resMsg;
    let formattedResult = "";
    let isError = false;
    if(hasResult){
      const rawRes = resMsg.content || "";
      if(typeof rawRes === "string" && (rawRes.startsWith("Error executing tool") || rawRes.startsWith("Error:"))) {
        isError = true;
      }
      try {
        const parsedRes = JSON.parse(rawRes);
        formattedResult = JSON.stringify(parsedRes, null, 2);
      } catch {
        formattedResult = String(rawRes);
      }
    }

    return {
      id: tc.id,
      name: fnName,
      argsSummary,
      formattedArgs,
      hasResult,
      formattedResult,
      isError
    };
  });

  const allDone = tcList.every(t => t.hasResult);
  const anyError = tcList.some(t => t.isError);

  const det = document.createElement("details");
  det.className = "tool-calls-accordion";
  det.open = false; // Closed by default

  const titleHtml = isSingle
    ? `${icon("wrench", { size: 14, extra: 'style="vertical-align:-2px;margin-right:4px"' })}<b>${escapeHtml(tcList[0].name)}</b>${tcList[0].argsSummary ? ` <span class="tool-arg-pill">${escapeHtml(tcList[0].argsSummary)}</span>` : ""}`
    : `${icon("wrench", { size: 14, extra: 'style="vertical-align:-2px;margin-right:4px"' })}<b>${t("tool.group.label", tcList.length) || `${tcList.length} tool calls executed`}</b> <span class="tool-group-sub">(${escapeHtml(tcList.map(t=>t.name).join(", "))})</span>`;

  const statusBadge = allDone
    ? (anyError
        ? `<span class="tool-status error">⚠️ ${escapeHtml(t("tool.status.error") || "Error")}</span>`
        : `<span class="tool-status success">✓ ${escapeHtml(t("tool.status.done") || "Done")}</span>`)
    : `<span class="tool-status running"><span class="tool-spin"></span> ${escapeHtml(t("tool.status.running") || "Running...")}</span>`;

  det.innerHTML = `
    <summary class="tool-accordion-summary">
      <span class="tool-summary-left">
        <svg class="chevron-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        <span class="tool-summary-title">${titleHtml}</span>
      </span>
      <span class="tool-summary-right">${statusBadge}</span>
    </summary>
    <div class="tool-accordion-body"></div>
  `;

  const body = det.querySelector(".tool-accordion-body");
  tcList.forEach(item => {
    const itemEl = document.createElement("details");
    itemEl.className = "tool-call-item" + (item.isError ? " error" : "");
    itemEl.open = isSingle;

    const itemStatus = item.hasResult
      ? (item.isError ? `<span class="tool-item-tag error">Error</span>` : `<span class="tool-item-tag success">✓</span>`)
      : `<span class="tool-item-tag running">⏳</span>`;

    itemEl.innerHTML = `
      <summary class="tool-item-summary">
        <span class="tool-item-left">
          <svg class="chevron-ico sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          <span class="tool-item-name">${icon("wrench", { size: 13, extra: 'style="vertical-align:-2px;margin-right:3px"' })}<b>${escapeHtml(item.name)}</b></span>
          ${item.argsSummary ? `<span class="tool-arg-pill">${escapeHtml(item.argsSummary)}</span>` : ""}
        </span>
        <span class="tool-item-right">${itemStatus}</span>
      </summary>
      <div class="tool-item-content">
        <div class="tool-section">
          <div class="tool-section-head">
            <span>${escapeHtml(t("tool.inputParams") || "Input Parameters")}</span>
          </div>
          <pre><code>${escapeHtml(item.formattedArgs)}</code></pre>
        </div>
        <div class="tool-section">
          <div class="tool-section-head">
            <span>${escapeHtml(t("tool.result") || "Result")}</span>
            ${item.hasResult ? `<button class="copy-tool-res-btn" type="button">${escapeHtml(t("tool.copyResult") || "Copy Result")}</button>` : ""}
          </div>
          ${item.hasResult
            ? `<pre><code>${escapeHtml(item.formattedResult || "(Empty output)")}</code></pre>`
            : `<div class="tool-running-placeholder"><span class="typing-dots"><span></span><span></span><span></span></span> Executing...</div>`}
        </div>
      </div>
    `;

    const copyBtn = itemEl.querySelector(".copy-tool-res-btn");
    if(copyBtn){
      copyBtn.addEventListener("click", (e)=>{
        e.stopPropagation();
        navigator.clipboard.writeText(item.formattedResult);
        copyBtn.textContent = t("tool.copied") || "Copied!";
        setTimeout(()=>copyBtn.textContent = t("tool.copyResult") || "Copy Result", 1500);
      });
    }

    body.appendChild(itemEl);
  });

  container.appendChild(det);
  return container;
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
  const isContinuation = isAssistantContinuation(currentChat()?.messages || [], idx);
  const div = document.createElement("div"); div.className = "msg "+m.role + (isContinuation ? " continuation" : "");
  const identity = resolvedIdentity(getAgentForChat(currentChat()));
  const userName = identity.userName || t("userName.default");
  const aiName = identity.agentName;
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
      ${m.notice ? `<div class="hint message-notice" role="status">${escapeHtml(m.notice)}</div>` : ""}
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
      <details class="tool-result-panel">
        <summary><span class="tool-badge">⚙️ Result: ${escapeHtml(m.name || "Tool")}</span></summary>
        <div class="tool-result-body"><pre><code>${escapeHtml(liveContent)}</code></pre></div>
      </details>
    `;
  }else{
    if(liveContent){
      contentEl.innerHTML = renderMarkdown(liveContent);
      enhanceCodeBlocks(contentEl);
      renderMathIn(contentEl);
      enhanceMermaid(contentEl);
    }else if(!m.thought && !m.reasoning && (!m.tool_calls || !m.tool_calls.length)){
      // 等待首个 token：显示三点跳动占位或模型加载状态
      if(m._loadingStatus){
        contentEl.innerHTML = `<div class="ollama-load-status"><span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span> <span class="load-text">${escapeHtml(t("ollama.loadingModel"))}</span></div>`;
      }else{
        contentEl.innerHTML = `<span class="typing-dots" aria-label="${escapeHtml(t("waiting.aria"))}"><span></span><span></span><span></span></span>`;
      }
    }
    if(m.tool_calls && m.tool_calls.length){
      const acc = renderToolCallsAccordion(m.tool_calls, currentChat()?.messages || []);
      if(acc) div.querySelector(".body").insertBefore(acc, div.querySelector(".attachments"));
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
      c.innerHTML = `${icon("paperclip", { size: 13, extra: 'style="vertical-align:-2px;margin-right:4px"' })}<span>${escapeHtml(a.name||"file")}${a.text?` (${a.text.length} chars)`:""}</span>`;
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
      badge.innerHTML = `${icon("zap", { className: "mi", strokeWidth: 2.5 })}<span class="lbl">${speed} tok/s</span>`;
      const tokCount = m.tokens || m.rawCall?.response?.tokens;
      const loadMs = m.loadDurationMs || m.rawCall?.response?.loadDurationMs;
      const loadInfo = (loadMs && loadMs > 100) ? ` · load: ${(loadMs/1000).toFixed(1)}s` : "";
      badge.title = `${tokCount ? tokCount + " tokens · " : ""}${speed} tokens/s${loadInfo}`;
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
  const hasContent = !!(m.i18nKey ? t(m.i18nKey) : (m.content||"")).trim();
  // 复制
  if(hasContent){
    mkAction(MSG_ICON.copy, t("msg.copy"), t("msg.copy"), (el)=>{
      navigator.clipboard.writeText(m.i18nKey ? t(m.i18nKey) : (m.content||""));
      const lbl = el.querySelector(".lbl"); const orig = lbl.textContent;
      lbl.textContent = t("msg.copied"); setTimeout(()=>{ lbl.textContent = orig; }, 1200);
    }, "copy");
  }
  // 存入记事本（用户 & AI 消息都可）
  if((m.role==="user" || m.role==="assistant") && hasContent){
    mkAction(MSG_ICON.note, t("notepad.msg.save"), t("notepad.msg.save.title"),
      (el)=>saveMessageToNotepad(m, el.querySelector(".lbl")));
  }
  // 重发（AI）
  if(m.role === "assistant" && idx != null){
    mkAction(MSG_ICON.regen, t("msg.regenerate"), t("msg.regenerate.title"), ()=>regenerateAssistant(idx));
    if(isInspectionEnabled()){
      const inspect = mkAction(MSG_ICON.inspect, t("msg.rawCall") || "Response details", t("msg.rawCall.title") || "View response details", ()=>openRawCallDrawer(m, idx), "act inspect");
      inspect.tabIndex = 0;
      inspect.setAttribute("role", "button");
      inspect.onkeydown = event => { if(event.key === "Enter" || event.key === " "){ event.preventDefault(); inspect.click(); } };
    }
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

  let targetIdx = idx;
  while(targetIdx > 0 && isAssistantContinuation(chat.messages, targetIdx)){
    targetIdx--;
    while(targetIdx > 0 && chat.messages[targetIdx].role === "tool") targetIdx--;
  }

  chat.messages = chat.messages.slice(0, targetIdx);
  const sel = document.getElementById("modelSelect").value;
  if(!sel){ alert(t("alert.modelRequired")); return; }
  chat.model = sel; state.lastModel = sel;
  const aiMsg = { role:"assistant", content:"", reasoning:"", reasoningMs:0, thought:false, time:Date.now() };
  chat.messages.push(aiMsg);
  saveState(); renderMessages();

  if(state.toolSettings?.enabled && toolRegistry.hasTools()){
    await runAgentLoop(chat, aiMsg, sel);
  } else {
    await streamResponse(chat, aiMsg, sel);
  }
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
    const diagram = isMermaidCode(text, lang);
    if(diagram && appHasFeature('diagrams')) return;
    if(!diagram){ try{ hljs.highlightElement(code); }catch{} }
    else code.classList.add('hljs');
    const pre = code.parentElement;
    if(pre.querySelector(".copy-code")) return;
    const btn = document.createElement("button"); btn.className="copy-code"; btn.textContent=t("msg.copy");
    btn.addEventListener("click",(e)=>{ e.stopPropagation(); navigator.clipboard.writeText(code.textContent); btn.textContent=t("msg.copied"); setTimeout(()=>btn.textContent=t("msg.copy"),1200); });
    pre.appendChild(btn);
  });
}

function escapeHtml(s){ return (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

