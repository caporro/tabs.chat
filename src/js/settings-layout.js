/* Simple settings navigation and debounced local persistence. */
function updateAgentPromptPreview(){
  const agent = state.agents.find(item=>item.id===_settingsCurrentAgentId) || getCurrentAgent();
  const chat = {agentId:agent.id,promptMode:"inherit",model:document.getElementById("modelSelect")?.value || agent.chats?.[0]?.model || state.lastModel || ""};
  const context = createPromptContext(chat,{agent});
  const select = document.getElementById("agentPromptVariableSelect");
  const keys = Object.keys(context.values);
  if(select.dataset.keys !== JSON.stringify(keys)){
    select.replaceChildren(new Option("Choose a variable…",""),...keys.map(key=>new Option(`{{${key}}}`,key)));
    select.dataset.keys=JSON.stringify(keys);
  }
  const result = resolvePromptTemplate(agent.systemPrompt,context.values);
  const error = document.getElementById("agentPromptError");
  error.textContent = result.unknown.length ? `Unknown variables: ${result.unknown.join(", ")}. Correct them before sending, or prefix {{ with a backslash for literal text.` : "";
  error.classList.toggle("hide",!result.unknown.length);
  const preview = document.getElementById("agentPromptPreview");
  try { preview.textContent=effectiveSystemPrompt(chat); }
  catch(error){ preview.textContent=error.message; }
}

function updateSettingsOverview(){
  const agent = getCurrentAgent();
  const providers = (agent.config.providers || []).filter(p => p.enabled !== false);
  const ai = document.getElementById("settingsAiSummary");
  if(ai) ai.textContent = providers.length ? providers.map(p => p.name || defaultNameForType(p.type)).join(" · ") : "Choose a service";
  const names = { calculator: "Calculations", datetime: "Date and time", notepad: "Notes", web_fetch: "Web pages" };
  const enabled = Object.entries(names).filter(([key]) => state.toolSettings.builtInTools?.[key] !== false).map(([,name]) => name);
  enabled.push(...(agent.config.mcpServers || []).filter(s => s.enabled !== false && s.url).map(s => s.name || "Connected tool"));
  const tools = document.getElementById("settingsToolsSummary");
  if(tools) tools.textContent = state.toolSettings.enabled === false ? "Tools are off" : enabled.join(", ") || "No tools enabled";
}

function updateSettingsSectionHeader(){
  if(_settingsCurrentMode !== "agent") return;
  const agent = getCurrentAgent();
  const section = _settingsCurrentSubtab;
  const headings = { providers: "AI services", instructions: "Instructions", mcp: "Tools", welcome: "Welcome screen", share: `Share ${agent.name}` };
  const descriptions = { overview: "Changes apply only to this agent.", providers: "Connect a service and choose the models you want to use.", instructions: "Help the AI understand how you want it to respond.", mcp: "Choose what the AI can do when it needs to.", welcome: "A starting point for new conversations.", share: `Share the configuration of ${agent.name}.` };
  document.getElementById("settingsMainTitle").textContent = section === "overview" ? agent.name : headings[section];
  document.getElementById("settingsScopeDesc").textContent = descriptions[section] || "";
  document.getElementById("settingsBreadcrumb").textContent = section === "overview" ? "Agent settings" : agent.name;
  document.getElementById("settingsTopBreadcrumb").textContent = "Settings";
  document.getElementById("settingsAgentActions").classList.toggle("hide", !["overview", "providers"].includes(section));
  document.getElementById("settingsAgentShareBtn").classList.toggle("hide", section !== "overview");
  document.querySelector(".settings-actions-menu").classList.toggle("hide", section !== "overview");
  document.getElementById("addProviderBtn").classList.toggle("hide", section !== "providers");
  document.getElementById("settingsAgentRenameBtn").style.display = section === "overview" ? "inline-flex" : "none";
  document.getElementById("settingsSectionBackBtn").classList.toggle("hide", section === "overview");
  document.getElementById("settingsBackToChatBtn").classList.toggle("hide", section !== "overview");
  document.getElementById("settingsAgentShareBtn").setAttribute("aria-label", `Share ${agent.name}`);
  document.getElementById("settingsAgentDeleteBtn").disabled = state.agents.length < 2;
}

