/* ------------------------- UI wiring ------------------------- */
/* setSending 已被按会话隔离的 streamStart/streamPhase/streamEnd 取代。
   保留一个仅作用于"当前激活会话"的兼容入口，供非流式路径（如旧调用）使用。 */
function setSending(on, phase){
  const id = state.activeChatId;
  if(on){
    if(activeStreams.has(id)) streamPhase(id, phase || t("status.connecting"));
    else streamStart(id, new AbortController(), phase || t("status.connecting"));
  }else{
    streamEnd(id);
  }
}
function autoresize(el){
  el.style.height="auto";
  // Honor CSS min-height so PWA standalone mode keeps a tall idle textarea
  const minH = parseFloat(getComputedStyle(el).minHeight) || 0;
  el.style.height = Math.min(240, Math.max(minH, el.scrollHeight))+"px";
}

function applyTheme(){
  const theme = state.theme === "system" || !state.theme
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : state.theme;
  const previous = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if(previous && previous !== theme && typeof reRenderAllMermaid === "function") reRenderAllMermaid();
}

/* ======================== Settings View Management ======================== */

let _settingsCurrentMode = "agent"; // "agent" | "app"
let _settingsCurrentAgentId = null;  // active agent ID in settings
let _settingsLastAgentId = null;     // remembered last selected agent ID for return
let _settingsCurrentSubtab = "overview"; // "overview" | "providers" | "instructions" | "mcp" | "welcome" | "share"
let _settingsCurrentAppTab = "general";   // "general" | "share" | "storage" | "about"

function isSettingsOpen(){
  const el = document.getElementById("settingsView");
  return el && !el.classList.contains("hide");
}

function syncCurrentAgentSettingsFromDom(agentId){
  const targetId = agentId || _settingsCurrentAgentId || state.activeAgentId;
  const curAgent = (state.agents || []).find(t => t.id === targetId) || (typeof getCurrentAgent === "function" ? getCurrentAgent() : null);
  if(!curAgent) return;
  const getEl = id => document.getElementById(id);

  if(getEl("agent_cfg_name")) curAgent.name = getEl("agent_cfg_name").value.trim() || curAgent.name;
  if(getEl("agentUserNameInput")) curAgent.userName = getEl("agentUserNameInput").value.trim();
  if(getEl("agentVersionInput")) curAgent.version = getEl("agentVersionInput").value.trim() || "1.0.0";
  const variablesInput = getEl("agentVariablesInput");
  if(variablesInput){
    try {
      const parsed = JSON.parse(variablesInput.value || "{}");
      if(!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Use a JSON object of named values.");
      const normalized = normalizeAgentVariables(parsed);
      if(Object.keys(normalized).length !== Object.keys(parsed).length) throw new Error("Use valid variable names and text, number or boolean values.");
      curAgent.variables = normalized;
      variablesInput.setCustomValidity("");
    } catch(error){ variablesInput.setCustomValidity(error.message); }
    const errorEl = getEl("agentVariablesError");
    if(errorEl){errorEl.textContent=variablesInput.validationMessage;errorEl.classList.toggle("hide",variablesInput.validity.valid);}
  }
  if(getEl("agent_cfg_author")) curAgent.author = getEl("agent_cfg_author").value.trim();
  if(getEl("agent_cfg_description")) curAgent.description = getEl("agent_cfg_description").value.trim();
  if(getEl("agent_cfg_system")) curAgent.systemPrompt = getEl("agent_cfg_system").value.trim();
  if(getEl("agent_cfg_temp")) curAgent.temperature = normalizeTemperature(getEl("agent_cfg_temp").value);
  if(getEl("agent_cfg_welcome_title")) curAgent.welcomeTitle = getEl("agent_cfg_welcome_title").value.trim();
  if(getEl("agent_cfg_welcome_desc")) curAgent.welcomeDesc = getEl("agent_cfg_welcome_desc").value.trim();
  if(typeof readWelcomePromptEditor === "function") curAgent.welcomePrompts = readWelcomePromptEditor();
  else if(getEl("agent_cfg_welcome_prompts")) curAgent.welcomePrompts = parsePromptButtons(getEl("agent_cfg_welcome_prompts").value);

  if(!curAgent.config) curAgent.config = { providers: [], mcpServers: [] };
  curAgent.config.inspectionEnabled = getEl("agent_cfg_inspection").checked;
  if(!Array.isArray(curAgent.config.providers)) curAgent.config.providers = [];

  const blocks = document.querySelectorAll("#configuredProvidersList .provider-block");
  blocks.forEach(block => {
    const id = block.dataset.providerId;
    const prov = curAgent.config.providers.find(x => x.id === id);
    if(prov){
      const enEl = block.querySelector(".pb-enabled-check");
      if(enEl) prov.enabled = enEl.checked;
      const nameEl = block.querySelector(".pb-name-input");
      if(nameEl) prov.name = nameEl.value.trim() || defaultNameForType(prov.type);
      const baseEl = block.querySelector(".pb-base-input");
      if(baseEl) prov.base = baseEl.value.trim() || defaultBaseForType(prov.type);
      const keyEl = block.querySelector(".pb-key-input");
      if(keyEl) prov.key = keyEl.value.trim();
      const headersEl = block.querySelector(".pb-headers-input");
      if(headersEl){
        const parsed = parseCustomHeaders(headersEl.value);
        prov.headers = Object.keys(parsed).length ? parsed : undefined;
      }
      setConnectionProxy(prov, readConnectionProxy(block));
      const tbody = block.querySelector(".pb-models-tbody");
      if(tbody) prov.models = getUnifiedModelsFromTable(tbody);
      if(prov.type === "ollama"){
        const protoEl = block.querySelector(".pb-ollama-protocol");
        if(protoEl) prov.protocol = protoEl.value;
      }
    }
  });

  if(typeof saveMcpServersFromDom === "function") saveMcpServersFromDom(curAgent);

  // Agent configuration within Tab package
  if(!curAgent.config.agent) curAgent.config.agent = structuredClone(state.toolSettings || {});
  const agentEnEl = document.getElementById("cfg_agent_enabled");
  if(agentEnEl) {
    curAgent.config.agent.enabled = agentEnEl.checked;
  }
  const agentTurnsEl = document.getElementById("cfg_agent_max_turns");
  if(agentTurnsEl) {
    const turns = Math.max(1, Math.min(30, Number(agentTurnsEl.value) || 10));
    curAgent.config.agent.maxTurns = turns;
  }
  if(!curAgent.config.agent.builtInTools) curAgent.config.agent.builtInTools = {};
  const dt = document.getElementById("tool_datetime_check");
  if(dt) { curAgent.config.agent.builtInTools.datetime = dt.checked; }
  const wf = document.getElementById("tool_web_fetch_check");
  if(wf) { curAgent.config.agent.builtInTools.web_fetch = wf.checked; }
  const calc = document.getElementById("tool_calculator_check");
  if(calc) { curAgent.config.agent.builtInTools.calculator = calc.checked; }
  const np = document.getElementById("tool_notepad_check");
  if(np) { curAgent.config.agent.builtInTools.notepad = np.checked; }

  if(typeof computeAgentSignature === "function") curAgent.signature = computeAgentSignature(curAgent);
}

function loadCurrentAgentSettingsToDom(agentId){
  const targetId = agentId || _settingsCurrentAgentId || state.activeAgentId;
  const curAgent = (state.agents || []).find(t => t.id === targetId) || (typeof getCurrentAgent === "function" ? getCurrentAgent() : null);
  if(!curAgent) return;
  const getEl = id => document.getElementById(id);

  getEl("agent_cfg_name").value = curAgent.name || "";
  getEl("agentUserNameInput").value = curAgent.userName || "";
  getEl("agentVersionInput").value = curAgent.version || "1.0.0";
  getEl("agentVariablesInput").value = JSON.stringify(curAgent.variables || {},null,2);
  getEl("agentVariablesInput").setCustomValidity("");
  getEl("agentVariablesError").classList.add("hide");
  if(getEl("agent_cfg_author")) getEl("agent_cfg_author").value = curAgent.author || "";
  if(getEl("agent_cfg_description")) getEl("agent_cfg_description").value = curAgent.description || "";
  if(getEl("tabPromptScopeName")) getEl("tabPromptScopeName").textContent = curAgent.name || "Current agent";
  getEl("agent_cfg_inspection").checked = curAgent.config?.inspectionEnabled !== false;
  if(getEl("agent_cfg_system")) getEl("agent_cfg_system").value = curAgent.systemPrompt || "";
  if(getEl("agent_cfg_temp")) getEl("agent_cfg_temp").value = normalizeTemperature(curAgent.temperature) ?? "";
  if(getEl("agent_cfg_welcome_title")) getEl("agent_cfg_welcome_title").value = curAgent.welcomeTitle || "";
  if(getEl("agent_cfg_welcome_desc")) getEl("agent_cfg_welcome_desc").value = curAgent.welcomeDesc || "";
  if(getEl("agent_cfg_welcome_prompts")) getEl("agent_cfg_welcome_prompts").value = (typeof formatPromptButtons === "function") ? formatPromptButtons(curAgent.welcomePrompts || []) : "";

  // Load Agent settings from curAgent
  const agentCfg = curAgent.config?.agent || state.toolSettings || {};
  const agentEnEl = getEl("cfg_agent_enabled");
  if(agentEnEl) agentEnEl.checked = agentCfg.enabled !== false;
  const agentTurnsEl = getEl("cfg_agent_max_turns");
  if(agentTurnsEl) agentTurnsEl.value = agentCfg.maxTurns || 10;
  const bt = agentCfg.builtInTools || {};
  if(getEl("tool_datetime_check")) getEl("tool_datetime_check").checked = bt.datetime !== false;
  if(getEl("tool_web_fetch_check")) getEl("tool_web_fetch_check").checked = bt.web_fetch !== false;
  if(getEl("tool_calculator_check")) getEl("tool_calculator_check").checked = bt.calculator !== false;
  if(getEl("tool_notepad_check")) getEl("tool_notepad_check").checked = (bt.notepad ?? bt.notes) !== false;

  renderConfiguredProviders();
  if(typeof renderMcpSettingsTab === "function") renderMcpSettingsTab();
  if(typeof renderShareSettingsTab === "function") renderShareSettingsTab();
  if(typeof renderWelcomePromptEditor === "function") renderWelcomePromptEditor(curAgent.welcomePrompts || []);
  updateAgentPromptPreview();
}

function syncGeneralSettingsFromDom(){
  const getEl = id => document.getElementById(id);
  if(!state.general) state.general = {};
  if(getEl("cfg_theme")) state.theme = getEl("cfg_theme").value;
  if(getEl("cfg_enable_platform_prompt")) state.general.enablePlatformPrompt = getEl("cfg_enable_platform_prompt").checked;
  if(getEl("cfg_user_name")) state.general.userName = getEl("cfg_user_name").value.trim();
  if(getEl("cfg_max_tokens")) state.general.maxTokens = getEl("cfg_max_tokens").value.trim();
  if(getEl("cfg_history_n")) state.general.historyN = Number(getEl("cfg_history_n").value) || 40;

  const cfgStr = id => { const el = getEl(id); return el ? el.value.trim() : null; };
  const ctxB = cfgStr("cfg_ctx_budget"); if(ctxB !== null) state.general.contextTokenBudget = ctxB;
  const tm = getEl("cfg_think_mode"); if(tm) state.general.thinkMode = tm.value || "auto";
  const nCtx = cfgStr("cfg_num_ctx"); if(nCtx !== null) state.general.numCtx = nCtx;
  const tp = cfgStr("cfg_top_p"); if(tp !== null) state.general.topP = tp;
  const tk = cfgStr("cfg_top_k"); if(tk !== null) state.general.topK = tk;
  const mp = cfgStr("cfg_min_p"); if(mp !== null) state.general.minP = mp;
  const pp = cfgStr("cfg_presence_penalty"); if(pp !== null) state.general.presencePenalty = pp;
  const sac = getEl("cfg_scenario_autocompress"); if(sac) state.general.scenarioAutoCompress = sac.checked;
  const scc = getEl("cfg_scenario_compress_chars"); if(scc) state.general.scenarioCompressChars = Math.max(500, Number(scc.value) || 4000);
  const smm = getEl("cfg_scenario_memory_max_chars"); if(smm) state.general.scenarioMemoryMaxChars = Math.max(200, Number(smm.value) || 800);
  const idt = getEl("cfg_image_detail"); if(idt) state.general.imageDetail = idt.value || "standard";
  const akr = getEl("cfg_attach_keep_recent"); if(akr) state.general.attachmentKeepRecent = Math.max(0, Number(akr.value) || 0);
}

function loadGeneralSettingsToDom(){
  const getEl = id => document.getElementById(id);
  const g = state.general || {};
  if(getEl("cfg_theme")) getEl("cfg_theme").value = state.theme || "system";
  if(getEl("cfg_enable_platform_prompt")) getEl("cfg_enable_platform_prompt").checked = g.enablePlatformPrompt !== false;
  if(getEl("cfg_user_name")) getEl("cfg_user_name").value = g.userName || "";
  if(getEl("cfg_max_tokens")) getEl("cfg_max_tokens").value = g.maxTokens ?? "";
  if(getEl("cfg_history_n")) getEl("cfg_history_n").value = g.historyN ?? 40;
  if(getEl("cfg_ctx_budget")) getEl("cfg_ctx_budget").value = g.contextTokenBudget ?? "";
  if(getEl("cfg_think_mode")) getEl("cfg_think_mode").value = (typeof thinkMode === "function" ? thinkMode() : g.thinkMode || "auto");
  if(getEl("cfg_num_ctx")) getEl("cfg_num_ctx").value = g.numCtx ?? "";
  if(getEl("cfg_top_p")) getEl("cfg_top_p").value = g.topP ?? "";
  if(getEl("cfg_top_k")) getEl("cfg_top_k").value = g.topK ?? "";
  if(getEl("cfg_min_p")) getEl("cfg_min_p").value = g.minP ?? "";
  if(getEl("cfg_presence_penalty")) getEl("cfg_presence_penalty").value = g.presencePenalty ?? "";
  if(getEl("cfg_scenario_autocompress")) getEl("cfg_scenario_autocompress").checked = g.scenarioAutoCompress !== false;
  if(getEl("cfg_scenario_compress_chars")) getEl("cfg_scenario_compress_chars").value = g.scenarioCompressChars || 4000;
  if(getEl("cfg_scenario_memory_max_chars")) getEl("cfg_scenario_memory_max_chars").value = g.scenarioMemoryMaxChars || 800;
  if(getEl("cfg_image_detail")) getEl("cfg_image_detail").value = g.imageDetail || "standard";
  if(getEl("cfg_attach_keep_recent")) getEl("cfg_attach_keep_recent").value = g.attachmentKeepRecent ?? 1;
}

function renderSettingsSidebar(){
  const listEl = document.getElementById("settingsNavAgentList");
  if(listEl){
    listEl.innerHTML = "";
    const agents = state.agents || [];
    const countEl = document.getElementById("settingsAgentNavCount");
    if(countEl) countEl.textContent = agents.length;

    agents.forEach(agent => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isSelected = (_settingsCurrentMode === "agent" && agent.id === _settingsCurrentAgentId);
      btn.className = "settings-nav-item settings-agent-nav-item" + (isSelected ? " active" : "");
      btn.dataset.agentId = agent.id;
      btn.title = agent.name || "Untitled agent";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", isSelected ? "true" : "false");

      const escName = (typeof escapeHtml === "function") ? escapeHtml(agent.name || "Untitled agent") : (agent.name || "Untitled agent");
      btn.innerHTML = `
        <span class="settings-nav-item-name">${escName}</span>
      `;

      btn.onclick = () => {
        selectAgentInSettings(agent.id);
        if(typeof isMobileView === "function" && isMobileView()){
          closeMobileSidebar();
        }
      };
      listEl.appendChild(btn);
    });
  }

  // Application items
  document.querySelectorAll(".settings-nav-app-list .settings-nav-item").forEach(item => {
    const isSelected = (_settingsCurrentMode === "app" && item.dataset.appTab === _settingsCurrentAppTab);
    item.classList.toggle("active", isSelected);
    item.setAttribute("aria-selected", isSelected ? "true" : "false");
  });
}

