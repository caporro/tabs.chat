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
  document.documentElement.dataset.theme = state.theme;
}

/* settings view */
function isSettingsOpen(){
  const el = document.getElementById("settingsView");
  return el && !el.classList.contains("hide");
}
let _settingsProvidersSnapshot = null;
function openSettings(){
  _settingsProvidersSnapshot = JSON.stringify(state.config.providers);
  const sv = document.getElementById("settingsView");
  const cv = document.getElementById("chatView");
  const tb = document.querySelector(".top-bar");
  const sb = document.getElementById("settingsBtn");
  if(sv) sv.classList.remove("hide");
  if(cv) cv.classList.add("hide");
  if(tb) tb.classList.add("hide");
  if(sb) sb.classList.add("active");
  closeMobileSidebar();
  renderConfiguredProviders();
  const activeTab = document.querySelector(".settings-inner .tab.active")?.dataset.tab;
  if(activeTab === "models") renderModelsSettingsTab();
  if(activeTab === "mcp") renderMcpSettingsTab();
  const agentEnEl = document.getElementById("cfg_agent_enabled");
  if(agentEnEl) agentEnEl.checked = state.agent?.enabled !== false;
  const agentTurnsEl = document.getElementById("cfg_agent_max_turns");
  if(agentTurnsEl) agentTurnsEl.value = state.agent?.maxTurns || 10;
  document.getElementById("cfg_system").value = state.general.systemPrompt;
  document.getElementById("cfg_temp").value = state.general.temperature;
  document.getElementById("cfg_max_tokens").value = state.general.maxTokens;
  document.getElementById("cfg_history_n").value = state.general.historyN;
  document.getElementById("cfg_ctx_budget").value = state.general.contextTokenBudget ?? "";
  document.getElementById("cfg_think_mode").value = thinkMode();
  document.getElementById("cfg_num_ctx").value = state.general.numCtx ?? "";
  document.getElementById("cfg_top_p").value = state.general.topP ?? "";
  document.getElementById("cfg_top_k").value = state.general.topK ?? "";
  document.getElementById("cfg_min_p").value = state.general.minP ?? "";
  document.getElementById("cfg_presence_penalty").value = state.general.presencePenalty ?? "";
  document.getElementById("cfg_scenario_autocompress").checked = state.general.scenarioAutoCompress !== false;
  document.getElementById("cfg_scenario_compress_chars").value = state.general.scenarioCompressChars || 4000;
  document.getElementById("cfg_image_detail").value = state.general.imageDetail || "standard";
  document.getElementById("cfg_attach_keep_recent").value = state.general.attachmentKeepRecent ?? 1;
  document.getElementById("cfg_scenario_memory_max_chars").value = state.general.scenarioMemoryMaxChars || 800;
  document.getElementById("cfg_show_thinking").checked = !!state.general.showThinking;
  document.getElementById("cfg_user_name").value = state.general.userName || "";
  document.getElementById("cfg_ai_name").value = state.general.aiName || "";
}
function closeSettings(canceled){
  if(canceled && _settingsProvidersSnapshot){
    try{ state.config.providers = JSON.parse(_settingsProvidersSnapshot); }catch{}
  }
  _settingsProvidersSnapshot = null;
  const sv = document.getElementById("settingsView");
  const cv = document.getElementById("chatView");
  const tb = document.querySelector(".top-bar");
  const sb = document.getElementById("settingsBtn");
  if(sv) sv.classList.add("hide");
  if(cv) cv.classList.remove("hide");
  if(tb) tb.classList.remove("hide");
  if(sb) sb.classList.remove("active");
}
function setupInlineModelNickEditor(textarea, container){
  if(!textarea || !container) return;
  function render(){
    const entries = parseModelEntries(textarea.value);
    if(!entries.length){
      container.style.display = "none";
      container.innerHTML = "";
      return;
    }
    container.style.display = "";
    container.innerHTML = `
      <div class="pb-models-nick-header">
        <span>${escapeHtml(t("models.inline.nicksTitle"))} (${entries.length})</span>
        <span class="hint">${escapeHtml(t("models.inline.nicksHint"))}</span>
      </div>
      <div class="pb-models-nick-list"></div>
    `;
    const list = container.querySelector(".pb-models-nick-list");
    entries.forEach(entry => {
      const row = document.createElement("div");
      row.className = "pb-models-nick-row";
      row.innerHTML = `
        <span class="nick-id" title="${escapeHtml(entry.model)}">${escapeHtml(entry.model)}</span>
        <input class="nick-input" type="text" value="${escapeHtml(entry.nick)}" placeholder="${escapeHtml(t("models.tab.nickPlaceholder") || "Nickname")}" />
        <button type="button" class="icon-btn model-nick-clear" title="${escapeHtml(t("models.tab.reset") || "Reset")}" style="${entry.nick ? '' : 'display:none'}">✕</button>
      `;
      const input = row.querySelector(".nick-input");
      const clearBtn = row.querySelector(".model-nick-clear");
      const onInput = () => {
        textarea._internalUpdate = true;
        textarea.value = updateModelNickInText(textarea.value, entry.model, input.value);
        textarea._internalUpdate = false;
        clearBtn.style.display = input.value.trim() ? "" : "none";
      };
      input.oninput = onInput;
      clearBtn.onclick = () => {
        input.value = "";
        onInput();
      };
      list.appendChild(row);
    });
  }
  textarea.oninput = () => {
    if(!textarea._internalUpdate){
      render();
    }
  };
  render();
}

