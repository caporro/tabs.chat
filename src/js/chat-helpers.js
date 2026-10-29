/* ------------------------- Chat helpers ------------------------- */
function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }

function parsePromptButtonLine(line){
  if(!line || !line.trim()) return null;
  const parts = line.split("|").map(s => s.trim());
  if(parts.length === 1){
    return { label: parts[0], desc: "", text: parts[0] };
  } else if(parts.length === 2){
    return { label: parts[0], desc: "", text: parts[1] };
  } else {
    return { label: parts[0], desc: parts[1], text: parts.slice(2).join("|") };
  }
}

function parsePromptButtons(val){
  if(!val) return [];
  if(Array.isArray(val)){
    return val.map(item => {
      if(typeof item === "string") return parsePromptButtonLine(item);
      if(item && typeof item === "object"){
        return {
          label: (item.label || item.title || item.text || "").trim(),
          desc: (item.desc || item.description || "").trim(),
          text: (item.text || item.prompt || item.label || item.title || "").trim()
        };
      }
      return null;
    }).filter(Boolean);
  }
  if(typeof val === "string"){
    const trimmed = val.trim();
    if(trimmed.startsWith("[") && trimmed.endsWith("]")){
      try {
        const parsed = JSON.parse(trimmed);
        return parsePromptButtons(parsed);
      } catch(e){}
    }
    return trimmed.split("\n")
      .map(line => parsePromptButtonLine(line))
      .filter(Boolean);
  }
  return [];
}

function formatPromptButtons(buttons){
  if(!Array.isArray(buttons)) return "";
  return buttons.map(b => {
    if(!b) return "";
    if(typeof b === "string") return b;
    const lbl = (b.label || b.title || "").trim();
    const desc = (b.desc || b.description || "").trim();
    const txt = (b.text || b.prompt || lbl).trim();
    if(desc){
      return `${lbl} | ${desc} | ${txt}`;
    } else if(lbl !== txt){
      return `${lbl} | ${txt}`;
    }
    return lbl;
  }).filter(Boolean).join("\n");
}

let _currentAgentModalMode = "create";
let _currentAgentModalTargetId = null;

function openAgentModal({ mode = "create", agentId = null } = {}){
  _currentAgentModalMode = mode;
  _currentAgentModalTargetId = agentId;

  const modal = document.getElementById("agentModal");
  const titleEl = document.getElementById("agentModalTitle");
  const nameInp = document.getElementById("agentModalNameInput");
  const authorInp = document.getElementById("agentModalAuthorInput");
  const versionInp = document.getElementById("agentModalVersionInput");
  const ephemChk = document.getElementById("agentModalEphemeralCheck");

  if(mode === "edit" && agentId){
    const agent = (state.agents || []).find(t => t.id === agentId);
    if(titleEl) titleEl.textContent = "Edit agent";
    if(nameInp) nameInp.value = agent ? agent.name : "";
    if(authorInp) authorInp.value = (agent && agent.author) ? agent.author : "";
    if(versionInp) versionInp.value = (agent && agent.version) ? agent.version : "1.0.0";
    if(ephemChk) ephemChk.checked = !!(agent && agent.ephemeral);
  } else {
    if(titleEl) titleEl.textContent = "New agent";
    if(nameInp) nameInp.value = "";
    if(authorInp) authorInp.value = "";
    if(versionInp) versionInp.value = "1.0.0";
    if(ephemChk) ephemChk.checked = false;
  }
  document.getElementById("saveAgentModalBtn").textContent = mode === "edit" ? "Done" : "Create agent";
  document.getElementById("cancelAgentModalBtn").classList.toggle("hide", mode === "edit");

  if(modal) modal.classList.remove("hide");
  setTimeout(() => { if(nameInp) { nameInp.focus(); nameInp.select(); } }, 50);
}

function closeAgentModal(){
  if(!flushSettingsAutosave()) return;
  const modal = document.getElementById("agentModal");
  if(modal) modal.classList.add("hide");
  _currentAgentModalTargetId = null;
}