function selectAgentInSettings(agentId, section = "overview"){
  if(!flushSettingsAutosave()) return;
  const agent = (state.agents || []).find(t => t.id === agentId) || getCurrentAgent();
  _settingsCurrentMode = "agent";
  _settingsCurrentAgentId = agent.id;
  _settingsLastAgentId = agent.id;
  state.activeAgentId = agent.id;
  if(!(agent.chats || []).some(c => c.id === state.activeChatId)) state.activeChatId = agent.chats?.[0]?.id || null;
  if(typeof toolRegistry !== "undefined") toolRegistry.toolsMap.clear();
  _expandedProviderIds.clear();
  _expandedMcpIds.clear();
  loadCurrentAgentSettingsToDom(agent.id);
  const rename = document.getElementById("settingsAgentRenameBtn");
  if(rename) rename.onclick = () => openAgentModal({ mode: "edit", agentId: agent.id });
  activateSubtab(section, true);
  renderSettingsSidebar();
}

function selectAppSectionInSettings(section){
  if(section === "share"){ selectAgentInSettings(state.activeAgentId, "share"); return; }
  if(!flushSettingsAutosave()) return;
  document.getElementById("addProviderBtn").classList.add("hide");
  document.getElementById("settingsAgentActions")?.classList.add("hide");
  document.getElementById("settingsSectionBackBtn")?.classList.add("hide");
  document.getElementById("settingsBackToChatBtn")?.classList.remove("hide");

  _settingsCurrentMode = "app";
  _settingsCurrentAppTab = section || "general";

  const breadcrumb = document.getElementById("settingsBreadcrumb");
  if(breadcrumb) breadcrumb.textContent = (typeof t === "function" ? t("settings.context.app") : "Settings / Application");
  const topBreadcrumb = document.getElementById("settingsTopBreadcrumb");
  if(topBreadcrumb) topBreadcrumb.textContent = (typeof t === "function" ? t("settings.context.app") : "Settings / Application");

  const titleEl = document.getElementById("settingsMainTitle");
  const descEl = document.getElementById("settingsScopeDesc");
  const renameBtn = document.getElementById("settingsAgentRenameBtn");
  if(renameBtn) renameBtn.style.display = "none";

  // Hide Tab subnav
  const subnav = document.getElementById("settingsAgentSubnav");
  if(subnav) subnav.classList.add("hide");

  // Hide all panels, show panel for section
  document.querySelectorAll(".tab-panel").forEach(p => {
    p.style.display = (p.dataset.panel === _settingsCurrentAppTab) ? "" : "none";
  });

  if(_settingsCurrentAppTab === "general"){
    if(titleEl) titleEl.textContent = (typeof t === "function" ? t("settings.tab.general") : "General");
    if(descEl) descEl.textContent = (typeof t === "function" ? t("settings.scope.app") : "These settings apply across the entire application.");
    loadGeneralSettingsToDom();
  } else if(_settingsCurrentAppTab === "share"){
    if(titleEl) titleEl.textContent = (typeof t === "function" ? t("settings.tab.share") : "Share Link");
    if(descEl) descEl.textContent = "Generate secure, private configuration links using the URL hash (#).";
    if(typeof renderShareSettingsTab === "function") renderShareSettingsTab();
  } else if(_settingsCurrentAppTab === "storage"){
    if(titleEl) titleEl.textContent = (typeof t === "function" ? t("settings.tab.storage") : "Data & Storage");
    if(descEl) descEl.textContent = "Manage browser storage usage, export/import JSON backups, and clear trash.";
    if(typeof renderStorageSettingsTab === "function") renderStorageSettingsTab();
  } else if(_settingsCurrentAppTab === "about"){
    if(titleEl) titleEl.textContent = (typeof t === "function" ? t("settings.tab.about") : "About");
    if(descEl) descEl.textContent = "Your edition, your data, and the project.";
  }

  renderSettingsSidebar();
}