function renderModelsSettingsTab(){
  const container = document.getElementById("modelsSettingsContainer");
  const searchInput = document.getElementById("modelsSearchInput");
  const countEl = document.getElementById("modelsSummaryCount");
  if(!container) return;

  const blocks = document.querySelectorAll("#configuredProvidersList .provider-block");
  blocks.forEach(block => {
    const id = block.dataset.providerId;
    const prov = state.config.providers.find(x => x.id === id);
    if(prov){
      const nameEl = block.querySelector(".pb-name-input");
      if(nameEl && nameEl.value.trim()) prov.name = nameEl.value.trim();
      const modelsEl = block.querySelector(".pb-models-input");
      if(modelsEl) prov.models = modelsEl.value;
    }
  });

  const providers = getProviders();
  let totalModels = 0;
  let nicknamedModels = 0;

  providers.forEach(p => {
    const entries = parseModelEntries(p.models);
    totalModels += entries.length;
    nicknamedModels += entries.filter(e => e.nick).length;
  });

  if(countEl){
    countEl.textContent = t("models.tab.summary", totalModels, nicknamedModels);
  }

  if(!providers.length || totalModels === 0){
    container.innerHTML = `
      <div class="providers-empty">
        <div class="providers-empty-icon">🏷️</div>
        <div class="providers-empty-text">${escapeHtml(t("models.tab.empty"))}</div>
        <button type="button" class="btn primary" id="modelsGoToProvidersBtn" style="margin-top:12px">${escapeHtml(t("models.tab.goToProviders"))}</button>
      </div>
    `;
    const btn = document.getElementById("modelsGoToProvidersBtn");
    if(btn){
      btn.onclick = () => {
        const provTab = document.querySelector('.tab[data-tab="providers"]');
        if(provTab) provTab.click();
      };
    }
    return;
  }

  container.innerHTML = "";

  providers.forEach(p => {
    const entries = parseModelEntries(p.models);
    if(!entries.length) return;

    let labelPrefix = p.name;
    if(!labelPrefix){
      if(p.type === "openai") labelPrefix = openaiVendorLabel(p.base);
      else if(p.type === "claude") labelPrefix = "Claude";
      else if(p.type === "gemini") labelPrefix = "Gemini";
      else if(p.type === "ollama") labelPrefix = t("vendor.local") || "Local";
      else labelPrefix = p.type;
    }

    const group = document.createElement("div");
    group.className = "models-group";
    group.dataset.providerId = p.id;

    group.innerHTML = `
      <div class="models-group-header">
        <div class="models-group-title">
          <span>${badgeEmoji(p.type)}</span>
          <span>${escapeHtml(p.name || defaultNameForType(p.type))}</span>
          <span class="provider-type-tag">${escapeHtml(providerTypeLabel(p.type))}</span>
          ${p.enabled === false ? '<span class="model-disabled-tag">(Disabled)</span>' : ''}
        </div>
        <span class="hint" style="font-size:12px">${entries.length} model(s)</span>
      </div>
      <div class="models-list"></div>
    `;

    const list = group.querySelector(".models-list");

    entries.forEach(entry => {
      const row = document.createElement("div");
      row.className = "models-row";
      row.dataset.model = entry.model;

      const previewDisplay = entry.nick || entry.model;
      row.innerHTML = `
        <div class="model-id-label">
          <span class="model-id-raw" title="${escapeHtml(entry.model)}">${escapeHtml(entry.model)}</span>
          <span class="model-preview-badge">${escapeHtml(labelPrefix)} · <span class="preview-text">${escapeHtml(previewDisplay)}</span></span>
        </div>
        <div class="model-nick-field">
          <input type="text" class="model-nick-input" value="${escapeHtml(entry.nick)}" placeholder="${escapeHtml(t("models.tab.nickPlaceholder") || "Nickname")}" />
        </div>
        <div class="model-actions">
          <button type="button" class="icon-btn model-nick-clear" title="${escapeHtml(t("models.tab.reset") || "Reset")}" style="${entry.nick ? '' : 'display:none'}">✕</button>
        </div>
      `;

      const input = row.querySelector(".model-nick-input");
      const clearBtn = row.querySelector(".model-nick-clear");
      const previewText = row.querySelector(".preview-text");

      const onNickChange = (newVal) => {
        p.models = updateModelNickInText(p.models, entry.model, newVal);
        const domBlock = document.querySelector(`.provider-block[data-provider-id="${p.id}"] .pb-models-input`);
        if(domBlock){
          domBlock._internalUpdate = true;
          domBlock.value = p.models;
          domBlock._internalUpdate = false;
          const nickEditor = domBlock.closest(".provider-block")?.querySelector(".pb-models-nick-editor");
          if(nickEditor) setupInlineModelNickEditor(domBlock, nickEditor);
        }
        entry.nick = newVal.trim();
        previewText.textContent = entry.nick || entry.model;
        clearBtn.style.display = entry.nick ? "" : "none";

        let curNicknamed = 0;
        providers.forEach(pr => {
          curNicknamed += parseModelEntries(pr.models).filter(e => e.nick).length;
        });
        if(countEl) countEl.textContent = t("models.tab.summary", totalModels, curNicknamed);
      };

      input.oninput = () => {
        onNickChange(input.value);
      };

      clearBtn.onclick = () => {
        input.value = "";
        onNickChange("");
      };

      list.appendChild(row);
    });

    container.appendChild(group);
  });

  if(searchInput){
    searchInput.oninput = () => {
      const q = searchInput.value.toLowerCase().trim();
      container.querySelectorAll(".models-group").forEach(grp => {
        let hasMatch = false;
        grp.querySelectorAll(".models-row").forEach(row => {
          const m = (row.dataset.model || "").toLowerCase();
          const nick = (row.querySelector(".model-nick-input")?.value || "").toLowerCase();
          const match = !q || m.includes(q) || nick.includes(q);
          row.style.display = match ? "" : "none";
          if(match) hasMatch = true;
        });
        grp.style.display = hasMatch ? "" : "none";
      });
    };
  }
}

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
}
function createProviderBlockElement(p){
  const block = document.createElement("div");
  block.className = `provider-block${p.enabled === false ? " disabled" : ""}`;
  block.dataset.providerId = p.id;

  const isOllama = p.type === "ollama";
  const typeTag = providerTypeLabel(p.type);
  const emoji = badgeEmoji(p.type);

  block.innerHTML = `
    <div class="provider-header">
      <div class="provider-header-left">
        <span class="provider-badge">${emoji}</span>
        <h4 class="provider-title">${escapeHtml(p.name || defaultNameForType(p.type))}</h4>
        <span class="provider-type-tag">${escapeHtml(typeTag)}</span>
      </div>
      <div class="provider-header-actions">
        <label class="provider-toggle">
          <input type="checkbox" class="pb-enabled-check" ${p.enabled !== false ? "checked" : ""}>
          <span>${escapeHtml(t("providers.enabled"))}</span>
        </label>
        <button type="button" class="btn ghost btn-sm pb-edit-btn" title="${escapeHtml(t("providers.edit"))}">✏️</button>
        <button type="button" class="btn ghost btn-sm pb-delete-btn" title="${escapeHtml(t("providers.delete"))}" style="color:var(--danger)">🗑️</button>
      </div>
    </div>
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
        <label>${escapeHtml(t("providers.apiKey"))}${isOllama ? ` (${escapeHtml(t("ollama.key.placeholder"))})` : ""}</label>
        <input class="pb-key-input" type="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" value="${escapeHtml(p.key || "")}" placeholder="${isOllama ? escapeHtml(t("ollama.key.placeholder")) : "sk-..."}" />
      </div>
      ${isOllama ? `
      <div class="row-2">
        <div class="form-row">
          <label>${escapeHtml(t("ollama.protocol"))}</label>
          <select class="pb-ollama-protocol">
            <option value="auto"${(p.protocol || "auto") === "auto" ? " selected" : ""}>${escapeHtml(t("ollama.protocol.auto"))}</option>
            <option value="ollama"${p.protocol === "ollama" ? " selected" : ""}>${escapeHtml(t("ollama.protocol.native"))}</option>
            <option value="openai"${p.protocol === "openai" ? " selected" : ""}>${escapeHtml(t("ollama.protocol.openai"))}</option>
          </select>
        </div>
        <div class="form-row">
          <label>${escapeHtml(t("ollama.langLock"))}</label>
          <select class="pb-ollama-langlock">
            <option value="off"${(p.langLock || "off") === "off" ? " selected" : ""}>${escapeHtml(t("ollama.langLock.off"))}</option>
            <option value="auto"${p.langLock === "auto" ? " selected" : ""}>${escapeHtml(t("ollama.langLock.auto"))}</option>
            <option value="zh"${p.langLock === "zh" ? " selected" : ""}>${escapeHtml(t("ollama.langLock.zh"))}</option>
            <option value="ja"${p.langLock === "ja" ? " selected" : ""}>${escapeHtml(t("ollama.langLock.ja"))}</option>
            <option value="en"${p.langLock === "en" ? " selected" : ""}>${escapeHtml(t("ollama.langLock.en"))}</option>
          </select>
        </div>
      </div>
      ` : ""}
      <div class="form-row">
        <label class="model-label">
          <span>${escapeHtml(t("providers.modelList"))}</span>
          <button type="button" class="fetch-btn pb-fetch-btn">${escapeHtml(t("providers.fetch"))}</button>
        </label>
        <div class="model-picker pb-model-picker" style="display:none">
          <div class="picker-header">
            <input class="picker-filter" placeholder="${escapeHtml(t("picker.filter.placeholder"))}" />
            <span class="picker-count"></span>
            <button type="button" class="btn ghost picker-toggle-all">${escapeHtml(t("picker.toggleAll"))}</button>
            <button type="button" class="btn primary picker-apply">${escapeHtml(t("picker.apply"))}</button>
            <button type="button" class="btn ghost picker-cancel">${escapeHtml(t("picker.cancel"))}</button>
          </div>
          <div class="picker-list"></div>
        </div>
        <textarea class="pb-models-input" rows="3" placeholder="model-name-1&#10;model-name-2">${escapeHtml(p.models || "")}</textarea>
        <span class="hint" data-i18n-html="providers.modelList.hint">${t("providers.modelList.hint")}</span>
        <div class="pb-models-nick-editor" style="display:none"></div>
      </div>
    </div>
  `;

  const enCheck = block.querySelector(".pb-enabled-check");
  if(enCheck){
    enCheck.onchange = (e) => {
      p.enabled = e.target.checked;
      block.classList.toggle("disabled", !p.enabled);
      saveState();
      populateModelSelect();
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
          saveState();
          populateModelSelect();
          renderConfiguredProviders();
        }
      }
    };
  }

  const fetchBtn = block.querySelector(".pb-fetch-btn");
  const baseInput = block.querySelector(".pb-base-input");
  const keyInput = block.querySelector(".pb-key-input");
  const modelsInput = block.querySelector(".pb-models-input");
  const pickerPanel = block.querySelector(".pb-model-picker");
  const nickEditor = block.querySelector(".pb-models-nick-editor");

  if(modelsInput && nickEditor){
    setupInlineModelNickEditor(modelsInput, nickEditor);
  }

  if(fetchBtn && baseInput && keyInput && modelsInput && pickerPanel){
    fetchBtn.onclick = async (e) => {
      e.preventDefault();
      const origText = fetchBtn.textContent;
      fetchBtn.disabled = true;
      fetchBtn.textContent = t("providers.fetching");
      try {
        const base = baseInput.value.trim() || defaultBaseForType(p.type);
        const key = keyInput.value.trim();
        const names = await fetchModelsForType(p.type, base, key);
        renderModelPickerPanel(pickerPanel, modelsInput, names);
      } catch(err) {
        alert(t("alert.fetchFailed", err.message));
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = origText;
      }
    };
  }

  return block;
}
function saveSettings(){
  const blocks = document.querySelectorAll("#configuredProvidersList .provider-block");
  blocks.forEach(block => {
    const id = block.dataset.providerId;
    const prov = state.config.providers.find(x => x.id === id);
    if(prov){
      const enEl = block.querySelector(".pb-enabled-check");
      if(enEl) prov.enabled = enEl.checked;
      const nameEl = block.querySelector(".pb-name-input");
      if(nameEl) prov.name = nameEl.value.trim() || defaultNameForType(prov.type);
      const baseEl = block.querySelector(".pb-base-input");
      if(baseEl) prov.base = baseEl.value.trim() || defaultBaseForType(prov.type);
      const keyEl = block.querySelector(".pb-key-input");
      if(keyEl) prov.key = keyEl.value.trim();
      const modelsEl = block.querySelector(".pb-models-input");
      if(modelsEl) prov.models = modelsEl.value;
      if(prov.type === "ollama"){
        const protoEl = block.querySelector(".pb-ollama-protocol");
        if(protoEl) prov.protocol = protoEl.value;
        const langEl = block.querySelector(".pb-ollama-langlock");
        if(langEl) prov.langLock = langEl.value;
      }
    }
  });

  _settingsProvidersSnapshot = null;
  _localProtocolCache.clear();
  state.general.systemPrompt = document.getElementById("cfg_system").value;
  state.general.temperature = Number(document.getElementById("cfg_temp").value)||0.7;
  state.general.maxTokens = document.getElementById("cfg_max_tokens").value.trim();
  state.general.historyN = Number(document.getElementById("cfg_history_n").value)||40;
  // 采样类字段保持字符串："" 表示不发送，显式 0 也要能存下来
  const cfgStr = id => document.getElementById(id).value.trim();
  state.general.contextTokenBudget = cfgStr("cfg_ctx_budget");
  state.general.thinkMode = document.getElementById("cfg_think_mode").value || "auto";
  state.general.numCtx = cfgStr("cfg_num_ctx");
  state.general.topP = cfgStr("cfg_top_p");
  state.general.topK = cfgStr("cfg_top_k");
  state.general.minP = cfgStr("cfg_min_p");
  state.general.presencePenalty = cfgStr("cfg_presence_penalty");
  state.general.scenarioAutoCompress = document.getElementById("cfg_scenario_autocompress").checked;
  state.general.scenarioCompressChars = Math.max(500, Number(document.getElementById("cfg_scenario_compress_chars").value)||4000);
  state.general.imageDetail = document.getElementById("cfg_image_detail").value || "standard";
  state.general.attachmentKeepRecent = Math.max(0, Number(document.getElementById("cfg_attach_keep_recent").value)||0);
  state.general.scenarioMemoryMaxChars = Math.max(200, Number(document.getElementById("cfg_scenario_memory_max_chars").value)||800);
  state.general.showThinking = document.getElementById("cfg_show_thinking").checked;
  state.general.userName = document.getElementById("cfg_user_name").value.trim() || t("userName.default");
  state.general.aiName = document.getElementById("cfg_ai_name").value.trim() || t("aiName.default");

  const agentEnEl = document.getElementById("cfg_agent_enabled");
  if(agentEnEl) state.agent.enabled = agentEnEl.checked;
  const agentTurnsEl = document.getElementById("cfg_agent_max_turns");
  if(agentTurnsEl) state.agent.maxTurns = Math.max(1, Math.min(30, Number(agentTurnsEl.value) || 10));

  saveMcpServersFromDom();
  saveState(); populateModelSelect(); updateThinkingToggle(); renderMessages(); closeSettings();
}