function agentModalChanged(){
  if(_currentAgentModalMode !== "edit") return;
  const agent = state.agents.find(item => item.id === _currentAgentModalTargetId);
  if(!agent) return;
  agent.name = document.getElementById("agentModalNameInput").value.trim() || agent.name;
  agent.author = document.getElementById("agentModalAuthorInput").value.trim();
  agent.version = document.getElementById("agentModalVersionInput").value.trim() || "1.0.0";
  agent.ephemeral = document.getElementById("agentModalEphemeralCheck").checked;
  agent.signature = computeAgentSignature(agent);
  if(isSettingsOpen() && _settingsCurrentAgentId === agent.id){
    document.getElementById("agent_cfg_name").value = agent.name;
    document.getElementById("agentVersionInput").value = agent.version;
    document.getElementById("agent_cfg_author").value = agent.author;
    updateSettingsSectionHeader();
    renderSettingsSidebar();
  }
  queueSettingsAutosave();
}

function saveAgentModal(){
  const nameInp = document.getElementById("agentModalNameInput");
  const authorInp = document.getElementById("agentModalAuthorInput");
  const versionInp = document.getElementById("agentModalVersionInput");
  const ephemChk = document.getElementById("agentModalEphemeralCheck");

  const name = (nameInp ? nameInp.value : "").trim();
  if(!name){
    if(nameInp) nameInp.focus();
    return;
  }

  const meta = {
    author: (authorInp ? authorInp.value : "").trim(),
    version: (versionInp ? versionInp.value : "").trim() || "1.0.0",
    ephemeral: !!(ephemChk && ephemChk.checked)
  };

  if(_currentAgentModalMode === "edit" && _currentAgentModalTargetId){
    agentModalChanged();
  } else {
    createAgent(name, null, null, meta);
  }

  closeAgentModal();
  document.getElementById("agentDropdown")?.classList.add("hide");
}

function getAgentChats(agentId = state.activeAgentId){
  const agent = state.agents.find(t => t.id === agentId) || getCurrentAgent();
  return agent.chats || [];
}

function renderAgentBar(){
  const cur = getCurrentAgent();
  const iconEl = document.getElementById("agentCurrentIcon");
  const nameEl = document.getElementById("agentCurrentName");
  if(iconEl) iconEl.style.display = "none";
  if(nameEl) nameEl.textContent = cur.name || "Default";

  const listEl = document.getElementById("agentList");
  if(!listEl) return;
  listEl.innerHTML = "";
  (state.agents || []).forEach(agent => {
    const item = document.createElement("div");
    item.className = "agent-item" + (agent.id === state.activeAgentId ? " active" : "");
    const esc = (s) => (typeof escapeHtml === "function") ? escapeHtml(s) : String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    item.innerHTML = `
      <span class="agent-item-name">${esc(agent.name)}</span>
      <div class="agent-item-actions">
        <button type="button" class="agent-item-btn agent-rename" title="Edit agent">${typeof icon === "function" ? icon("pencil", { size: 12 }) : "✎"}</button>
        ${state.agents.length > 1 ? `<button type="button" class="agent-item-btn agent-delete" title="Delete agent" style="color:var(--danger)">${typeof icon === "function" ? icon("trash", { size: 12 }) : "🗑"}</button>` : ''}
      </div>
    `;
    item.onclick = (e) => {
      if(e.target.closest(".agent-rename")){
        e.stopPropagation();
        openAgentModal({ mode: "edit", agentId: agent.id });
        return;
      }
      if(e.target.closest(".agent-delete")){
        e.stopPropagation();
        deleteAgent(agent.id);
        return;
      }
      switchAgent(agent.id);
      document.getElementById("agentDropdown")?.classList.add("hide");
    };
    listEl.appendChild(item);
  });
  const divider = document.createElement("div");
  divider.className = "agent-divider";
  listEl.appendChild(divider);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "agent-add-row-btn";
  addBtn.id = "agentAddBtn";
  addBtn.innerHTML = `${typeof icon === "function" ? icon("plus", { size: 16 }) : "+"} <span>Create agent</span>`;
  addBtn.onclick = (e) => {
    e.stopPropagation();
    openAgentModal({ mode: "create" });
  };
  listEl.appendChild(addBtn);
}