function activateSubtab(section, skipSync = false){
  if(!["overview", "providers", "instructions", "mcp", "welcome", "share"].includes(section)) section = "overview";
  if(_settingsCurrentMode !== "agent"){ selectAgentInSettings(state.activeAgentId, section); return; }
  if(!skipSync && !flushSettingsAutosave()) return;
  document.querySelector(".settings-actions-menu").open = false;
  _settingsCurrentSubtab = section;
  if(section === "share") renderShareSettingsTab();
  document.querySelectorAll("#settingsView .tab-panel").forEach(panel => {
    panel.style.display = panel.dataset.panel === section ? "" : "none";
  });
  updateSettingsOverview();
  updateSettingsSectionHeader();
  renderSettingsSidebar();
  document.getElementById("settingsBody")?.scrollTo({ top: 0 });
}

function openSettings(target){
  if(isNotepadOpen()) closeNotepad();
  if(isNotepadOpen()) return;
  document.body.classList.add("settings-mode");
  const sv = document.getElementById("settingsView");
  const cv = document.getElementById("chatView");
  const tb = document.querySelector(".top-bar");
  const sb = document.getElementById("settingsBtn");
  const chatSidebar = document.getElementById("sidebarChatContent");
  const settingsSidebar = document.getElementById("sidebarSettingsContent");

  if(sv) sv.classList.remove("hide");
  if(cv) cv.classList.add("hide");
  if(tb) tb.classList.add("hide");
  if(sb) sb.classList.add("active");
  if(chatSidebar) chatSidebar.classList.add("hide");
  if(settingsSidebar) settingsSidebar.classList.remove("hide");

  if(typeof closeMobileSidebar === "function") closeMobileSidebar();

  // Route target
  if(target){
    if(["general", "storage", "about"].includes(target)){
      selectAppSectionInSettings(target);
    } else if(["overview", "providers", "mcp", "instructions", "welcome", "share"].includes(target)){
      selectAgentInSettings(state.activeAgentId, target);
    } else if((state.agents || []).some(t => t.id === target)){
      selectAgentInSettings(target);
    } else {
      selectAgentInSettings(_settingsLastAgentId || state.activeAgentId);
    }
  } else {
    selectAgentInSettings(state.activeAgentId, "overview");
  }
}

function closeSettings(){
  if(!flushSettingsAutosave()) return;
  document.querySelector(".settings-actions-menu").open = false;
  document.body.classList.remove("settings-mode");
  const sv = document.getElementById("settingsView");
  const cv = document.getElementById("chatView");
  const tb = document.querySelector(".top-bar");
  const sb = document.getElementById("settingsBtn");
  const chatSidebar = document.getElementById("sidebarChatContent");
  const settingsSidebar = document.getElementById("sidebarSettingsContent");

  if(sv) sv.classList.add("hide");
  if(cv) cv.classList.remove("hide");
  if(tb) tb.classList.remove("hide");
  if(sb) sb.classList.remove("active");
  if(chatSidebar) chatSidebar.classList.remove("hide");
  if(settingsSidebar) settingsSidebar.classList.add("hide");

  populateModelSelect();
  if(typeof closeMobileSidebar === "function") closeMobileSidebar();
  if(typeof renderAgentBar === "function") renderAgentBar();
  if(typeof renderChatList === "function") renderChatList();
  if(typeof renderMessages === "function") renderMessages();
  if(typeof updateTopBar === "function") updateTopBar();
}
function setupInlineModelNickEditor(){
  // Deprecated: replaced by unified model picker table
}

function renderUnifiedModelTable(tbody, modelsText, countEl, selectAllHeader){
  if(!tbody) return;
  tbody.innerHTML = "";
  const entries = parseModelEntries(modelsText || "");
  entries.forEach(e => {
    addModelRowToUnifiedTable(tbody, e.model, e.nick || "", true, countEl, selectAllHeader);
  });
  updateUnifiedModelCount(tbody, countEl, selectAllHeader);
}

function addModelRowToUnifiedTable(tbody, modelId, nick = "", isChecked = true, countEl = null, selectAllHeader = null){
  if(!tbody || !modelId) return;
  const rows = tbody.querySelectorAll(".ump-row");
  for(const r of rows){
    if(r.dataset.model === modelId){
      const cb = r.querySelector(".ump-checkbox");
      if(cb){
        cb.checked = isChecked;
        r.classList.toggle("ump-unchecked", !isChecked);
      }
      const nickInp = r.querySelector(".ump-nick-input");
      if(nick && nickInp && !nickInp.value) nickInp.value = nick;
      updateUnifiedModelCount(tbody, countEl, selectAllHeader);
      return;
    }
  }

  const tr = document.createElement("tr");
  tr.className = "ump-row" + (isChecked ? "" : " ump-unchecked");
  tr.dataset.model = modelId;

  // Checkbox cell
  const tdCheck = document.createElement("td");
  tdCheck.style.textAlign = "center";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.className = "ump-checkbox";
  cb.checked = isChecked;
  cb.onchange = () => {
    tr.classList.toggle("ump-unchecked", !cb.checked);
    updateUnifiedModelCount(tbody, countEl, selectAllHeader);
  };
  tdCheck.appendChild(cb);

  // Model ID cell
  const tdId = document.createElement("td");
  tdId.className = "ump-model-id";
  tdId.textContent = modelId;
  tdId.title = modelId;

  // Display Name (Nickname) cell
  const tdNick = document.createElement("td");
  const nickInput = document.createElement("input");
  nickInput.type = "text";
  nickInput.className = "ump-nick-input";
  nickInput.placeholder = modelId;
  nickInput.value = nick;
  tdNick.appendChild(nickInput);

  // Action cell (remove)
  const tdAction = document.createElement("td");
  tdAction.style.textAlign = "center";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ump-remove-btn";
  removeBtn.title = "Remove";
  removeBtn.innerHTML = icon("x", { size: 12 });
  removeBtn.onclick = () => {
    tr.remove();
    updateUnifiedModelCount(tbody, countEl, selectAllHeader);
    tbody.dispatchEvent(new Event("change", { bubbles: true }));
  };
  tdAction.appendChild(removeBtn);

  tr.appendChild(tdCheck);
  tr.appendChild(tdId);
  tr.appendChild(tdNick);
  tr.appendChild(tdAction);

  tbody.appendChild(tr);
  updateUnifiedModelCount(tbody, countEl, selectAllHeader);
}

function updateUnifiedModelCount(tbody, countEl = null, selectAllHeader = null){
  if(!tbody) tbody = document.getElementById("pm_models_tbody");
  if(!tbody) return;
  if(!countEl){
    countEl = tbody.closest(".unified-model-picker")?.querySelector(".ump-count") || document.getElementById("pm_count");
  }
  if(!selectAllHeader){
    selectAllHeader = tbody.closest(".unified-model-picker")?.querySelector("thead input[type=checkbox]") || document.getElementById("pm_select_all_header");
  }

  const rows = [...tbody.querySelectorAll(".ump-row")];
  const total = rows.length;
  const selected = rows.filter(r => {
    const cb = r.querySelector(".ump-checkbox");
    return cb && cb.checked;
  }).length;

  if(countEl){
    countEl.textContent = `${selected} / ${total} selected`;
  }

  if(selectAllHeader){
    selectAllHeader.checked = total > 0 && selected === total;
    selectAllHeader.indeterminate = selected > 0 && selected < total;
  }
}

