/* ------------------------- Init ------------------------- */
function init(){
  applyTheme();
  applyI18n();
  applyStandaloneClass();
  setupPWA();
  setupServiceWorker();
  setupPullToRefresh();
  if(state.chats.length===0){
    if(hasConfiguredLLM()) newChat();
    else createWelcomeChat();
  }
  populateModelSelect();
  renderConfiguredProviders();
  renderChatList(); renderMessages(); updateTopBar();

  document.getElementById("newChatBtn").onclick = newChat;
  document.getElementById("newScenarioBtn").onclick = newScenarioChat;
  document.getElementById("scenarioBtn").onclick = ()=>{ const c = currentChat(); if(c && c.kind==="scenario") openScenarioModal(c.id); };
  document.getElementById("closeScenario").onclick = closeScenarioModal;
  document.getElementById("cancelScenario").onclick = closeScenarioModal;
  document.getElementById("saveScenario").onclick = saveScenario;
  document.getElementById("sc_memory_restore").onclick = ()=>{
    const c = state.chats.find(x=>x.id===_editingScenarioId);
    const sel = document.getElementById("sc_memory_history");
    const h = c && (c.memoryHistory||[])[Number(sel.value)];
    if(h) document.getElementById("sc_summary").value = h.text;
  };
  document.getElementById("themeBtn").onclick = ()=>{ state.theme = state.theme==="dark"?"light":"dark"; saveState(); applyTheme(); reRenderAllMermaid(); };
  document.getElementById("reloadBtn").onclick = reloadApp;
  document.getElementById("settingsBtn").onclick = ()=>{
    if(isSettingsOpen()) closeSettings();
    else openSettings();
  };
  // Notepad
  document.getElementById("notepadBtn").onclick = ()=>{ closeMobileSidebar(); openNotepad("notes"); };
  document.getElementById("notepadBack").onclick = closeNotepad;
  document.querySelectorAll(".np-tab").forEach(b=>b.addEventListener("click", ()=>setNotepadTab(b.dataset.nptab)));
  // Attach a lightweight markdown toolbar + preview to the note composer.
  (function(){
    const bd = document.getElementById("npNoteBody");
    const preview = document.createElement("div");
    preview.className = "np-note-body np-md np-md-preview hide";
    const bar = buildMdBar(bd, preview);
    bd.parentNode.insertBefore(bar, bd);
    bd.parentNode.insertBefore(preview, bd.nextSibling);
    npNoteComposerBar = bar; npNoteComposerPreview = preview;
  })();
  document.getElementById("npNoteAdd").onclick = ()=>{
    const ti = document.getElementById("npNoteTitle");
    const bd = document.getElementById("npNoteBody");
    if(addNote({ title:ti.value, body:bd.value })){
      ti.value=""; bd.value=""; resetComposerPreview(); renderNotes(); ti.focus();
    }
  };
  const npTodoAddNow = ()=>{
    const inp = document.getElementById("npTodoInput");
    const dueEl = document.getElementById("npTodoDue");
    if(!inp.value.trim()) return;
    addTodo(inp.value, dueEl.value);
    inp.value=""; dueEl.value=""; inp.focus();
  };
  document.getElementById("npTodoAdd").onclick = npTodoAddNow;
  document.getElementById("npTodoInput").addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){ e.preventDefault(); npTodoAddNow(); }
  });
  document.getElementById("closeSettings").onclick = () => closeSettings(true);
  document.getElementById("cancelSettings").onclick = () => closeSettings(true);
  document.getElementById("saveSettings").onclick = saveSettings;
  setupMcpSettingsButtons();

  // Add provider button & modal listeners
  const addBtn = document.getElementById("addProviderBtn");
  if(addBtn){
    addBtn.onclick = () => {
      const sel = document.getElementById("newProviderTypeSelect");
      const type = sel ? sel.value : "";
      if(!type){
        if(sel) sel.focus();
        return;
      }
      openAddProviderModal(type);
    };
  }
  const closePmBtn = document.getElementById("closeProviderModal");
  if(closePmBtn) closePmBtn.onclick = closeProviderModal;
  const cancelPmBtn = document.getElementById("cancelProviderModal");
  if(cancelPmBtn) cancelPmBtn.onclick = closeProviderModal;
  const savePmBtn = document.getElementById("saveProviderModal");
  if(savePmBtn) savePmBtn.onclick = saveProviderModal;

  const pmFetchBtn = document.getElementById("pm_fetch_btn");
  if(pmFetchBtn){
    pmFetchBtn.onclick = async (e) => {
      e.preventDefault();
      const type = document.getElementById("pm_type").value.trim() || "openai";
      const base = document.getElementById("pm_base").value.trim() || defaultBaseForType(type);
      const key = document.getElementById("pm_key").value.trim();
      const origText = pmFetchBtn.textContent;
      pmFetchBtn.disabled = true;
      pmFetchBtn.textContent = t("providers.fetching");
      try {
        const names = await fetchModelsForType(type, base, key);
        const picker = document.getElementById("pm_picker");
        const modelsTextarea = document.getElementById("pm_models");
        renderModelPickerPanel(picker, modelsTextarea, names);
      } catch(err) {
        alert(t("alert.fetchFailed", err.message));
      } finally {
        pmFetchBtn.disabled = false;
        pmFetchBtn.textContent = origText;
      }
    };
  }
  document.getElementById("exportBtn").onclick = exportData;
  document.getElementById("importBtn").onclick = ()=>document.getElementById("importFileInput").click();
  document.getElementById("importFileInput").onchange = (e)=>{ const f = e.target.files[0]; if(f) importData(f); e.target.value=""; };
  document.getElementById("clearBtn").onclick = ()=>{
    const c = currentChat(); if(!c) return;
    if(confirm(t("confirm.clearChat"))){ c.messages=[]; saveState(); renderMessages(); }
  };
  document.getElementById("clearCtxBtn").onclick = ()=>clearContext();
  document.getElementById("menuBtn").onclick = openMobileSidebar;
  document.getElementById("mobileMask").onclick = closeMobileSidebar;
  updateThinkingToggle();
  document.getElementById("thinkingToggle").onclick = (e)=>{
    e.preventDefault(); e.stopPropagation();
    state.general.showThinking = !state.general.showThinking;
    saveState(); updateThinkingToggle();
    renderMessages(); // 让已存在的思考面板跟随显隐
    // 短暂提示：清掉上一个未完成的定时器，恢复时用规范文案（避免竞态残留旧文本）
    const el = document.getElementById("thinkingToggle");
    const label = el.querySelector("span:last-child");
    if(el._thinkTimer) clearTimeout(el._thinkTimer);
    label.textContent = state.general.showThinking ? t("thinking.toggle.on") : t("thinking.toggle.off");
    el._thinkTimer = setTimeout(()=>{ label.textContent = t("thinking.label"); el._thinkTimer = null; }, 1200);
  };

  document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    t.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach(p=>p.style.display = (p.dataset.panel===t.dataset.tab)?"":"none");
    if(t.dataset.tab === "models"){
      renderModelsSettingsTab();
    } else if(t.dataset.tab === "mcp"){
      renderMcpSettingsTab();
    }
  }));

  const ta = document.getElementById("input");
  ta.addEventListener("input",()=>autoresize(ta));
  ta.addEventListener("keydown",(e)=>{
    if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); sendMessage(); }
  });
  ta.addEventListener("paste",async(e)=>{
    const items = e.clipboardData?.items||[];
    const files = [];
    for(const it of items){ if(it.kind==="file"){ const f=it.getAsFile(); if(f) files.push(f); } }
    if(files.length){ e.preventDefault(); await handleFiles(files); }
  });

  document.getElementById("sendBtn").onclick = sendMessage;
  document.getElementById("attachImageBtn").onclick = ()=>{
    const i = document.getElementById("fileInput"); i.accept="image/*"; i.click();
  };
  document.getElementById("attachFileBtn").onclick = ()=>{
    const i = document.getElementById("fileInput"); i.accept=""; i.click();
  };
  document.getElementById("fileInput").onchange = async (e)=>{
    await handleFiles(e.target.files); e.target.value="";
  };

  document.getElementById("modelSelect").addEventListener("change",(e)=>{
    const c = currentChat();
    if(c){ c.model = e.target.value; }
    state.lastModel = e.target.value;
    syncSelectedModelName(e.target.value);
    saveState();
    renderMessages();
  });

  // Call Inspector Drawer
  const rClose = document.getElementById("rawCallClose");
  if(rClose) rClose.onclick = closeRawCallDrawer;
  const rMask = document.getElementById("rawCallMask");
  if(rMask) rMask.onclick = closeRawCallDrawer;
  document.querySelectorAll(".drawer-tab").forEach(tab => {
    tab.onclick = () => switchRawCallTab(tab.getAttribute("data-dtab"));
  });
  const rCopy = document.getElementById("rawCallCopyAll");
  if(rCopy){
    rCopy.onclick = () => {
      if(!_activeRawCall) return;
      navigator.clipboard.writeText(JSON.stringify(_activeRawCall, null, 2));
      const orig = rCopy.textContent;
      rCopy.textContent = t("msg.copied") || "Copied!";
      setTimeout(() => { rCopy.textContent = orig; }, 1200);
    };
  }

  // 用户滚动 → 切换 stickToBottom；程序触发的滚动不算
  const scrollEl = document.getElementById("chatView");
  scrollEl.addEventListener("scroll", ()=>{
    if(_scrollProgrammatic > 0){ _scrollProgrammatic--; return; }
    const near = isNearBottom(scrollEl);
    if(near !== stickToBottom){
      stickToBottom = near;
      updateScrollBtn();
    }
  }, {passive:true});
  // 鼠标滚轮 / 触摸拖动 / 键盘翻页 → 视为离开底部（即时响应，不等 scroll 事件）
  scrollEl.addEventListener("wheel",(e)=>{
    if(e.deltaY < 0 && stickToBottom){ stickToBottom = false; updateScrollBtn(); }
  }, {passive:true});
  scrollEl.addEventListener("touchmove", ()=>{
    if(stickToBottom && !isNearBottom(scrollEl)){ stickToBottom = false; updateScrollBtn(); }
  }, {passive:true});
  document.getElementById("scrollBottomBtn").addEventListener("click", ()=>scrollToBottom(true));

  // Drag & drop
  let dragCount = 0;
  window.addEventListener("dragenter",(e)=>{ if(e.dataTransfer?.types?.includes("Files")){ dragCount++; document.getElementById("dragOverlay").classList.remove("hide"); }});
  window.addEventListener("dragleave",()=>{ dragCount--; if(dragCount<=0){ dragCount=0; document.getElementById("dragOverlay").classList.add("hide"); }});
  window.addEventListener("dragover",(e)=>{ if(e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
  window.addEventListener("drop",async(e)=>{
    if(e.dataTransfer?.files?.length){ e.preventDefault(); dragCount=0; document.getElementById("dragOverlay").classList.add("hide"); await handleFiles(e.dataTransfer.files); }
  });

  // Trash Modal
  const cTrash = document.getElementById("closeTrashBtn");
  if(cTrash) cTrash.onclick = closeTrashModal;
  const eTrash = document.getElementById("emptyTrashBtn");
  if(eTrash) eTrash.onclick = emptyTrash;
  const tMask = document.getElementById("trashModal");
  if(tMask) tMask.onclick = (e)=>{ if(e.target === tMask) closeTrashModal(); };

  // Esc to close Settings / Notepad / Raw Call Drawer / Trash Modal
  window.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){
      const tm = document.getElementById("trashModal");
      if(tm && !tm.classList.contains("hide")){
        closeTrashModal();
        return;
      }
      const rcd = document.getElementById("rawCallDrawer");
      if(rcd && !rcd.classList.contains("hide")){
        closeRawCallDrawer();
        return;
      }
      if(isSettingsOpen()){
        closeSettings();
        return;
      }
      if(isNotepadOpen()){
        // don't hijack Esc while inline-editing a note/todo
        const tag = (e.target.tagName||"").toLowerCase();
        const inline = (tag==="textarea" && e.target.classList.contains("np-edit")) ||
                       (tag==="input" && e.target.closest(".np-todo"));
        if(!inline){ closeNotepad(); }
      }
    }
  });

  // Keyboard
  window.addEventListener("keydown",(e)=>{
    const mod = e.ctrlKey || e.metaKey;
    if(!mod || e.altKey) return;
    const k = (e.key||"").toLowerCase();
    if(!e.shiftKey){
      // Cmd/Ctrl+N is OS-intercepted in most browsers; left as a best-effort
      // for standalone PWAs / Electron-like hosts that don't reserve it.
      if(k==="n"){ e.preventDefault(); newChat(); return; }
      if(k==="k"){ e.preventDefault(); clearContext(); return; }
    } else {
      // Browser-safe alternative for new chat
      if(k==="o"){ e.preventDefault(); newChat(); return; }
    }
  });

  // Initialize tools button & discovery if servers are already saved
  if(state.agent?.enabled && (state.config.mcpServers || []).some(s => s.enabled !== false && s.url)){
    toolRegistry.refreshTools().then(() => {
      updateComposerToolsButton();
    }).catch(()=>{});
  }

  // Page is fully wired up — snap the top progress bar to 100% and fade it out
  finishPageLoader();
}

document.addEventListener("DOMContentLoaded", init);