function switchAgent(agentId){
  if(state.activeAgentId === agentId) return;
  state.activeAgentId = agentId;
  if(typeof toolRegistry !== "undefined") toolRegistry.toolsMap.clear();
  const curAgent = getCurrentAgent();
  if(curAgent.chats.length > 0){
    state.activeChatId = curAgent.chats[0].id;
  } else {
    const id = uid();
    const chat = {
      id,
      title: t("chat.new.default"),
      model: state.lastModel || "",
      agentId: curAgent.id,
      promptMode: "inherit",
      messages: [],
      createdAt: Date.now()
    };
    curAgent.chats.unshift(chat);
    state.activeChatId = id;
  }
  saveState();
  if(typeof renderAgentBar === "function") renderAgentBar();
  if(typeof populateModelSelect === "function") populateModelSelect();
  if(typeof renderChatList === "function") renderChatList();
  if(typeof renderMessages === "function") renderMessages();
  if(typeof updateTopBar === "function") updateTopBar();
  if(typeof renderConfiguredProviders === "function") renderConfiguredProviders();
  if(typeof isNotepadOpen === "function" && isNotepadOpen() && typeof renderNotes === "function") {
    renderNotes();
  }
}

function switchWorkspace(agentId){
  switchAgent(agentId);
}

function createAgent(name, config = null, systemPrompt = null, meta = {}){
  const agentName = (name || "").trim() || `Agent ${(state.agents?.length || 0) + 1}`;
  const agent = createDefaultAgent(agentName, config, systemPrompt, meta);
  if(!Array.isArray(state.agents)) state.agents = [];
  state.agents.push(agent);
  switchAgent(agent.id);
  if(typeof renderSettingsSidebar === "function") renderSettingsSidebar();
  if(typeof isSettingsOpen === "function" && isSettingsOpen()){
    if(typeof selectAgentInSettings === "function") selectAgentInSettings(agent.id);
  }
  return agent;
}

function createWorkspace(name){
  return createAgent(name);
}

function updateAgent(id, updates = {}){
  const agent = (state.agents || []).find(t => t.id === id);
  if(!agent) return;
  if(updates.name !== undefined && updates.name.trim()) agent.name = updates.name.trim();
  if(updates.author !== undefined) agent.author = updates.author.trim();
  if(updates.version !== undefined) agent.version = updates.version.trim();
  if(updates.ephemeral !== undefined) agent.ephemeral = !!updates.ephemeral;
  agent.signature = computeAgentSignature(agent);
  saveState();
  renderAgentBar();
  if(typeof renderSettingsSidebar === "function") renderSettingsSidebar();
  if(typeof isSettingsOpen === "function" && isSettingsOpen()){
    const titleEl = document.getElementById("settingsMainTitle");
    if(titleEl && agent.id === (typeof _settingsCurrentAgentId !== "undefined" ? _settingsCurrentAgentId : state.activeAgentId)){
      titleEl.textContent = agent.name;
    }
  }
}

function renameAgent(id, newName){
  updateAgent(id, { name: newName });
}

function renameWorkspace(id, newName){
  renameAgent(id, newName);
}

function deleteAgent(id){
  if(!state.agents || state.agents.length <= 1){
    alert("Cannot delete the only agent.");
    return;
  }
  const agent = state.agents.find(t => t.id === id);
  if(!confirm(`Delete agent "${agent?.name || id}" and its chats? Notes will be kept.`)) return;
  (state.notes || []).forEach(note => { if(note.agentId === id) note.agentId = null; });
  state.agents = state.agents.filter(t => t.id !== id);
  if(state.activeAgentId === id){
    switchAgent(state.agents[0].id);
  } else {
    saveState();
    renderAgentBar();
    renderChatList();
  }
  if(typeof renderSettingsSidebar === "function") renderSettingsSidebar();
  if(typeof isSettingsOpen === "function" && isSettingsOpen()){
    if(typeof selectAgentInSettings === "function") selectAgentInSettings(state.activeAgentId);
  }
}

function deleteWorkspace(id){
  deleteAgent(id);
}

function moveChatToWorkspace(chatId, targetAgentId){
  // Move chat from current agent to target agent
  const curAgent = getCurrentAgent();
  const chatIdx = (curAgent.chats || []).findIndex(c => c.id === chatId);
  if(chatIdx < 0) return;
  const targetAgent = state.agents.find(t => t.id === targetAgentId);
  if(!targetAgent) return;
  const [chat] = curAgent.chats.splice(chatIdx, 1);
  targetAgent.chats.unshift(chat);
  if(state.activeChatId === chatId){
    state.activeChatId = curAgent.chats[0]?.id || null;
    if(!state.activeChatId) newChat();
  }
  saveState();
  renderChatList();
  renderMessages();
  updateTopBar();
}

