/* ------------------------- Chat helpers ------------------------- */
function uid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }

function currentChat(){
  return state.chats.find(c=>c.id===state.activeChatId) || null;
}
function newChat(){
  closeSettings();
  const id = uid();
  const chat = {
    id, title:t("chat.new.default"), model: state.lastModel || "",
    systemPrompt: state.general.systemPrompt,
    messages: [], createdAt: Date.now()
  };
  state.chats.unshift(chat);
  state.activeChatId = id;
  saveState(); renderChatList(); renderMessages(); updateTopBar();
  closeMobileSidebar();
  // Avoid focus on mobile — focus triggers iOS keyboard immediately
  if(window.matchMedia && !window.matchMedia("(max-width: 768px)").matches){
    document.getElementById("input").focus();
  }
}
let _undoTimer = null;
function showDeleteUndoToast(chat){
  const toast = document.getElementById("undoToast");
  const txt = document.getElementById("undoToastText");
  const btn = document.getElementById("undoToastBtn");
  const close = document.getElementById("undoToastClose");
  if(!toast) return;
  if(_undoTimer) clearTimeout(_undoTimer);
  if(txt) txt.textContent = t("toast.chatDeleted") || "Chat moved to trash";
  if(btn){
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

  if(state.activeChatId === id) state.activeChatId = state.chats[0]?.id || null;
  if(!state.activeChatId){
    if(hasConfiguredLLM()) newChat();
    else { createWelcomeChat(); renderChatList(); renderMessages(); updateTopBar(); }
  } else {
    saveState(); renderChatList(); renderMessages(); updateTopBar();
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
        <button type="button" class="icon-btn act-perm-del" title="${escapeHtml(t("trash.deleteForever") || "Delete forever")}" style="width:28px;height:28px;color:var(--danger)"><svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
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
  closeSettings();
  state.activeChatId = id;
  const c = currentChat();
  const m = c?.model || state.lastModel;
  if(m){
    syncSelectedModelName(m);
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
  if(chat.kind === "scenario"){
    // Silent: falls back to a plain clear below if there's nothing worth
    // compressing, no model is configured, or the compression call fails.
    try{ compressed = await runCompression(chat, { keepRecent: 0, silent: true }); }
    catch{ compressed = false; }
  }
  if(!compressed){
    chat.messages.push({ role:"divider", time: Date.now() });
    saveState(); renderMessages();
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

