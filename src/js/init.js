/* ------------------------- Init ------------------------- */
function init(){
  applyTheme();
  applyI18n();
  setupSettingsLayout();
  setupWorkspace();
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
  renderAgentBar();
  renderChatList(); renderMessages(); updateTopBar();
  if(typeof initConfigShareWiring === "function") initConfigShareWiring();
  if(typeof checkHashForConfigImport === "function") checkHashForConfigImport();

  document.getElementById("newChatBtn").onclick = newChat;
  const agentBtn = document.getElementById("agentBtn");
  if(agentBtn) agentBtn.onclick = (e)=>{
    e.stopPropagation();
    const dd = document.getElementById("agentDropdown");
    if(dd) dd.classList.toggle("hide");
  };
  const agentAddBtn = document.getElementById("agentAddBtn");
  if(agentAddBtn) agentAddBtn.onclick = (e)=>{
    e.stopPropagation();
    if(typeof openAgentModal === "function") openAgentModal({ mode: "create" });
  };
  const closeAgentBtn = document.getElementById("closeAgentModalBtn");
  if(closeAgentBtn) closeAgentBtn.onclick = closeAgentModal;
  const cancelAgentBtn = document.getElementById("cancelAgentModalBtn");
  if(cancelAgentBtn) cancelAgentBtn.onclick = closeAgentModal;
  const saveAgentBtn = document.getElementById("saveAgentModalBtn");
  if(saveAgentBtn) saveAgentBtn.onclick = saveAgentModal;
  const agentModalEl = document.getElementById("agentModal");
  agentModalEl.addEventListener("input", agentModalChanged);
  agentModalEl.addEventListener("change", agentModalChanged);
  if(agentModalEl) agentModalEl.onclick = (e) => { if(e.target === agentModalEl) closeAgentModal(); };
  const agentNameInp = document.getElementById("agentModalNameInput");
  if(agentNameInp) agentNameInp.onkeydown = (e) => {
    if(e.key === "Enter"){
      e.preventDefault();
      saveAgentModal();
    }
  };
  document.addEventListener("click", (e)=>{
    if(!e.target.closest(".sidebar-agent-wrap")){
      document.getElementById("agentDropdown")?.classList.add("hide");
    }
  });
  document.getElementById("chatList")?.addEventListener("scroll", ()=>{
    if(typeof closeChatMenu === "function") closeChatMenu();
  }, { passive: true });
  document.getElementById("memoryBtn").onclick = ()=>{ const c = currentChat(); if(c) openMemoryModal(c.id); };
  document.getElementById("closeMemoryModal").onclick = closeMemoryModal;
  document.getElementById("cancelMemoryModal").onclick = closeMemoryModal;
  document.getElementById("saveMemoryBtn").onclick = saveMemory;
  document.getElementById("compressNowBtn").onclick = async ()=>{
    const c = currentChat();
    if(!c) return;
    await runCompression(c, { keepRecent: 4 });
  };
  document.getElementById("mem_history_restore").onclick = ()=>{
    const c = state.chats.find(x=>x.id===_editingMemoryChatId);
    const sel = document.getElementById("mem_history_select");
    const h = c && (c.memoryHistory||[])[Number(sel.value)];
    if(h){
      const sumEl = document.getElementById("mem_summary");
      if(sumEl){ sumEl.value = h.text; updateMemCharCount(); }
    }
  };
  const sumInput = document.getElementById("mem_summary");
  if(sumInput) sumInput.oninput = updateMemCharCount;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if(state.theme === "system") applyTheme(); });
  initSidebarState();
  document.getElementById("reloadBtn").onclick = reloadApp;
  document.getElementById("settingsBtn").onclick = ()=>{
    if(isSettingsOpen()) closeSettings();
    else openSettings();
  };
  // Notepad
  const npBtn = document.getElementById("notepadBtn");
  if(npBtn) npBtn.onclick = ()=>{ closeMobileSidebar(); openNotepad(); };
  document.getElementById("npFilter").onchange = renderNotes;
  // Attach a lightweight markdown toolbar + preview to the note composer.
  (function(){
    const bd = document.getElementById("npNoteBody");
    if(!bd) return;
    const preview = document.createElement("div");
    preview.className = "np-note-body np-md np-md-preview hide";
    const bar = buildMdBar(bd, preview);
    bd.parentNode.insertBefore(bar, bd);
    bd.parentNode.insertBefore(preview, bd.nextSibling);
    npNoteComposerBar = bar; npNoteComposerPreview = preview;
  })();
  const backBtn = document.getElementById("settingsBackToChatBtn");
  if(backBtn) backBtn.onclick = () => closeSettings();
  const topbarBackBtn = document.getElementById("settingsTopbarBackBtn");
  if(topbarBackBtn) topbarBackBtn.onclick = () => closeSettings();
  const sidebarOpenBtn = document.getElementById("settingsSidebarOpenBtn");
  if(sidebarOpenBtn) sidebarOpenBtn.onclick = () => openMobileSidebar();
  const sidebarCloseSettingsBtn = document.getElementById("sidebarSettingsCloseBtn");
  if(sidebarCloseSettingsBtn) sidebarCloseSettingsBtn.onclick = () => closeMobileSidebar();
  const newAgentBtn = document.getElementById("settingsNavNewAgentBtn");
  if(newAgentBtn) newAgentBtn.onclick = () => {
    if(typeof openAgentModal === "function") openAgentModal({ mode: "create" });
  };
  setupMcpSettingsButtons();

  // Add provider button & modal listeners
  const addBtn = document.getElementById("addProviderBtn");
  if(addBtn) addBtn.onclick = () => { flushSettingsAutosave(); openAddProviderModal(); };
  document.getElementById("pm_type").onchange = () => {
    const id = document.getElementById("pm_id").value;
    const type = document.getElementById("pm_type").value;
    openAddProviderModal(type, id);
  };
  const closePmBtn = document.getElementById("closeProviderModal");
  if(closePmBtn) closePmBtn.onclick = closeProviderModal;
  const providerMask = document.getElementById("providerModal");
  providerMask.onclick = event => { if(event.target === providerMask) closeProviderModal(); };

  const pmContainer = document.getElementById("pm_models_container");
  if(pmContainer){
    setupUnifiedModelPickerEvents({
      tbody: document.getElementById("pm_models_tbody"),
      filterInput: document.getElementById("pm_filter"),
      countEl: document.getElementById("pm_count"),
      selectAllHeader: document.getElementById("pm_select_all_header"),
      toggleAllBtn: document.getElementById("pm_toggle_all"),
      addCustomBtn: document.getElementById("pm_add_custom_btn"),
      fetchBtn: document.getElementById("pm_fetch_btn"),
      getFetchParams: () => {
        const type = document.getElementById("pm_type").value.trim() || "openai";
        const base = document.getElementById("pm_base").value.trim() || defaultBaseForType(type);
        const key = document.getElementById("pm_key").value.trim();
        const headers = document.getElementById("pm_headers")?.value.trim() || "";
        syncProviderModalFromDom();
        const connection = getProvider(document.getElementById("pm_id").value);
        return { type, base, key, headers, connection };
      }
    });
  }
  const expBtn = document.getElementById("exportBtn");
  if(expBtn) expBtn.onclick = exportData;
  const impBtn = document.getElementById("importBtn");
  if(impBtn) impBtn.onclick = ()=>document.getElementById("importFileInput").click();
  const stExpBtn = document.getElementById("storageExportBtn");
  if(stExpBtn) stExpBtn.onclick = exportData;
  const stImpBtn = document.getElementById("storageImportBtn");
  if(stImpBtn) stImpBtn.onclick = ()=>document.getElementById("importFileInput").click();
  const stEmptyTrashBtn = document.getElementById("storageEmptyTrashBtn");
  if(stEmptyTrashBtn){
    stEmptyTrashBtn.onclick = ()=>{
      if(!state.trash || !state.trash.length) return;
      if(confirm("Permanently empty all items in trash?")){
        state.trash = [];
        saveState();
        renderStorageSettingsTab();
      }
    };
  }
  document.getElementById("importFileInput").onchange = (e)=>{ const f = e.target.files[0]; if(f) importData(f); e.target.value=""; };

  const chatPromptBtn = document.getElementById("chatPromptBtn");
  if(chatPromptBtn) chatPromptBtn.onclick = openChatPromptModal;
  const closeChatPromptBtn = document.getElementById("closeChatPromptModal");
  if(closeChatPromptBtn) closeChatPromptBtn.onclick = closeChatPromptModal;
  const cancelChatPromptBtn = document.getElementById("cancelChatPromptBtn");
  if(cancelChatPromptBtn) cancelChatPromptBtn.onclick = closeChatPromptModal;
  const resetChatPromptBtn = document.getElementById("resetChatPromptToDefaultBtn");
  if(resetChatPromptBtn){
    resetChatPromptBtn.onclick = ()=>{
      const ta = document.getElementById("chatCustomPrompt");
      if(ta){ ta.value = getAgentForChat(currentChat()).systemPrompt || ""; ta.disabled = true; }
      document.getElementById("chatInheritPromptCheck").checked = true;
    };
  }
  const saveChatPromptBtn = document.getElementById("saveChatPromptBtn");
  if(saveChatPromptBtn){
    saveChatPromptBtn.onclick = ()=>{
      const c = currentChat();
      if(c){
        const ta = document.getElementById("chatCustomPrompt");
        const chk = document.getElementById("chatEnablePromptCheck");
        const inherit = document.getElementById("chatInheritPromptCheck")?.checked;
        c.promptMode = inherit ? "inherit" : "override";
        if(inherit) delete c.systemPrompt;
        else if(ta) c.systemPrompt = ta.value;
        if(chk) c.enableSystemPrompt = chk.checked;
        saveState();
      }
      closeChatPromptModal();
    };
  }

  const openSidebarBtn = document.getElementById("sidebarOpenBtn") || document.getElementById("menuBtn");
  if(openSidebarBtn) openSidebarBtn.onclick = openSidebar;
  const closeSidebarBtn = document.getElementById("sidebarCloseBtn");
  if(closeSidebarBtn) closeSidebarBtn.onclick = closeSidebar;
  const mobileMask = document.getElementById("mobileMask");
  if(mobileMask) mobileMask.onclick = closeMobileSidebar;
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

  // Settings Navigation: Application items
  document.querySelectorAll(".settings-nav-app-list .settings-nav-item").forEach(item => {
    item.addEventListener("click", () => {
      const appTab = item.dataset.appTab;
      if(typeof selectAppSectionInSettings === "function"){
        selectAppSectionInSettings(appTab);
        if(typeof isMobileView === "function" && isMobileView()){
          closeMobileSidebar();
        }
      }
    });
  });

  // Settings Navigation: Sub-tabs (Providers & Models, Agent & MCP Tools, Prompt & Welcome)
  document.querySelectorAll(".settings-subnav .subnav-item").forEach(item => {
    item.addEventListener("click", () => {
      const subtab = item.dataset.subtab;
      if(typeof activateSubtab === "function") activateSubtab(subtab);
    });
  });

  const ta = document.getElementById("input");
  ta.addEventListener("input",()=>autoresize(ta));
  ta.addEventListener("keydown",(e)=>{
    if(handleNoteMentionKeydown(e)) return;
    if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); sendMessage(); }
  });
  ta.addEventListener("paste",async(e)=>{
    const items = e.clipboardData?.items||[];
    const files = [];
    for(const it of items){ if(it.kind==="file"){ const f=it.getAsFile(); if(f) files.push(f); } }
    if(files.length){ e.preventDefault(); await handleFiles(files); }
  });

  document.getElementById("sendBtn").onclick = sendMessage;
  const micBtn = document.getElementById("micBtn");
  if(micBtn){
    micBtn.onclick = toggleVoiceInput;
  }
  const attachBtn = document.getElementById("attachBtn");
  if(attachBtn){
    attachBtn.onclick = ()=>{
      const i = document.getElementById("fileInput");
      if(i){ i.accept = attachmentAccept(); i.click(); }
    };
  }
  document.getElementById("fileInput").onchange = async (e)=>{
    await handleFiles(e.target.files); e.target.value="";
  };

  document.getElementById("modelSelect").addEventListener("change",(e)=>{
    const c = currentChat();
    if(c){ c.model = e.target.value; }
    state.lastModel = e.target.value;
    saveState();
    renderMessages();
  });
  document.getElementById("modelSelect").addEventListener("click",()=>{
    if(!hasConfiguredLLM()){
      openSettings("providers");
    }
  });

  // Call Inspector Drawer
  const rClose = document.getElementById("rawCallClose");
  if(rClose) rClose.onclick = closeRawCallDrawer;
  const rMask = document.getElementById("rawCallMask");
  if(rMask) rMask.onclick = closeRawCallDrawer;
  document.querySelectorAll(".drawer-tab").forEach(tab => {
    tab.onclick = () => switchRawCallTab(tab.getAttribute("data-dtab"));
    tab.onkeydown = event => {
      if(!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll(".drawer-tab")];
      const next = tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      next.click(); next.focus();
    };
  });
  document.getElementById("rawCallDrawer").addEventListener("keydown", event => {
    if(event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), [tabindex="0"]')].filter(item => item.checkVisibility());
    const edge = event.shiftKey ? focusable[0] : focusable.at(-1);
    if(document.activeElement === edge){ event.preventDefault(); (event.shiftKey ? focusable.at(-1) : focusable[0]).focus(); }
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

  // Esc to close Settings / Notepad / Raw Call Drawer / Trash Modal / Tab Modal
  window.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){
      if(!document.getElementById("workspaceSearchModal").classList.contains("hide")){ closeWorkspaceSearch(); return; }
      if(!document.getElementById("providerModal").classList.contains("hide")){ closeProviderModal(); return; }
      const agentM = document.getElementById("agentModal");
      if(agentM && !agentM.classList.contains("hide")){
        closeAgentModal();
        return;
      }
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
        // don't hijack Esc while inline-editing a note
        const tag = (e.target.tagName||"").toLowerCase();
        const inline = (tag==="textarea" && e.target.classList.contains("np-edit"));
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
      if(k==="n" || k==="o"){ e.preventDefault(); newChat(); return; }
      if(k==="b"){ e.preventDefault(); toggleSidebar(); return; }
    } else {
      // Browser-safe alternative for new chat
      if(k==="o"){ e.preventDefault(); newChat(); return; }
    }
  });

  // Initialize tools button & discovery if servers are already saved
  if(state.toolSettings?.enabled && (state.config.mcpServers || []).some(s => s.enabled !== false && s.url)){
    toolRegistry.refreshTools().then(() => {
      updateComposerToolsButton();
    }).catch(()=>{});
  }

  // Page is fully wired up — snap the top progress bar to 100% and fade it out
  finishPageLoader();
}

if (document.readyState === 'loading') document.addEventListener("DOMContentLoaded", init);
else init();