function currentChat(){
  const agent = getCurrentAgent();
  return (agent.chats || []).find(c => c.id === state.activeChatId) || null;
}

function newChat(){
  if(isNotepadOpen()) closeNotepad();
  closeSettings();
  const id = uid();
  const curAgent = getCurrentAgent();
  const chat = {
    id,
    title: t("chat.new.default"),
    model: state.lastModel || "",
    agentId: curAgent.id,
    promptMode: "inherit",
    messages: [],
    createdAt: Date.now()
  };
  curAgent.chats.unshift(chat);
  state.activeChatId = id;
  saveState();
  renderChatList();
  renderMessages();
  updateTopBar();
  renderAgentBar();
  closeMobileSidebar();
  if(window.matchMedia && !window.matchMedia("(max-width: 768px)").matches){
    const inp = document.getElementById("input");
    if(inp) inp.focus();
  }
}
let _undoTimer = null;
function showToast(text, duration = 4000){
  const toast = document.getElementById("undoToast");
  const txt = document.getElementById("undoToastText");
  const btn = document.getElementById("undoToastBtn");
  const close = document.getElementById("undoToastClose");
  if(!toast || !txt) return;
  if(_undoTimer) clearTimeout(_undoTimer);
  txt.textContent = text;
  if(btn && btn.style) btn.style.display = "none";
  if(close) close.onclick = hideUndoToast;
  toast.classList.remove("hide");
  _undoTimer = setTimeout(hideUndoToast, duration);
}

function showDeleteUndoToast(chat){
  const toast = document.getElementById("undoToast");
  const txt = document.getElementById("undoToastText");
  const btn = document.getElementById("undoToastBtn");
  const close = document.getElementById("undoToastClose");
  if(!toast) return;
  if(_undoTimer) clearTimeout(_undoTimer);
  if(txt) txt.textContent = t("toast.chatDeleted") || "Chat moved to trash";
  if(btn && btn.style){
    btn.style.display = "";
    btn.onclick = () => {
      restoreChat(chat.id);
      hideUndoToast();
    };
  }
  if(close) close.onclick = hideUndoToast;
  toast.classList.remove("hide");
  _undoTimer = setTimeout(hideUndoToast, 6000);
}
function hideUndoToast(){
  const toast = document.getElementById("undoToast");
  if(toast) toast.classList.add("hide");
  if(_undoTimer){ clearTimeout(_undoTimer); _undoTimer = null; }
}

function deleteChat(id){
  const idx = state.chats.findIndex(c => c.id === id);
  if(idx === -1) return;
  if(isStreaming(id)){ abortStream(id); activeStreams.delete(id); }
  const [deletedChat] = state.chats.splice(idx, 1);
  deletedChat.deletedAt = Date.now();
  if(!state.trash) state.trash = [];
  state.trash.unshift(deletedChat);
  if(state.trash.length > 50) state.trash.length = 50;

  if(state.activeChatId === id){
    const wsChats = getAgentChats(state.activeAgentId);
    state.activeChatId = wsChats[0]?.id || null;
  }
  if(!state.activeChatId){
    if(hasConfiguredLLM()) newChat();
    else { createWelcomeChat(); renderChatList(); renderMessages(); updateTopBar(); }
  } else {
    saveState(); renderChatList(); renderMessages(); updateTopBar(); renderAgentBar();
  }
  showDeleteUndoToast(deletedChat);
}

function restoreChat(id){
  if(!state.trash) return;
  const idx = state.trash.findIndex(c => c.id === id);
  if(idx === -1) return;
  const [chat] = state.trash.splice(idx, 1);
  delete chat.deletedAt;
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  saveState(); renderChatList(); renderMessages(); updateTopBar();
  renderTrashList();
}

function permanentDeleteChat(id){
  if(!state.trash) return;
  state.trash = state.trash.filter(c => c.id !== id);
  saveState(); renderChatList(); renderTrashList();
}

function emptyTrash(){
  if(!state.trash || state.trash.length === 0) return;
  if(!confirm(t("trash.emptyConfirm") || "Permanently delete all items in trash?")) return;
  state.trash = [];
  saveState(); renderChatList(); renderTrashList();
}

function openTrashModal(){
  renderTrashList();
  document.getElementById("trashModal")?.classList.remove("hide");
}
function closeTrashModal(){
  document.getElementById("trashModal")?.classList.add("hide");
}