function readWelcomePromptEditor(){
  return parsePromptButtons(document.getElementById("agent_cfg_welcome_prompts")?.value || "");
}

function syncWelcomePromptEditor(){
  const buttons = Array.from(document.querySelectorAll(".welcome-prompt-row")).map(row => ({
    label: row.querySelector(".wp-label").value.trim(),
    desc: row.querySelector(".wp-desc").value.trim(),
    text: row.querySelector(".wp-text").value.trim()
  })).filter(item => item.label || item.text).map(item => ({ ...item, label: item.label || item.text, text: item.text || item.label }));
  // JSON also preserves multiline messages and literal pipes from imported configurations.
  document.getElementById("agent_cfg_welcome_prompts").value = JSON.stringify(buttons, null, 2);
}

function addWelcomePromptRow(prompt = {}){
  const row = document.createElement("div");
  row.className = "welcome-prompt-row";
  for(const [className, label, value, multiline] of [
    ["wp-label", "Button label", prompt.label || "", false],
    ["wp-text", "Message", prompt.text || "", true],
    ["wp-desc", "Description (optional)", prompt.desc || "", false]
  ]){
    const field = document.createElement("label");
    field.className = "form-row";
    const caption = document.createElement("span"); caption.textContent = label;
    const input = document.createElement(multiline ? "textarea" : "input");
    input.className = className; input.value = value;
    if(multiline) input.rows = 2;
    input.addEventListener("input", syncWelcomePromptEditor);
    field.append(caption, input); row.append(field);
  }
  const remove = document.createElement("button");
  remove.type = "button"; remove.className = "btn ghost btn-sm"; remove.textContent = "Remove suggestion";
  remove.onclick = () => { row.remove(); syncWelcomePromptEditor(); settingsDraftChanged(); };
  row.append(remove); document.getElementById("welcomePromptRows").append(row);
  return row;
}

function renderWelcomePromptEditor(buttons, keepSource = false){
  document.getElementById("welcomePromptRows").replaceChildren();
  parsePromptButtons(buttons).forEach(addWelcomePromptRow);
  if(!keepSource) document.getElementById("agent_cfg_welcome_prompts").value = JSON.stringify(parsePromptButtons(buttons), null, 2);
}

const SETTINGS_SAVE_DELAY = 600;
let _settingsSaveTimer = null;
let _settingsSavePending = false;
let _settingsModelsChanged = false;
let _settingsStatusTimer = null;

function setSettingsSaveStatus(message, failed = false){
  clearTimeout(_settingsStatusTimer);
  const status = document.getElementById("settingsSaveStatus");
  status.textContent = message;
  status.classList.toggle("error", failed);
  const noteStatus = document.getElementById("noteSaveStatus");
  if(noteStatus){ noteStatus.textContent = message; noteStatus.classList.toggle("error", failed); }
  if(message === "Saved") _settingsStatusTimer = setTimeout(() => { status.textContent = ""; if(noteStatus) noteStatus.textContent = ""; }, 1800);
}

function flushSettingsAutosave(){
  clearTimeout(_settingsSaveTimer);
  _settingsSaveTimer = null;
  if(!_settingsSavePending) return true;
  const variables = document.getElementById("agentVariablesInput");
  if(_settingsCurrentMode === "agent" && variables && !variables.validity.valid){
    setSettingsSaveStatus("Correct the custom variables JSON to save changes.",true);
    return false;
  }
  if(_settingsModelsChanged) populateModelSelect({ persist: false });
  if(!saveState()){
    setSettingsSaveStatus("Changes could not be saved. Free some browser storage and try again.", true);
    return false;
  }
  _settingsSavePending = false;
  _settingsModelsChanged = false;
  _localProtocolCache.clear();
  updateThinkingToggle();
  renderAgentBar();
  setSettingsSaveStatus("Saved");
  return true;
}