function getUnifiedModelsFromTable(tbody){
  if(!tbody) return "";
  const rows = tbody.querySelectorAll(".ump-row");
  const result = [];
  rows.forEach(tr => {
    const cb = tr.querySelector(".ump-checkbox");
    if(cb && cb.checked){
      const model = tr.dataset.model || "";
      const nickInp = tr.querySelector(".ump-nick-input");
      const nick = (nickInp?.value || "").trim();
      if(model){
        result.push(formatModelEntry(model, nick));
      }
    }
  });
  return result.join("\n");
}

function setupUnifiedModelPickerEvents({
  tbody,
  filterInput,
  countEl,
  selectAllHeader,
  toggleAllBtn,
  addCustomBtn,
  fetchBtn,
  getFetchParams
}){
  if(filterInput){
    filterInput.oninput = () => {
      const q = filterInput.value.trim().toLowerCase();
      tbody.querySelectorAll(".ump-row").forEach(r => {
        const modelId = (r.dataset.model || "").toLowerCase();
        const nick = (r.querySelector(".ump-nick-input")?.value || "").toLowerCase();
        const match = !q || modelId.includes(q) || nick.includes(q);
        r.style.display = match ? "" : "none";
      });
    };
  }

  if(selectAllHeader){
    selectAllHeader.onchange = () => {
      const targetState = selectAllHeader.checked;
      tbody.querySelectorAll(".ump-row").forEach(r => {
        if(r.style.display !== "none"){
          const cb = r.querySelector(".ump-checkbox");
          if(cb){
            cb.checked = targetState;
            r.classList.toggle("ump-unchecked", !targetState);
          }
        }
      });
      updateUnifiedModelCount(tbody, countEl, selectAllHeader);
      tbody.dispatchEvent(new Event("change", { bubbles: true }));
    };
  }

  if(toggleAllBtn){
    toggleAllBtn.onclick = (e) => {
      e.preventDefault();
      const visibleRows = [...tbody.querySelectorAll(".ump-row")].filter(r => r.style.display !== "none");
      const boxes = visibleRows.map(r => r.querySelector(".ump-checkbox")).filter(Boolean);
      const allChecked = boxes.length > 0 && boxes.every(cb => cb.checked);
      boxes.forEach(cb => {
        cb.checked = !allChecked;
        const row = cb.closest(".ump-row");
        if(row) row.classList.toggle("ump-unchecked", allChecked);
      });
      updateUnifiedModelCount(tbody, countEl, selectAllHeader);
      tbody.dispatchEvent(new Event("change", { bubbles: true }));
    };
  }

  if(addCustomBtn){
    addCustomBtn.onclick = (e) => {
      e.preventDefault();
      const modelId = prompt("Enter model ID (e.g. gpt-4.5-preview, my-finetune):");
      if(modelId && modelId.trim()){
        addModelRowToUnifiedTable(tbody, modelId.trim(), "", true, countEl, selectAllHeader);
        tbody.dispatchEvent(new Event("change", { bubbles: true }));
        const newRow = tbody.querySelector(`.ump-row[data-model="${CSS.escape(modelId.trim())}"]`);
        if(newRow){
          newRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
          const nickInp = newRow.querySelector(".ump-nick-input");
          if(nickInp) nickInp.focus();
        }
      }
    };
  }

  if(fetchBtn && getFetchParams){
    fetchBtn.onclick = async (e) => {
      e.preventDefault();
      const { type, base, key, headers, connection } = getFetchParams();
      const origText = fetchBtn.textContent;
      fetchBtn.disabled = true;
      fetchBtn.textContent = t("providers.fetching");
      try {
        const names = await fetchModelsForType(type, base, key, headers, connection);
        if(tbody && names.length){
          const isInitiallyEmpty = tbody.querySelectorAll(".ump-row").length === 0;
          const existingModels = new Set(Array.from(tbody.querySelectorAll(".ump-row"), row => row.dataset.model));
          names.forEach(m => {
            if(!existingModels.has(m)) addModelRowToUnifiedTable(tbody, m, "", isInitiallyEmpty, countEl, selectAllHeader);
          });
          updateUnifiedModelCount(tbody, countEl, selectAllHeader);
          if(tbody.isConnected) tbody.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch(err) {
        alert(t("alert.fetchFailed", err.message));
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = origText;
      }
    };
  }
}

const _expandedProviderIds = new Set();
const _expandedMcpIds = new Set();

function renderConfiguredProviders(){
  const container = document.getElementById("configuredProvidersList");
  const emptyState = document.getElementById("providersEmptyState");
  if(!container) return;
  container.innerHTML = "";
  const providers = getProviders();
  if(emptyState){
    emptyState.classList.toggle("hide", providers.length > 0);
  }
  providers.forEach(p => {
    container.appendChild(createProviderBlockElement(p));
  });
  refreshConnectionAccessIndicators();
}
function createProviderBlockElement(p){
  const isExpanded = _expandedProviderIds.has(p.id);
  const block = document.createElement("div");
  block.className = `provider-block${p.enabled === false ? " disabled" : ""}${isExpanded ? "" : " collapsed"}`;
  block.dataset.providerId = p.id;

  const isOllama = p.type === "ollama";
  const isLocal = isLocalProviderType(p.type);
  const typeTag = providerTypeLabel(p.type);
  const emoji = badgeEmoji(p.type);
  const modelsCount = (p.models || "").split("\n").filter(x=>x.trim()).length;

  block.innerHTML = `
    <div class="provider-header">
      <div class="provider-header-left" style="cursor:pointer" title="Click to toggle details">
        <button type="button" class="btn ghost btn-sm pb-collapse-btn" title="Toggle expand/collapse" style="padding:2px 6px;font-size:11px;margin-right:2px">
          <span class="pb-chevron">▼</span>
        </button>
        <span class="provider-badge">${emoji}</span>
        <h4 class="provider-title">${escapeHtml(p.name || defaultNameForType(p.type))}</h4>
        <span class="provider-type-tag">${escapeHtml(typeTag)}</span>
        <span class="provider-models-badge pb-models-badge">${modelsCount} ${modelsCount === 1 ? "model" : "models"}</span>
      </div>
      <div class="provider-header-actions">
        <label class="provider-toggle">
          <input type="checkbox" class="pb-enabled-check" ${p.enabled !== false ? "checked" : ""}>
          <span>${escapeHtml(t("providers.enabled"))}</span>
        </label>
        <button type="button" class="btn ghost btn-sm pb-edit-btn" title="${escapeHtml(t("providers.edit"))}">${icon("pencil", { size: 13 })}</button>
        <button type="button" class="btn ghost btn-sm pb-delete-btn" title="${escapeHtml(t("providers.delete"))}" style="color:var(--danger)">${icon("trash", { size: 13 })}</button>
      </div>
    </div>
    ${connectionAccessMarkup(p)}
    <div class="provider-fields">
      <div class="row-2">
        <div class="form-row">
          <label>${escapeHtml(t("providers.name"))}</label>
          <input class="pb-name-input" value="${escapeHtml(p.name || "")}" placeholder="${escapeHtml(defaultNameForType(p.type))}" />
        </div>
        <div class="form-row">
          <label>${escapeHtml(t("providers.baseUrl"))}</label>
          <input class="pb-base-input" type="url" inputmode="url" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" value="${escapeHtml(p.base || "")}" placeholder="${escapeHtml(defaultBaseForType(p.type))}" />
        </div>
      </div>
      <div class="form-row">
        <label>${escapeHtml(t("providers.apiKey"))}${isLocal ? ` (${escapeHtml(t("ollama.key.placeholder"))})` : ""}</label>
        <input class="pb-key-input" type="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" value="${escapeHtml(p.key || "")}" placeholder="${isLocal ? escapeHtml(t("ollama.key.placeholder")) : "sk-..."}" />
      </div>
      <div class="form-row">
        <details class="advanced-details"${(p.headers && Object.keys(parseCustomHeaders(p.headers)).length) ? " open" : ""}>
          <summary>⚙️ ${escapeHtml(t("providers.headers"))}</summary>
          <textarea class="pb-headers-input" rows="2" style="font-family:var(--font-mono);font-size:12px;margin-top:6px" placeholder="${escapeHtml(t("providers.headers.placeholder"))}">${escapeHtml(formatCustomHeaders(p.headers))}</textarea>
          <div class="hint">${escapeHtml(t("providers.headers.hint"))}</div>
        </details>
      </div>
      ${isOllama ? `
      <div class="form-row">
        <label>${escapeHtml(t("ollama.protocol"))}</label>
        <select class="pb-ollama-protocol">
          <option value="auto"${(p.protocol || "auto") === "auto" ? " selected" : ""}>${escapeHtml(t("ollama.protocol.auto"))}</option>
          <option value="ollama"${p.protocol === "ollama" ? " selected" : ""}>${escapeHtml(t("ollama.protocol.native"))}</option>
          <option value="openai"${p.protocol === "openai" ? " selected" : ""}>${escapeHtml(t("ollama.protocol.openai"))}</option>
        </select>
      </div>
      ` : ""}
      <div class="form-row" style="margin-bottom:0">
        <div class="models-header-bar" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px">
          <label style="font-weight:600;margin:0">${escapeHtml(t("providers.modelList"))}</label>
          <div style="display:flex;align-items:center;gap:6px">
            <button type="button" class="fetch-btn pb-fetch-btn">${escapeHtml(t("providers.fetch"))}</button>
            <button type="button" class="btn ghost btn-sm pb-add-custom-btn" title="Add custom model ID">＋ Add model</button>
          </div>
        </div>

        <div class="unified-model-picker pb-models-container">
          <div class="ump-toolbar">
            <input type="text" class="ump-filter pb-filter" placeholder="Search models…" />
            <div style="display:flex;align-items:center;gap:8px;font-size:12px">
              <span class="ump-count pb-count" style="color:var(--fg-2);font-family:var(--font-mono)">0 selected</span>
              <button type="button" class="btn ghost btn-sm pb-toggle-all" style="padding:3px 8px;font-size:11.5px">Toggle all</button>
            </div>
          </div>

          <div class="ump-table-wrap">
            <table class="ump-table">
              <thead>
                <tr>
                  <th style="width:36px;text-align:center">
                    <input type="checkbox" class="pb-select-all-header" />
                  </th>
                  <th>Model</th>
                  <th style="width:48%">Display name</th>
                  <th style="width:28px"></th>
                </tr>
              </thead>
              <tbody class="pb-models-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  simplifyProviderFields(block, p);
  const headerLeft = block.querySelector(".provider-header-left");
  const toggleCollapse = () => {
    const isNowCollapsed = block.classList.toggle("collapsed");
    if(isNowCollapsed) _expandedProviderIds.delete(p.id);
    else _expandedProviderIds.add(p.id);
  };
  if(headerLeft){
    headerLeft.onclick = (e) => {
      // Don't toggle if clicking a link or text input
      if(e.target.closest("input, select, textarea")) return;
      toggleCollapse();
    };
  }

  const enCheck = block.querySelector(".pb-enabled-check");
  if(enCheck){
    enCheck.onchange = (e) => {
      p.enabled = e.target.checked;
      block.classList.toggle("disabled", !p.enabled);
      settingsDraftChanged();
    };
  }

  const nameInput = block.querySelector(".pb-name-input");
  const titleEl = block.querySelector(".provider-title");
  if(nameInput && titleEl){
    nameInput.oninput = () => {
      titleEl.textContent = nameInput.value.trim() || defaultNameForType(p.type);
    };
  }

  const editBtn = block.querySelector(".pb-edit-btn");
  if(editBtn){
    editBtn.onclick = () => {
      openEditProviderModal(p.id);
    };
  }

  const deleteBtn = block.querySelector(".pb-delete-btn");
  if(deleteBtn){
    deleteBtn.onclick = () => {
      if(confirm(t("providers.confirmDelete", p.name || defaultNameForType(p.type)))){
        const idx = state.config.providers.findIndex(x => x.id === p.id);
        if(idx !== -1){
          state.config.providers.splice(idx, 1);
          renderConfiguredProviders();
          _settingsModelsChanged = true;
          settingsDraftChanged();
        }
      }
    };
  }

  const tbody = block.querySelector(".pb-models-tbody");
  const countEl = block.querySelector(".pb-count");
  const selectAllHeader = block.querySelector(".pb-select-all-header");
  const filterInput = block.querySelector(".pb-filter");
  const toggleAllBtn = block.querySelector(".pb-toggle-all");
  const addCustomBtn = block.querySelector(".pb-add-custom-btn");
  const fetchBtn = block.querySelector(".pb-fetch-btn");
  const baseInput = block.querySelector(".pb-base-input");
  const keyInput = block.querySelector(".pb-key-input");

  renderUnifiedModelTable(tbody, p.models ?? "", countEl, selectAllHeader);

  setupUnifiedModelPickerEvents({
    tbody,
    filterInput,
    countEl,
    selectAllHeader,
    toggleAllBtn,
    addCustomBtn,
    fetchBtn,
    getFetchParams: () => ({
      type: p.type,
      base: baseInput?.value.trim() || defaultBaseForType(p.type),
      key: keyInput?.value.trim() || "",
      headers: block.querySelector(".pb-headers-input")?.value.trim() || "",
      connection: p
    })
  });

  return block;
}

function updateThinkingToggle(){
  const el = document.getElementById("thinkingToggle");
  if(!el) return;
  el.classList.toggle("on", !!state.general.showThinking);
  el.setAttribute("aria-pressed", String(!!state.general.showThinking));
}

async function fetchModelsForType(type, base, key, customHeaders, connection = null){
  base = (base || defaultBaseForType(type)).trim().replace(/\/+$/,"");
  key = (key || "").trim();
  const extraHeaders = parseCustomHeaders(customHeaders);
  const request = (url, options) => connectionFetch(connection, url, options);
  if(!base) throw new Error(t("alert.baseUrlRequired"));

  if(type !== "claude" && type !== "gemini" && type !== "ollama"){
    const reqHeaders = Object.assign({}, extraHeaders);
    if(key && !reqHeaders["Authorization"]) reqHeaders["Authorization"] = "Bearer " + key;
    const candidates = [
      (base.endsWith("/v1") ? base : base + "/v1") + "/models",
      base + "/models"
    ];
    for(const u of candidates){
      try {
        const r = await request(u, {headers: reqHeaders});
        if(r.ok){
          const j = await r.json();
          if(!j?.error && (Array.isArray(j?.data) || Array.isArray(j?.models))){
            return (j.data || j.models).map(m => m.id || m.name || m.model).filter(Boolean);
          }
        }
      } catch(e) {}
    }
    const r = await request(candidates[0], {headers: reqHeaders});
    if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}: ${await r.text().catch(()=>"")}`);
    const j = await r.json();
    if(j?.error) throw new Error(typeof j.error === "string" ? j.error : (j.error.message || JSON.stringify(j.error)));
    return (j.data || j.models || []).map(m => m.id || m.name || m.model).filter(Boolean);
  }
  if(type === "claude"){
    const reqHeaders = Object.assign({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    }, extraHeaders);
    const r = await request(base+"/models", {
      headers: reqHeaders
    });
    if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}: ${await r.text().catch(()=>"")}`);
    const j = await r.json();
    return (j.data || []).map(m => m.id).filter(Boolean);
  }
  if(type === "gemini"){
    const reqHeaders = Object.assign({}, extraHeaders);
    const r = await request(`${base}/models?key=${encodeURIComponent(key)}`, { headers: reqHeaders });
    if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}: ${await r.text().catch(()=>"")}`);
    const j = await r.json();
    return (j.models || [])
      .filter(m => !(m.supportedGenerationMethods||[]).length || (m.supportedGenerationMethods||[]).some(x => /generateContent/i.test(x)))
      .map(m => (m.name || "").replace(/^models\//, ""))
      .filter(Boolean);
  }
  if(type === "ollama"){
    const reqHeaders = Object.assign({}, extraHeaders);
    if(key && !reqHeaders["Authorization"]) reqHeaders["Authorization"] = "Bearer " + key;
    const cleanBase = base.replace(/\/v\d+$/,"");
    // 1. Try Ollama native endpoint (/api/tags)
    try {
      const r = await request(cleanBase + "/api/tags", { headers: reqHeaders });
      if(r.ok){
        const j = await r.json();
        if(!j?.error && Array.isArray(j?.models)){
          return j.models.map(m => m.name || m.model).filter(Boolean);
        }
      }
    } catch(e) {}

    // 2. Try OpenAI compatible endpoint (/v1/models or /models for LM Studio / Bionic / llama.cpp)
    const openAiUrls = [
      (base.endsWith("/v1") ? base : base + "/v1") + "/models",
      cleanBase + "/models"
    ];
    for(const u of openAiUrls){
      try {
        const r = await request(u, {headers: reqHeaders});
        if(r.ok){
          const j = await r.json();
          if(!j?.error && (Array.isArray(j?.data) || Array.isArray(j?.models))){
            return (j.data || j.models).map(m => m.id || m.name || m.model).filter(Boolean);
          }
        }
      } catch(e) {}
    }

    const r = await request(cleanBase + "/api/tags", { headers: reqHeaders });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if(j?.error) throw new Error(typeof j.error === "string" ? j.error : (j.error.message || JSON.stringify(j.error)));
    return (j.models || []).map(m => m.name || m.model).filter(Boolean);
  }
  return [];
}