function renderTrashList(){
  const listEl = document.getElementById("trashItemsList");
  const countEl = document.getElementById("trashCountDesc");
  const emptyBtn = document.getElementById("emptyTrashBtn");
  if(!listEl) return;
  const trash = state.trash || [];
  if(emptyBtn) emptyBtn.style.display = trash.length ? "" : "none";
  if(countEl) countEl.textContent = trash.length ? `${trash.length} deleted chat${trash.length > 1 ? "s" : ""}` : (t("trash.emptyState") || "Trash is empty");
  listEl.innerHTML = "";
  if(!trash.length){
    listEl.innerHTML = `<div style="text-align:center;padding:32px 10px;color:var(--fg-3);font-size:13px">${escapeHtml(t("trash.emptyState") || "Trash is empty")}</div>`;
    return;
  }
  for(const c of trash){
    const row = document.createElement("div");
    row.className = "trash-item-row";
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;gap:10px";
    const msgCount = (c.messages || []).length;
    const delTime = c.deletedAt ? fmtMsgTimeFull(c.deletedAt) : "";
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.title || t("chat.untitled"))}</div>
        <div style="font-size:11.5px;color:var(--fg-3);margin-top:2px">${msgCount} messages · ${escapeHtml(delTime)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button type="button" class="btn ghost btn-sm act-restore" style="font-size:12px;padding:3px 8px">${escapeHtml(t("trash.restore") || "Restore")}</button>
        <button type="button" class="icon-btn act-perm-del" title="${escapeHtml(t("trash.deleteForever") || "Delete forever")}" style="width:28px;height:28px;color:var(--danger)">${icon("x", { size: 14 })}</button>
      </div>
    `;
    row.querySelector(".act-restore").onclick = () => restoreChat(c.id);
    row.querySelector(".act-perm-del").onclick = () => permanentDeleteChat(c.id);
    listEl.appendChild(row);
  }
}
function renameChat(id){
  const c = state.chats.find(x=>x.id===id); if(!c) return;
  const nv = prompt(t("prompt.renameChat"), c.title); if(nv!=null){ c.title = nv.trim()||c.title; saveState(); renderChatList(); updateTopBar(); }
}
function switchChat(id){
  if(isNotepadOpen()) closeNotepad();
  closeSettings();
  state.activeChatId = id;
  populateModelSelect();
  const c = currentChat();
  const m = c?.model || state.lastModel;
  if(m){
    const sel = document.getElementById("modelSelect");
    if(sel) sel.value = m;
  }
  saveState(); renderChatList(); renderMessages(); updateTopBar();
  syncComposerUI();
  closeMobileSidebar();
}

/* Clear the LLM context but keep visible history. Inserts a divider marker.
   For 🎬 scenario chats, folds what's about to be cut into long-term memory
   FIRST — otherwise a manual clear would silently discard everything before it
   with no chance to preserve the gist, unlike auto-compression. */
async function clearContext(){
  const chat = currentChat();
  if(!chat || !chat.messages.length) return;
  // No-op if last visible message is already a divider, or only dividers/empty since last divider
  const last = chat.messages[chat.messages.length-1];
  if(last && last.role === "divider"){
    flashStatus(t("context.empty"));
    return;
  }
  // Avoid clearing inside the welcome chat — it has no real LLM context
  if(chat.isWelcome && !hasConfiguredLLM()){
    flashStatus(t("context.empty"));
    return;
  }
  let compressed = false;
  if(chat.disableAutoMemory !== true && state.general.scenarioAutoCompress !== false){
    // If memory compression is enabled, fold what's being cleared into long-term memory first
    try{ compressed = await runCompression(chat, { keepRecent: 0, silent: true }); }
    catch{ compressed = false; }
  }
  if(!compressed){
    chat.messages.push({ role:"divider", time: Date.now() });
    saveState(); renderMessages(); updateMemoryUI();
  }
}

/* Undo a previous context-clear: remove the divider at idx */
function removeDivider(idx){
  const chat = currentChat();
  if(!chat) return;
  if(chat.messages[idx]?.role !== "divider") return;
  chat.messages.splice(idx, 1);
  saveState(); renderMessages();
}

/* Briefly flash a hint in the composer status area */
function flashStatus(text, ms=1600){
  const hint = document.getElementById("statusHint");
  if(!hint) return;
  hint.textContent = text;
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(()=>{ if(hint.textContent === text) hint.textContent = ""; }, ms);
}