function updateThinkingToggle(){
  const el = document.getElementById("thinkingToggle");
  if(!el) return;
  el.classList.toggle("on", !!state.general.showThinking);
}

async function fetchModelsForType(type, base, key){
  base = (base || defaultBaseForType(type)).trim().replace(/\/+$/,"");
  key = (key || "").trim();
  if(!base) throw new Error(t("alert.baseUrlRequired"));

  if(type === "openai"){
    const candidates = [
      (base.endsWith("/v1") ? base : base + "/v1") + "/models",
      base + "/models"
    ];
    for(const u of candidates){
      try {
        const r = await fetch(u, {headers: key ? {"Authorization":"Bearer "+key} : {}});
        if(r.ok){
          const j = await r.json();
          if(!j?.error && (Array.isArray(j?.data) || Array.isArray(j?.models))){
            return (j.data || j.models).map(m => m.id || m.name || m.model).filter(Boolean);
          }
        }
      } catch(e) {}
    }
    const r = await fetch(candidates[0], {headers: key ? {"Authorization":"Bearer "+key} : {}});
    if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}: ${await r.text().catch(()=>"")}`);
    const j = await r.json();
    if(j?.error) throw new Error(typeof j.error === "string" ? j.error : (j.error.message || JSON.stringify(j.error)));
    return (j.data || j.models || []).map(m => m.id || m.name || m.model).filter(Boolean);
  }
  if(type === "claude"){
    const r = await fetch(base+"/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      }
    });
    if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}: ${await r.text().catch(()=>"")}`);
    const j = await r.json();
    return (j.data || []).map(m => m.id).filter(Boolean);
  }
  if(type === "gemini"){
    const r = await fetch(`${base}/models?key=${encodeURIComponent(key)}`);
    if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}: ${await r.text().catch(()=>"")}`);
    const j = await r.json();
    return (j.models || [])
      .filter(m => !(m.supportedGenerationMethods||[]).length || (m.supportedGenerationMethods||[]).some(x => /generateContent/i.test(x)))
      .map(m => (m.name || "").replace(/^models\//, ""))
      .filter(Boolean);
  }
  if(type === "ollama"){
    const cleanBase = base.replace(/\/v\d+$/,"");
    // 1. Try Ollama native endpoint (/api/tags)
    try {
      const r = await fetch(cleanBase + "/api/tags");
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
        const r = await fetch(u, {headers: key ? {"Authorization":"Bearer "+key} : {}});
        if(r.ok){
          const j = await r.json();
          if(!j?.error && (Array.isArray(j?.data) || Array.isArray(j?.models))){
            return (j.data || j.models).map(m => m.id || m.name || m.model).filter(Boolean);
          }
        }
      } catch(e) {}
    }

    const r = await fetch(cleanBase + "/api/tags");
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

function openAddProviderModal(type){
  if(!type){
    const sel = document.getElementById("newProviderTypeSelect");
    if(sel) sel.focus();
    return;
  }
  const modal = document.getElementById("providerModal");
  if(!modal) return;
  const titleEl = document.getElementById("providerModalTitle");
  if(titleEl) titleEl.textContent = `${t("providers.modal.titleAdd")} — ${providerTypeLabel(type)}`;

  document.getElementById("pm_id").value = "";
  document.getElementById("pm_type").value = type;
  document.getElementById("pm_name").value = defaultNameForType(type);
  document.getElementById("pm_base").value = defaultBaseForType(type);
  document.getElementById("pm_key").value = "";
  document.getElementById("pm_models").value = defaultModelsForType(type);
  setupInlineModelNickEditor(document.getElementById("pm_models"), document.getElementById("pm_models_nick_editor"));

  const ollamaFields = document.getElementById("pm_ollama_fields");
  if(ollamaFields){
    ollamaFields.style.display = type === "ollama" ? "" : "none";
    document.getElementById("pm_ollama_protocol").value = "auto";
    document.getElementById("pm_ollama_langlock").value = "off";
  }

  const keyLabel = document.getElementById("pm_key_label");
  if(keyLabel){
    keyLabel.textContent = type === "ollama" ? `${t("providers.apiKey")} (${t("ollama.key.placeholder")})` : t("providers.apiKey");
  }

  const picker = document.getElementById("pm_picker");
  if(picker) picker.style.display = "none";

  modal.classList.remove("hide");
}

function openEditProviderModal(id){
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
    const modelsEl = block.querySelector(".pb-models-input");
    if(modelsEl) p.models = modelsEl.value;
    if(p.type === "ollama"){
      const protoEl = block.querySelector(".pb-ollama-protocol");
      if(protoEl) p.protocol = protoEl.value;
      const langEl = block.querySelector(".pb-ollama-langlock");
      if(langEl) p.langLock = langEl.value;
    }
  }

  const modal = document.getElementById("providerModal");
  if(!modal) return;
  const titleEl = document.getElementById("providerModalTitle");
  if(titleEl) titleEl.textContent = `${t("providers.modal.titleEdit")} — ${p.name || providerTypeLabel(p.type)}`;

  document.getElementById("pm_id").value = p.id;
  document.getElementById("pm_type").value = p.type;
  document.getElementById("pm_name").value = p.name || defaultNameForType(p.type);
  document.getElementById("pm_base").value = p.base || defaultBaseForType(p.type);
  document.getElementById("pm_key").value = p.key || "";
  document.getElementById("pm_models").value = p.models || defaultModelsForType(p.type);
  setupInlineModelNickEditor(document.getElementById("pm_models"), document.getElementById("pm_models_nick_editor"));

  const ollamaFields = document.getElementById("pm_ollama_fields");
  if(ollamaFields){
    ollamaFields.style.display = p.type === "ollama" ? "" : "none";
    document.getElementById("pm_ollama_protocol").value = p.protocol || "auto";
    document.getElementById("pm_ollama_langlock").value = p.langLock || "off";
  }

  const keyLabel = document.getElementById("pm_key_label");
  if(keyLabel){
    keyLabel.textContent = p.type === "ollama" ? `${t("providers.apiKey")} (${t("ollama.key.placeholder")})` : t("providers.apiKey");
  }

  const picker = document.getElementById("pm_picker");
  if(picker) picker.style.display = "none";

  modal.classList.remove("hide");
}

function closeProviderModal(){
  const modal = document.getElementById("providerModal");
  if(modal) modal.classList.add("hide");
  const picker = document.getElementById("pm_picker");
  if(picker) picker.style.display = "none";
  const nickEditor = document.getElementById("pm_models_nick_editor");
  if(nickEditor) nickEditor.style.display = "none";
}

function saveProviderModal(){
  const id = document.getElementById("pm_id").value.trim();
  const type = document.getElementById("pm_type").value.trim() || "openai";
  const name = document.getElementById("pm_name").value.trim() || defaultNameForType(type);
  const base = document.getElementById("pm_base").value.trim() || defaultBaseForType(type);
  const key = document.getElementById("pm_key").value.trim();
  const models = document.getElementById("pm_models").value;
  const isOllama = type === "ollama";
  const protocol = isOllama ? (document.getElementById("pm_ollama_protocol").value || "auto") : undefined;
  const langLock = isOllama ? (document.getElementById("pm_ollama_langlock").value || "off") : undefined;

  if(id){
    const prov = state.config.providers.find(x => x.id === id);
    if(prov){
      prov.name = name;
      prov.base = base;
      prov.key = key;
      prov.models = models;
      if(isOllama){
        prov.protocol = protocol;
        prov.langLock = langLock;
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
      models,
      ...(isOllama ? { protocol, langLock } : {})
    };
    state.config.providers.push(newProv);
  }

  saveState();
  populateModelSelect();
  closeProviderModal();
  renderConfiguredProviders();
  const sel = document.getElementById("newProviderTypeSelect");
  if(sel) sel.value = "";
}


/* Mobile sidebar */
function openMobileSidebar(){ document.getElementById("sidebar").classList.add("open"); document.getElementById("mobileMask").classList.add("show"); }
function closeMobileSidebar(){ document.getElementById("sidebar").classList.remove("open"); document.getElementById("mobileMask").classList.remove("show"); }

/* Export / Import */
function exportData(){
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download = `achat-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
}
function importData(file){
  const r = new FileReader();
  r.onload = ()=>{
    try{
      const s = JSON.parse(r.result);
      if(!s.chats) throw new Error(t("error.invalidFile"));
      normalizeStateProviders(s);
      if(confirm(t("confirm.import"))){
        state = Object.assign(structuredClone(DEFAULT_STATE), s);
      }else{
        state.chats = (s.chats||[]).concat(state.chats);
      }
      saveState(); applyTheme(); applyI18n(); populateModelSelect(); renderChatList(); renderMessages(); updateTopBar(); renderConfiguredProviders();
    }catch(e){ alert(t("alert.importFailed")+e.message); }
  };
  r.readAsText(file);
}