function settingsDraftChanged(event){
  if(!isSettingsOpen()) return;
  if(event?.target?.closest('[data-panel="share"], .ump-filter, .pb-filter')) return;
  if(event?.target?.closest("#configuredProvidersList")) _settingsModelsChanged = true;
  if(_settingsCurrentMode === "agent"){
    syncCurrentAgentSettingsFromDom(_settingsCurrentAgentId);
    syncProviderModalFromDom();
    document.querySelectorAll(".connection-proxy").forEach(syncConnectionProxyControls);
    refreshConnectionAccessIndicators();
    updateSettingsOverview();
    updateSettingsSectionHeader();
    updateAgentPromptPreview();
    if(event?.target?.id === "agent_cfg_inspection"){
      if(!getCurrentAgent().config.inspectionEnabled) closeRawCallDrawer();
      renderMessages();
    }
  } else if(_settingsCurrentAppTab === "general") { syncGeneralSettingsFromDom(); applyTheme(); }
  else return;
  queueSettingsAutosave();
}

function queueSettingsAutosave(){
  _settingsSavePending = true;
  setSettingsSaveStatus("Saving…");
  clearTimeout(_settingsSaveTimer);
  _settingsSaveTimer = setTimeout(flushSettingsAutosave, SETTINGS_SAVE_DELAY);
}

function simplifyProviderFields(block, provider){
  const fields = block.querySelector(".provider-fields");
  const details = document.createElement("details"); details.className = "advanced-details connection-advanced";
  const summary = document.createElement("summary"); summary.textContent = "Advanced connection settings";
  const body = document.createElement("div"); body.className = "settings-advanced-body";
  details.append(summary, body);
  const local = isLocalProviderType(provider.type);
  for(const selector of [".pb-name-input", ...(!local ? [".pb-base-input"] : []), ".pb-headers-input", ".pb-ollama-protocol", ...(local ? [".pb-key-input"] : [])]){
    const row = block.querySelector(selector)?.closest(".form-row");
    if(row) body.append(row);
  }
  fields.querySelectorAll(".row-2").forEach(row => { if(!row.children.length) row.remove(); });
  const actions = document.createElement("div"); actions.className = "settings-connection-actions";
  for(const [selector,label] of [[".pb-edit-btn","Edit connection"],[".pb-delete-btn","Remove connection"],[".pb-add-custom-btn","Add a model by ID"]]){
    const button = block.querySelector(selector);
    if(button){ button.textContent = label; actions.append(button); }
  }
  body.append(actions); fields.append(details);
  const proxy = document.createElement("div");
  proxy.innerHTML = connectionProxyMarkup(provider);
  body.prepend(proxy.firstElementChild);
  syncConnectionProxyControls(body);
  const baseLabel = block.querySelector(".pb-base-input")?.closest(".form-row")?.querySelector("label");
  if(baseLabel && local) baseLabel.textContent = "Service address";
}

function simplifyProviderModal(){
  const models = document.getElementById("pm_models_container");
  if(!models) return;
  let advanced = document.getElementById("providerConnectionAdvanced");
  if(!advanced){
    advanced = document.createElement("details"); advanced.id = "providerConnectionAdvanced"; advanced.className = "advanced-details settings-advanced";
    const summary = document.createElement("summary"); summary.textContent = "Advanced connection settings";
    const body = document.createElement("div"); body.className = "settings-advanced-body";
    advanced.append(summary, body);
    const modelsRow = models.closest(".form-row"); modelsRow.before(advanced);
    for(const id of ["pm_name", "pm_base", "pm_headers"]){ body.append(document.getElementById(id).closest(".form-row")); }
    body.append(document.getElementById("pm_ollama_fields"));
    const proxy = document.createElement("div");
    proxy.id = "pm_connection_proxy";
    body.append(proxy);
  }
  const local = isLocalProviderType(document.getElementById("pm_type").value);
  const base = document.getElementById("pm_base").closest(".form-row");
  const key = document.getElementById("pm_key").closest(".form-row");
  const body = advanced.querySelector(".settings-advanced-body");
  if(local){ advanced.before(base); body.append(key); }
  else { body.insertBefore(base, document.getElementById("pm_connection_proxy")); advanced.before(key); }
  advanced.open = false;
}