function renderModelPickerPanel(panel, textarea, names){
  if(!panel || !textarea) return;
  const list = panel.querySelector(".picker-list");
  const filter = panel.querySelector(".picker-filter");
  const count = panel.querySelector(".picker-count");
  const toggleAllBtn = panel.querySelector(".picker-toggle-all");
  const applyBtn = panel.querySelector(".picker-apply");
  const cancelBtn = panel.querySelector(".picker-cancel");
  const entries = parseModelEntries(textarea.value);
  const nickMap = new Map();
  entries.forEach(e => { if(e.nick) nickMap.set(e.model, e.nick); });
  const existing = new Set(entries.map(e => e.model));
  list.innerHTML = "";
  if(!names.length){
    list.innerHTML = `<div class="picker-empty">${escapeHtml(t("picker.empty"))}</div>`;
  }else{
    const sorted = [...names].sort((a,b)=>{
      const ea = existing.has(a), eb = existing.has(b);
      if(ea !== eb) return ea ? -1 : 1;
      return a.localeCompare(b);
    });
    sorted.forEach(name=>{
      const row = document.createElement("label");
      row.className = "picker-item";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = name; cb.checked = existing.has(name);
      const span = document.createElement("span"); span.textContent = name;
      row.appendChild(cb); row.appendChild(span);
      list.appendChild(row);
    });
  }
  const updateCount = ()=>{
    const total = list.querySelectorAll("input").length;
    const selected = list.querySelectorAll("input:checked").length;
    if(count) count.textContent = t("picker.count", total, selected);
  };
  updateCount();
  if(filter){
    filter.value = "";
    filter.oninput = ()=>{
      const q = filter.value.toLowerCase();
      list.querySelectorAll(".picker-item").forEach(it=>{
        it.style.display = it.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    };
  }
  list.onchange = updateCount;

  if(toggleAllBtn){
    toggleAllBtn.onclick = (e)=>{
      e.preventDefault();
      const visible = [...list.querySelectorAll(".picker-item")].filter(it => it.style.display !== "none");
      const boxes = visible.map(it => it.querySelector("input[type=checkbox]"));
      const allChecked = boxes.length > 0 && boxes.every(cb => cb.checked);
      boxes.forEach(cb => cb.checked = !allChecked);
      updateCount();
    };
  }
  if(applyBtn){
    applyBtn.onclick = (e)=>{
      e.preventDefault();
      const selected = [...list.querySelectorAll("input[type=checkbox]:checked")].map(cb => cb.value);
      if(selected.length === 0){
        if(!confirm(t("confirm.emptyPicker"))) return;
      }
      const formatted = selected.map(name => {
        const nick = nickMap.get(name);
        return formatModelEntry(name, nick);
      });
      textarea.value = formatted.join("\n");
      textarea.dispatchEvent(new Event("input"));
      panel.style.display = "none";
    };
  }
  if(cancelBtn){
    cancelBtn.onclick = (e)=>{
      e.preventDefault();
      panel.style.display = "none";
    };
  }
  panel.style.display = "";
}

function openAddProviderModal(type = "", id = ""){
  const modal = document.getElementById("providerModal");
  if(!modal) return;
  const titleEl = document.getElementById("providerModalTitle");
  if(titleEl) titleEl.textContent = type ? `Connect ${providerTypeLabel(type)}` : "Connect an AI service";

  document.getElementById("pm_id").value = id;
  document.getElementById("pm_type").value = type;
  document.getElementById("pm_type").disabled = false;
  document.getElementById("providerModalFields").classList.toggle("hide", !type);
  document.getElementById("pm_name").value = defaultNameForType(type);
  document.getElementById("pm_base").value = defaultBaseForType(type);
  document.getElementById("pm_key").value = "";

  simplifyProviderModal();
  document.getElementById("pm_connection_proxy").innerHTML = connectionProxyMarkup(null);
  syncConnectionProxyControls(document.getElementById("pm_connection_proxy"));
  const headersDetails = document.getElementById("pm_headers_details");
  if(headersDetails) headersDetails.open = false;
  const headersInp = document.getElementById("pm_headers");
  if(headersInp) headersInp.value = "";

  const filterInp = document.getElementById("pm_filter");
  if(filterInp) filterInp.value = "";
  renderUnifiedModelTable(document.getElementById("pm_models_tbody"), "");

  const ollamaFields = document.getElementById("pm_ollama_fields");
  if(ollamaFields){
    ollamaFields.style.display = type === "ollama" ? "" : "none";
    document.getElementById("pm_ollama_protocol").value = "auto";
  }

  const keyLabel = document.getElementById("pm_key_label");
  if(keyLabel){
    keyLabel.textContent = isLocalProviderType(type) ? `${t("providers.apiKey")} (${t("ollama.key.placeholder")})` : t("providers.apiKey");
  }

  modal.classList.remove("hide");
  if(type) settingsDraftChanged();
  refreshConnectionAccessIndicators();
}

function openEditProviderModal(id){
  if(!flushSettingsAutosave()) return;
  const p = state.config.providers.find(x => x.id === id);
  if(!p) return;
  const block = document.querySelector(`.provider-block[data-provider-id="${id}"]`);
  if(block){
    const nameEl = block.querySelector(".pb-name-input");
    if(nameEl && nameEl.value.trim()) p.name = nameEl.value.trim();
    const baseEl = block.querySelector(".pb-base-input");
    if(baseEl && baseEl.value.trim()) p.base = baseEl.value.trim();
    const keyEl = block.querySelector(".pb-key-input");
    if(keyEl) p.key = keyEl.value.trim();
    const headersEl = block.querySelector(".pb-headers-input");
    if(headersEl){
      const parsed = parseCustomHeaders(headersEl.value);
      p.headers = Object.keys(parsed).length ? parsed : undefined;
    }
    const tbody = block.querySelector(".pb-models-tbody");
    if(tbody) p.models = getUnifiedModelsFromTable(tbody);
    if(p.type === "ollama"){
      const protoEl = block.querySelector(".pb-ollama-protocol");
      if(protoEl) p.protocol = protoEl.value;
    }
  }

  const modal = document.getElementById("providerModal");
  if(!modal) return;
  const titleEl = document.getElementById("providerModalTitle");
  if(titleEl) titleEl.textContent = `${t("providers.modal.titleEdit")} — ${p.name || providerTypeLabel(p.type)}`;

  document.getElementById("pm_id").value = p.id;
  document.getElementById("pm_type").value = p.type;
  document.getElementById("pm_type").disabled = true;
  document.getElementById("providerModalFields").classList.remove("hide");
  document.getElementById("pm_name").value = p.name || defaultNameForType(p.type);
  document.getElementById("pm_base").value = p.base || defaultBaseForType(p.type);
  document.getElementById("pm_key").value = p.key || "";

  const headersInp = document.getElementById("pm_headers");
  simplifyProviderModal();
  document.getElementById("pm_connection_proxy").innerHTML = connectionProxyMarkup(p);
  syncConnectionProxyControls(document.getElementById("pm_connection_proxy"));
  const headersDetails = document.getElementById("pm_headers_details");
  const formattedHeaders = formatCustomHeaders(p.headers);
  if(headersInp) headersInp.value = formattedHeaders;
  if(headersDetails) headersDetails.open = !!formattedHeaders;

  const filterInp = document.getElementById("pm_filter");
  if(filterInp) filterInp.value = "";
  renderUnifiedModelTable(document.getElementById("pm_models_tbody"), p.models ?? "");

  const ollamaFields = document.getElementById("pm_ollama_fields");
  if(ollamaFields){
    ollamaFields.style.display = p.type === "ollama" ? "" : "none";
    document.getElementById("pm_ollama_protocol").value = p.protocol || "auto";
  }

  const keyLabel = document.getElementById("pm_key_label");
  if(keyLabel){
    keyLabel.textContent = isLocalProviderType(p.type) ? `${t("providers.apiKey")} (${t("ollama.key.placeholder")})` : t("providers.apiKey");
  }

  modal.classList.remove("hide");
  refreshConnectionAccessIndicators();
}

function closeProviderModal(){
  if(!flushSettingsAutosave()) return;
  const modal = document.getElementById("providerModal");
  if(modal) modal.classList.add("hide");
  renderConfiguredProviders();
}

function syncProviderModalFromDom(){
  if(document.getElementById("providerModal").classList.contains("hide")) return;
  if(!document.getElementById("pm_type").value) return;
  const id = document.getElementById("pm_id").value.trim();
  const type = document.getElementById("pm_type").value.trim() || "openai";
  const name = document.getElementById("pm_name").value.trim() || defaultNameForType(type);
  const base = document.getElementById("pm_base").value.trim() || defaultBaseForType(type);
  const key = document.getElementById("pm_key").value.trim();
  const headersInp = document.getElementById("pm_headers");
  const parsedHeaders = headersInp ? parseCustomHeaders(headersInp.value) : {};
  const customHeaders = Object.keys(parsedHeaders).length ? parsedHeaders : undefined;
  const proxy = readConnectionProxy(document.getElementById("pm_connection_proxy"));
  const models = getUnifiedModelsFromTable(document.getElementById("pm_models_tbody"));
  const isOllama = type === "ollama";
  const protocol = isOllama ? (document.getElementById("pm_ollama_protocol").value || "auto") : undefined;

  if(id){
    const prov = state.config.providers.find(x => x.id === id);
    if(prov){
      prov.type = type;
      prov.name = name;
      prov.base = base;
      prov.key = key;
      prov.headers = customHeaders;
      setConnectionProxy(prov, proxy);
      prov.models = models;
      if(isOllama){
        prov.protocol = protocol;
      }
    }
  } else {
    const newProv = {
      id: `prov_${type}_${Date.now()}`,
      type,
      name,
      enabled: true,
      base,
      key,
      ...(customHeaders ? { headers: customHeaders } : {}),
      models,
      ...(isOllama ? { protocol } : {})
    };
    setConnectionProxy(newProv, proxy);
    state.config.providers.push(newProv);
    document.getElementById("pm_id").value = newProv.id;
  }

  getCurrentAgent().signature = computeAgentSignature(getCurrentAgent());
  _settingsModelsChanged = true;
}


/* Data & Storage Tab */
function renderStorageSettingsTab(){
  let usedBytes = 0;
  try {
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      usedBytes += (k.length + v.length) * 2;
    }
  } catch(e){}

  const totalQuota = 5 * 1024 * 1024; // 5 MB typical limit
  const pct = Math.min(100, Math.max(0, (usedBytes / totalQuota) * 100));
  const formatBytes = (b) => {
    if(b < 1024) return b + " B";
    if(b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / (1024 * 1024)).toFixed(2) + " MB";
  };

  const usageText = document.getElementById("storageUsageText");
  if(usageText){
    usageText.textContent = `${formatBytes(usedBytes)} / ~5 MiB estimated limit (${pct.toFixed(1)}%)`;
  }
  const barFill = document.getElementById("storageBarFill");
  if(barFill){
    barFill.style.width = `${Math.max(2, pct)}%`;
    if(pct > 80){
      barFill.style.background = "var(--danger)";
    } else if(pct > 50){
      barFill.style.background = "#eab308";
    } else {
      barFill.style.background = "var(--accent)";
    }
  }

  const chats = (state.agents || []).flatMap(agent => agent.chats || []);
  const chatsCount = chats.length;
  const messagesCount = chats.reduce((sum, chat) => sum + (chat.messages?.length || 0), 0);
  const notesCount = (state.notes || []).length;
  const trashCount = state.trash?.length || 0;

  const elChats = document.getElementById("storageChatsCount");
  if(elChats) elChats.textContent = chatsCount;
  const elMsgs = document.getElementById("storageMessagesCount");
  if(elMsgs) elMsgs.textContent = messagesCount;
  const elNotes = document.getElementById("storageNotesCount");
  if(elNotes) elNotes.textContent = notesCount;
  const elTrash = document.getElementById("storageTrashCount");
  if(elTrash) elTrash.textContent = trashCount;
  const elTrashBtn = document.getElementById("storageTrashBtnCount");
  if(elTrashBtn) elTrashBtn.textContent = trashCount;
}

/* Chat Prompt Modal */
function openChatPromptModal(){
  const c = currentChat();
  if(!c) return;
  const modal = document.getElementById("chatPromptModal");
  const ta = document.getElementById("chatCustomPrompt");
  const chk = document.getElementById("chatEnablePromptCheck");
  if(!modal || !ta) return;
  const inherit = document.getElementById("chatInheritPromptCheck");
  if(inherit) inherit.checked = c.promptMode === "inherit";
  ta.value = agentInstructionsTemplate(c,getAgentForChat(c));
  const updateDisabled = () => { ta.disabled = !!inherit?.checked || chk?.checked === false; };
  if(inherit) inherit.onchange = updateDisabled;
  if(chk){
    chk.checked = c.enableSystemPrompt !== false;
    chk.onchange = (e) => {
      updateDisabled();
    };
    updateDisabled();
  }
  modal.classList.remove("hide");
}
function closeChatPromptModal(){
  const modal = document.getElementById("chatPromptModal");
  if(modal) modal.classList.add("hide");
}

/* Sidebar open / close */
const SIDEBAR_CLOSED_KEY = "tabschat_sidebar_closed";

function isMobileView(){
  return window.innerWidth <= 768;
}

function openMobileSidebar(){
  const s = document.getElementById("sidebar");
  const m = document.getElementById("mobileMask");
  if(s) s.classList.add("open");
  if(m) m.classList.add("show");
}

function closeMobileSidebar(){
  const s = document.getElementById("sidebar");
  const m = document.getElementById("mobileMask");
  if(s) s.classList.remove("open");
  if(m) m.classList.remove("show");
}

function openSidebar(){
  if(isMobileView()){
    openMobileSidebar();
  } else {
    document.body.classList.remove("sidebar-closed");
    try { localStorage.setItem(SIDEBAR_CLOSED_KEY, "0"); } catch(e){}
  }
}

function closeSidebar(){
  if(isMobileView()){
    closeMobileSidebar();
  } else {
    document.body.classList.add("sidebar-closed");
    try { localStorage.setItem(SIDEBAR_CLOSED_KEY, "1"); } catch(e){}
  }
}

function toggleSidebar(){
  if(isMobileView()){
    const s = document.getElementById("sidebar");
    if(s && s.classList.contains("open")){
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  } else {
    if(document.body.classList.contains("sidebar-closed")){
      openSidebar();
    } else {
      closeSidebar();
    }
  }
}

function initSidebarState(){
  try {
    if(!isMobileView() && localStorage.getItem(SIDEBAR_CLOSED_KEY) === "1"){
      document.body.classList.add("sidebar-closed");
    }
  } catch(e){}
}

/* Export / Import */
function exportData(){
  const payload = cloneStateForStorage();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tabs-chat-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file){
  const r = new FileReader();
  r.onload = () => {
    try{
      const s = JSON.parse(r.result);
      if(!s || typeof s !== "object") throw new Error("Invalid JSON file");

      // Full application archive
      if(Array.isArray(s.agents) && s.agents.length && s.schemaVersion === 1){
        let addedCount = 0;
        let lastTargetAgentId = null;
        const noteAgentIds = new Map();

        s.agents.forEach(incomingAgent => {
          normalizeAgentDefinition(incomingAgent);
          const originalAgentId = incomingAgent.id;
          if(!incomingAgent.signature) incomingAgent.signature = computeAgentSignature(incomingAgent);
          const existing = (state.agents || []).find(t => t.signature === incomingAgent.signature);
          if(existing){
            // Merge conversations when the agent already exists
            if(Array.isArray(incomingAgent.chats)){
              const existingChatIds = new Set((existing.chats || []).map(c => c.id));
              incomingAgent.chats.forEach(c => {
                c.agentId = existing.id;
                if(!existingChatIds.has(c.id)) existing.chats.push(c);
              });
            }
            noteAgentIds.set(originalAgentId, existing.id);
            lastTargetAgentId = existing.id;
          } else {
            // Add a new agent
            if(!incomingAgent.id || state.agents.some(agent => agent.id === incomingAgent.id)) incomingAgent.id = "agent_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
            normalizeAgentProviders(incomingAgent);
            normalizeAgentDefinition(incomingAgent);
            state.agents.push(incomingAgent);
            noteAgentIds.set(originalAgentId, incomingAgent.id);
            addedCount++;
            lastTargetAgentId = incomingAgent.id;
          }
        });

        mergeNoteArchive(state, (s.notes || []).map(note => ({ ...note, agentId: noteAgentIds.get(note.agentId) || (state.agents.some(agent => agent.id === note.agentId) ? note.agentId : null) })));
        if(s.general) Object.assign(state.general,s.general);
        if(s.theme) state.theme=s.theme;
        normalizeNoteArchive(state);
        if(lastTargetAgentId){
          switchAgent(lastTargetAgentId);
          if(isSettingsOpen()) selectAgentInSettings(lastTargetAgentId);
        }
        saveState();
        if(typeof showToast === "function"){
          showToast(`✨ Backup imported: ${addedCount} new agent(s) added.`);
        }
        return;
      }

      if(s.v === 1 && Array.isArray(s.agents)){
        importBundleToAgent(s);
        return;
      }

      if(Array.isArray(s.notes)){ mergeNoteArchive(state, s.notes); normalizeNoteArchive(state); saveState(); renderNotes(); return; }

      throw new Error("Unrecognized tabs.chat format");
    }catch(e){
      alert(t("alert.importFailed") + e.message);
    }
  };
  r.readAsText(file);
}

/* ------------------------- MCP Settings UI ------------------------- */
function renderMcpSettingsTab(){
  const bt = state.toolSettings?.builtInTools || {};
  const bindToolCheck = (id, key) => {
    const el = document.getElementById(id);
    if(el){
      el.checked = bt[key] !== false;
      el.onchange = (e) => {
        if(!state.toolSettings.builtInTools) state.toolSettings.builtInTools = {};
        state.toolSettings.builtInTools[key] = e.target.checked;
        settingsDraftChanged();
        renderMcpToolsViewer(document.getElementById("mcpToolsViewerList"), document.getElementById("mcpToolsCountHint"));
        updateComposerToolsButton();
      };
    }
  };
  bindToolCheck("tool_datetime_check", "datetime");
  bindToolCheck("tool_web_fetch_check", "web_fetch");
  bindToolCheck("tool_calculator_check", "calculator");
  bindToolCheck("tool_notepad_check", "notepad");

  renderMcpToolsViewer(document.getElementById("mcpToolsViewerList"), document.getElementById("mcpToolsCountHint"));
  const container = document.getElementById("mcpServersList");
  if(!container) return;
  container.innerHTML = "";
  const servers = (state.config && state.config.mcpServers) || [];

  if(!servers.length){
    container.innerHTML = `
      <p class="hint">Connect an external tool when you need one.</p>
    `;
    return;
  }

  servers.forEach(s => {
    const block = document.createElement("div");
    block.className = "provider-block" + (_expandedMcpIds.has(s.id) ? "" : " collapsed");
    block.dataset.mcpId = s.id;
    block.innerHTML = `
      <div class="provider-header">
        <button type="button" class="provider-header-left mcp-collapse-btn" aria-label="Configure ${escapeHtml(s.name || "MCP server")}" aria-expanded="${_expandedMcpIds.has(s.id)}">
          <span class="pb-chevron">▼</span><span class="provider-title">
          <span>${icon("wrench", { size: 14 })}</span>
          <span class="mcp-name-label">${escapeHtml(s.name || "MCP Server")}</span>
          </span>
        </button>
        <div class="provider-header-actions">
          <label class="provider-toggle">
            <input type="checkbox" class="mcp-enabled-check" ${s.enabled !== false ? "checked" : ""}>
            <span>Enabled</span>
          </label>
          <button type="button" class="btn ghost btn-sm mcp-delete-btn" style="color:var(--danger)">${icon("trash", { size: 13 })}</button>
        </div>
      </div>
      ${connectionAccessMarkup(s, "mcp")}
      <div class="provider-fields">
        <div class="row-2">
          <div class="form-row">
            <label>Tool name</label>
            <input class="mcp-name-input" value="${escapeHtml(s.name || "")}" placeholder="e.g. Web Tools, DB Query" />
          </div>
          <div class="form-row">
            <label>Tool link</label>
            <input class="mcp-url-input" type="url" value="${escapeHtml(s.url || "")}" placeholder="https://api.example.com/mcp" />
          </div>
        </div>
        <details class="advanced-details connection-advanced"><summary>Advanced connection settings</summary><div class="settings-advanced-body">
        ${connectionProxyMarkup(s)}
        <div class="form-row">
          <label>Access token (optional)</label>
          <input class="mcp-key-input" type="password" value="${escapeHtml(s.apiKey || "")}" placeholder="Bearer token if required" />
        </div>
        <div class="form-row">
          <details class="advanced-details"${(s.headers && Object.keys(parseCustomHeaders(s.headers)).length) ? " open" : ""}>
            <summary>Custom HTTP headers</summary>
            <textarea class="mcp-headers-input" rows="2" style="font-family:var(--font-mono);font-size:12px;margin-top:6px" placeholder="Header-Name: value (one per line or JSON)&#10;e.g. X-Project-ID: my-proj">${escapeHtml(formatCustomHeaders(s.headers))}</textarea>
            <div class="hint">Custom headers sent with JSON-RPC requests (e.g. for gateways, Cloudflare Access, or custom auth).</div>
          </details>
        </div>
        </div></details>
      </div>
    `;

    const toggle = block.querySelector(".mcp-collapse-btn");
    toggle.onclick = () => {
      const collapsed = block.classList.toggle("collapsed");
      if(collapsed) _expandedMcpIds.delete(s.id);
      else _expandedMcpIds.add(s.id);
      toggle.setAttribute("aria-expanded", String(!collapsed));
    };
    block.querySelector(".mcp-name-input").addEventListener("input", event => {
      block.querySelector(".mcp-name-label").textContent = event.target.value || "MCP Server";
    });
    const delBtn = block.querySelector(".mcp-delete-btn");
    delBtn.onclick = () => {
      state.config.mcpServers = state.config.mcpServers.filter(x => x.id !== s.id);
      _expandedMcpIds.delete(s.id);
      renderMcpSettingsTab();
      settingsDraftChanged();
    };

    container.appendChild(block);
    syncConnectionProxyControls(block);
  });
  refreshConnectionAccessIndicators();
}

function saveMcpServersFromDom(agent = getCurrentAgent()){
  const blocks = document.querySelectorAll("#mcpServersList .provider-block");
  blocks.forEach(block => {
    const id = block.dataset.mcpId;
    const server = (agent.config.mcpServers || []).find(x => x.id === id);
    if(server){
      const en = block.querySelector(".mcp-enabled-check");
      if(en) server.enabled = en.checked;
      const name = block.querySelector(".mcp-name-input");
      if(name) server.name = name.value.trim() || "MCP Server";
      const url = block.querySelector(".mcp-url-input");
      if(url) server.url = url.value.trim();
      const key = block.querySelector(".mcp-key-input");
      if(key) server.apiKey = key.value.trim();
      const headersInput = block.querySelector(".mcp-headers-input");
      if(headersInput){
        const parsed = parseCustomHeaders(headersInput.value);
        server.headers = Object.keys(parsed).length ? parsed : undefined;
      }
      setConnectionProxy(server, readConnectionProxy(block));
    }
  });
}

function setupMcpSettingsButtons(){
  const addBtn = document.getElementById("addMcpServerBtn");
  if(addBtn){
    addBtn.onclick = () => {
      if(!state.config.mcpServers) state.config.mcpServers = [];
      state.config.mcpServers.push({
        id: "mcp_" + Date.now(),
        name: "New MCP Server",
        url: "",
        apiKey: "",
        enabled: true
      });
      _expandedMcpIds.add(state.config.mcpServers.at(-1).id);
      renderMcpSettingsTab();
      settingsDraftChanged();
      document.querySelector("#mcpServersList .provider-block:last-child .mcp-name-input")?.focus();
    };
  }

  const testBtn = document.getElementById("testMcpToolsBtn");
  const statusEl = document.getElementById("mcpDiscoveryStatus");
  if(testBtn){
    testBtn.onclick = async () => {
      saveMcpServersFromDom();
      if(statusEl) statusEl.textContent = "Discovering tools...";
      testBtn.disabled = true;
      try {
        const { count, errors } = await toolRegistry.refreshTools();
        renderMcpToolsViewer(document.getElementById("mcpToolsViewerList"), document.getElementById("mcpToolsCountHint"));
        updateComposerToolsButton();
        if(errors && errors.length){
          alert(`Discovered ${count} tool(s).\nWarnings:\n` + errors.map(e => `${e.server}: ${e.error}`).join("\n"));
        } else {
          alert(`Successfully discovered ${count} tool(s) from configured MCP server(s)!`);
        }
        if(statusEl) statusEl.textContent = `${count} tool(s) ready`;
      } catch(e) {
        alert("Failed to discover tools: " + e.message);
        if(statusEl) statusEl.textContent = "Discovery failed";
      } finally {
        testBtn.disabled = false;
      }
    };
  }

  // Tools Modal in Chat View
  const toolsModalBtn = document.getElementById("toolsModalBtn");
  const toolsModal = document.getElementById("toolsModal");
  const closeToolsModalBtn = document.getElementById("closeToolsModalBtn");
  const refreshToolsModalBtn = document.getElementById("refreshToolsModalBtn");

  if(toolsModalBtn){
    toolsModalBtn.onclick = () => {
      openToolsModal();
    };
  }
  if(closeToolsModalBtn && toolsModal){
    closeToolsModalBtn.onclick = () => {
      toolsModal.classList.add("hide");
    };
    toolsModal.onclick = (e) => {
      if(e.target === toolsModal) toolsModal.classList.add("hide");
    };
  }
  if(refreshToolsModalBtn){
    refreshToolsModalBtn.onclick = async () => {
      refreshToolsModalBtn.disabled = true;
      refreshToolsModalBtn.textContent = "Refreshing...";
      try {
        await toolRegistry.refreshTools();
        renderMcpToolsViewer(document.getElementById("toolsModalList"), document.getElementById("toolsModalCountDesc"));
        updateComposerToolsButton();
      } catch(e) {
        alert("Failed to refresh tools: " + e.message);
      } finally {
        refreshToolsModalBtn.disabled = false;
        refreshToolsModalBtn.textContent = "🔄 Refresh Tools";
      }
    };
  }
}

function openToolsModal(){
  const toolsModal = document.getElementById("toolsModal");
  if(!toolsModal) return;
  toolsModal.classList.remove("hide");
  renderMcpToolsViewer(document.getElementById("toolsModalList"), document.getElementById("toolsModalCountDesc"));
}

function updateComposerToolsButton(){
  const btn = document.getElementById("toolsModalBtn");
  const label = document.getElementById("toolsBtnLabel");
  if(!btn || !label) return;
  const count = toolRegistry.getAllTools().length;
  if(count > 0 && state.toolSettings?.enabled !== false){
    btn.style.display = "inline-flex";
    label.textContent = `${count} tool${count > 1 ? "s" : ""}`;
  } else {
    btn.style.display = "none";
  }
}

function renderMcpToolsViewer(container, countEl){
  if(!container) return;
  const tools = toolRegistry.getAllTools();
  if(countEl){
    countEl.textContent = `${tools.length} tool(s) available`;
  }
  if(!tools.length){
    container.innerHTML = `
      <div style="padding:16px;text-align:center;color:var(--fg-3);font-size:13px">
        No tools currently loaded. Click "Discover &amp; Test Tools" above to scan configured MCP servers.
      </div>
    `;
    return;
  }

  container.innerHTML = tools.map(t => {
    const schemaJson = JSON.stringify(t.inputSchema || {}, null, 2);
    return `
      <div class="mcp-tool-card">
        <div class="mcp-tool-header">
          <span class="mcp-tool-name">${icon("wrench", { size: 13, extra: 'style="vertical-align:-2px;margin-right:4px"' })}${escapeHtml(t.name)}</span>
          <span class="mcp-tool-server-badge">${escapeHtml(t._serverName || "MCP")}</span>
        </div>
        <div class="mcp-tool-desc">${escapeHtml(t.description || "No description provided.")}</div>
        <details class="mcp-tool-schema-details">
          <summary>Parameters Schema (JSON)</summary>
          <pre><code>${escapeHtml(schemaJson)}</code></pre>
        </details>
      </div>
    `;
  }).join("");
}