/* ------------------------- MCP Settings UI ------------------------- */
function renderMcpSettingsTab(){
  renderMcpToolsViewer(document.getElementById("mcpToolsViewerList"), document.getElementById("mcpToolsCountHint"));
  const container = document.getElementById("mcpServersList");
  if(!container) return;
  container.innerHTML = "";
  const servers = (state.config && state.config.mcpServers) || [];

  if(!servers.length){
    container.innerHTML = `
      <div class="providers-empty">
        <div class="providers-empty-icon">🤖</div>
        <div class="providers-empty-text">No MCP servers configured yet. Click "＋ Add MCP Server" to connect a tool server.</div>
      </div>
    `;
    return;
  }

  servers.forEach(s => {
    const block = document.createElement("div");
    block.className = "provider-block";
    block.dataset.mcpId = s.id;
    block.innerHTML = `
      <div class="provider-header">
        <div class="provider-title">
          <span>🛠️</span>
          <span class="mcp-name-label">${escapeHtml(s.name || "MCP Server")}</span>
          <span class="provider-type-tag">HTTP / SSE</span>
        </div>
        <div class="provider-actions">
          <label class="pb-enabled-toggle">
            <input type="checkbox" class="mcp-enabled-check" ${s.enabled !== false ? "checked" : ""}>
            <span>Enabled</span>
          </label>
          <button type="button" class="btn ghost btn-sm mcp-delete-btn" style="color:var(--danger)">🗑️</button>
        </div>
      </div>
      <div class="provider-fields">
        <div class="row-2">
          <div class="form-row">
            <label>Server Name</label>
            <input class="mcp-name-input" value="${escapeHtml(s.name || "")}" placeholder="e.g. Web Tools, DB Query" />
          </div>
          <div class="form-row">
            <label>Endpoint URL (JSON-RPC 2.0)</label>
            <input class="mcp-url-input" type="url" value="${escapeHtml(s.url || "")}" placeholder="https://api.example.com/mcp" />
          </div>
        </div>
        <div class="form-row">
          <label>API Key / Bearer Token (Optional)</label>
          <input class="mcp-key-input" type="password" value="${escapeHtml(s.apiKey || "")}" placeholder="Bearer token if required" />
        </div>
      </div>
    `;

    const delBtn = block.querySelector(".mcp-delete-btn");
    delBtn.onclick = () => {
      state.config.mcpServers = state.config.mcpServers.filter(x => x.id !== s.id);
      renderMcpSettingsTab();
    };

    container.appendChild(block);
  });
}

function saveMcpServersFromDom(){
  const blocks = document.querySelectorAll("#mcpServersList .provider-block");
  blocks.forEach(block => {
    const id = block.dataset.mcpId;
    const server = (state.config.mcpServers || []).find(x => x.id === id);
    if(server){
      const en = block.querySelector(".mcp-enabled-check");
      if(en) server.enabled = en.checked;
      const name = block.querySelector(".mcp-name-input");
      if(name) server.name = name.value.trim() || "MCP Server";
      const url = block.querySelector(".mcp-url-input");
      if(url) server.url = url.value.trim();
      const key = block.querySelector(".mcp-key-input");
      if(key) server.apiKey = key.value.trim();
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
      renderMcpSettingsTab();
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
  if(count > 0 && state.agent?.enabled !== false){
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
          <span class="mcp-tool-name">🛠️ ${escapeHtml(t.name)}</span>
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