function setupSettingsLayout(){
  const menu = document.createElement("details"); menu.className = "chat-options-menu";
  const summary = document.createElement("summary"); summary.textContent = "···"; summary.setAttribute("aria-label", "Conversation options");
  const popover = document.createElement("div"); popover.className = "chat-options-popover";
  for(const [id,label] of [["chatPromptBtn","Instructions for this chat"],["memoryBtn","Conversation memory"],["thinkingToggle",null],["toolsModalBtn",null]]){
    const button = document.getElementById(id);
    if(label){ const text = document.createElement("span"); text.textContent = label; button.append(text); }
    popover.append(button);
  }
  menu.append(summary, popover); document.querySelector(".top-bar").append(menu);
  menu.addEventListener("click", event => { if(event.target.closest("button:not(#thinkingToggle)")) menu.open = false; });
  document.addEventListener("click", event => { if(!menu.contains(event.target)) menu.open = false; });
  menu.addEventListener("keydown", event => { if(event.key === "Escape"){ menu.open = false; summary.focus(); } });
  const agentMenu = document.querySelector(".settings-actions-menu");
  agentMenu.addEventListener("click", event => { if(event.target.closest("button")) agentMenu.open = false; });
  document.addEventListener("click", event => { if(!agentMenu.contains(event.target)) agentMenu.open = false; });
  agentMenu.addEventListener("keydown", event => {
    if(event.key === "Escape"){
      event.stopPropagation(); agentMenu.open = false; agentMenu.querySelector("summary").focus();
    }
  });
  document.querySelectorAll(".sidebar-header .logo").forEach(logo => {
    logo.onclick = event => {
      event.preventDefault();
      if(isSettingsOpen()) closeSettings();
      if(isNotepadOpen()) closeNotepad();
      closeMobileSidebar();
    };
  });
  injectIcons(document.getElementById("settingsView"));
  injectIcons(document.getElementById("sidebarSettingsContent"));
  document.getElementById("settingsSectionBackBtn").onclick = () => activateSubtab("overview");
  document.getElementById("settingsAgentShareBtn").onclick = () => activateSubtab("share");
  document.getElementById("settingsAgentDuplicateBtn").onclick = () => {
    syncCurrentAgentSettingsFromDom(_settingsCurrentAgentId);
    const agent = getCurrentAgent();
    const copy = createAgent(`${agent.name} (copy)`, structuredClone(agent.config), agent.systemPrompt, { author: agent.author, description: agent.description, version: agent.version, ephemeral: agent.ephemeral, userName:agent.userName, variables:agent.variables });
    Object.assign(copy, { temperature: agent.temperature, welcomeTitle: agent.welcomeTitle, welcomeDesc: agent.welcomeDesc, welcomePrompts: structuredClone(agent.welcomePrompts || []) });
    selectAgentInSettings(copy.id); saveState();
  };
  document.getElementById("settingsAgentDeleteBtn").onclick = () => deleteAgent(_settingsCurrentAgentId);
  document.querySelectorAll("#settingsView [data-subtab]").forEach(button => button.onclick = () => activateSubtab(button.dataset.subtab));
  document.getElementById("addWelcomePromptBtn").onclick = () => addWelcomePromptRow().querySelector("input").focus();
  document.getElementById("agent_cfg_welcome_prompts").addEventListener("input", event => renderWelcomePromptEditor(parsePromptButtons(event.target.value), true));
  document.getElementById("settingsView").addEventListener("input", settingsDraftChanged);
  document.getElementById("settingsView").addEventListener("change", settingsDraftChanged);
  document.getElementById("agentPromptVariableSelect").addEventListener("change",event=>{
    if(!event.target.value) return;
    const input=document.getElementById("agent_cfg_system");
    input.setRangeText(`{{${event.target.value}}}`,input.selectionStart,input.selectionEnd,"end");
    event.target.value="";
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.focus();
  });
  document.getElementById("providerModal").addEventListener("input", settingsDraftChanged);
  document.getElementById("providerModal").addEventListener("change", settingsDraftChanged);
  window.addEventListener("pagehide", flushSettingsAutosave);
  window.addEventListener("beforeunload", flushSettingsAutosave);
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden") flushSettingsAutosave(); });
  document.getElementById("cfg_theme").addEventListener("change", () => { state.theme = document.getElementById("cfg_theme").value; applyTheme(); });
  document.getElementById("sidebarSettingsCloseBtn").onclick = closeMobileSidebar;
}
