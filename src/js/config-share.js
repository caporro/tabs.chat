/* ============================================================
   tabs.chat — Configuration Sharing & Hash Import
   - Hash Fragment (#) only for absolute zero-server leak privacy
   - Shorthand URL params, Full JSON bundle, or AES-GCM Encrypted
   - Web Crypto API PBKDF2 + AES-GCM 256-bit with user password
   - Smart Non-Destructive Merge with Preview Dialog
   ============================================================ */

/* ------------------- Base64 / Encoding Utilities ------------------- */
function uint8ToBase64(u8){
  let binary = "";
  const len = u8.byteLength;
  for(let i=0; i<len; i++){
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64){
  const binary = atob(b64);
  const len = binary.length;
  const u8 = new Uint8Array(len);
  for(let i=0; i<len; i++){
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}

function base64UrlEncode(str){
  const u8 = new TextEncoder().encode(str);
  return uint8ToBase64(u8)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str){
  let b64 = (str || "").replace(/-/g, "+").replace(/_/g, "/");
  while(b64.length % 4){ b64 += "="; }
  const u8 = base64ToUint8(b64);
  return new TextDecoder().decode(u8);
}

/* ------------------- Web Crypto AES-GCM Encryption ------------------- */
async function deriveConfigKey(password, salt){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptConfig(jsonString, password){
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveConfigKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    enc.encode(jsonString)
  );
  const payload = {
    v: 1,
    s: uint8ToBase64(salt),
    iv: uint8ToBase64(iv),
    ct: uint8ToBase64(new Uint8Array(ciphertext))
  };
  return base64UrlEncode(JSON.stringify(payload));
}

async function decryptConfig(encodedString, password){
  const jsonStr = base64UrlDecode(encodedString);
  const payload = JSON.parse(jsonStr);
  if(!payload || !payload.s || !payload.iv || !payload.ct){
    throw new Error("Invalid encrypted bundle format");
  }
  const salt = base64ToUint8(payload.s);
  const iv = base64ToUint8(payload.iv);
  const ct = base64ToUint8(payload.ct);
  const key = await deriveConfigKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ct
  );
  return new TextDecoder().decode(decrypted);
}

/* ------------------- State & Modal Controllers ------------------- */
let _pendingImportBundle = null;
let _pendingEncryptedData = null;

function closeImportModal(){
  const m = document.getElementById("importConfigModal");
  if(m) m.classList.add("hide");
  _pendingImportBundle = null;
  _pendingEncryptedData = null;
}

function showEncryptedPasswordPrompt(encData){
  _pendingEncryptedData = encData;
  const m = document.getElementById("importConfigModal");
  if(!m) return;
  const passBody = document.getElementById("importPasswordBody");
  const prevBody = document.getElementById("importPreviewBody");
  const prevFooter = document.getElementById("importPreviewFooter");
  const errEl = document.getElementById("importPasswordError");
  const passInput = document.getElementById("importPasswordInput");

  if(passBody) passBody.classList.remove("hide");
  if(prevBody) prevBody.classList.add("hide");
  if(prevFooter) prevFooter.classList.add("hide");
  if(errEl) errEl.classList.add("hide");
  if(passInput){ passInput.value = ""; passInput.focus(); }

  m.classList.remove("hide");
}

function showImportPreview(bundle){
  _pendingImportBundle = bundle;
  const m = document.getElementById("importConfigModal");
  if(!m) return;
  const passBody = document.getElementById("importPasswordBody");
  const prevBody = document.getElementById("importPreviewBody");
  const prevFooter = document.getElementById("importPreviewFooter");

  if(passBody) passBody.classList.add("hide");
  if(prevBody) prevBody.classList.remove("hide");
  if(prevFooter) prevFooter.classList.remove("hide");

  // Populate Providers
  const provSection = document.getElementById("importProvidersSection");
  const provList = document.getElementById("importProvidersList");
  const providers = bundle.providers || [];
  if(provList){
    provList.innerHTML = "";
    if(!providers.length){
      provSection.classList.add("hide");
    } else {
      provSection.classList.remove("hide");
      providers.forEach(p => {
        const row = document.createElement("div");
        row.style.cssText = "background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px";
        const keyTag = (p.key || "").trim() 
          ? `<span style="color:var(--accent);font-family:var(--font-mono);font-size:11px">key: ••••••••</span>` 
          : `<span style="color:var(--fg-3);font-size:11px">(no key included)</span>`;
        const modelsCount = (p.models || "").split("\n").filter(x=>x.trim()).length;
        row.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:600;color:var(--fg)">${escapeHtml(p.name || defaultNameForType(p.type))}</span>
            <span class="onboarding-tag cloud" style="text-transform:uppercase">${escapeHtml(p.type || "openai")}</span>
          </div>
          <div style="font-size:12px;color:var(--fg-2);margin-bottom:4px;font-family:var(--font-mono)">${escapeHtml(p.base || defaultBaseForType(p.type))}</div>
          ${connectionProxyImportHint(p)}
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px">
            <span style="color:var(--fg-3)">${modelsCount ? `${modelsCount} models` : "default models"}</span>
            ${keyTag}
          </div>
        `;
        provList.appendChild(row);
      });
    }
  }

  // Populate MCP
  const mcpSection = document.getElementById("importMcpSection");
  const mcpList = document.getElementById("importMcpList");
  const mcps = bundle.mcpServers || [];
  if(mcpList){
    mcpList.innerHTML = "";
    if(!mcps.length){
      mcpSection.classList.add("hide");
    } else {
      mcpSection.classList.remove("hide");
      mcps.forEach(s => {
        const row = document.createElement("div");
        row.style.cssText = "background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;display:flex;align-items:center;justify-content:space-between";
        row.innerHTML = `
          <div>
            <div style="font-weight:600;color:var(--fg)">${escapeHtml(s.name || "MCP Server")}</div>
            <div style="font-size:11.5px;color:var(--fg-3);font-family:var(--font-mono)">${escapeHtml(s.url || "")}</div>
            ${connectionProxyImportHint(s)}
          </div>
          <span style="font-size:11px;color:var(--accent);font-weight:600">SSE / HTTP</span>
        `;
        mcpList.appendChild(row);
      });
    }
  }

  // Populate System Prompt
  const promptSection = document.getElementById("importPromptSection");
  const promptPreview = document.getElementById("importPromptPreview");
  const prompt = (bundle.systemPrompt || "").trim();
  if(!prompt){
    if(promptSection) promptSection.classList.add("hide");
  } else {
    if(promptSection) promptSection.classList.remove("hide");
    if(promptPreview) promptPreview.textContent = prompt;
  }

  // Populate Model Tuning / General Parameters
  const generalSection = document.getElementById("importGeneralSection");
  const generalDetails = document.getElementById("importGeneralDetails");
  if(generalDetails && generalSection){
    generalDetails.innerHTML = "";
    const g = bundle.general || {};
    const items = [];
    if(g.userName) items.push(`User: ${g.userName}`);
    if(g.aiName) items.push(`AI: ${g.aiName}`);
    if(g.temperature !== undefined) items.push(`Temperature: ${normalizeTemperature(g.temperature) ?? "Auto"}`);
    if(g.maxTokens) items.push(`Max Tokens: ${g.maxTokens}`);
    if(g.historyN) items.push(`History N: ${g.historyN}`);
    if(g.numCtx) items.push(`Context Window (num_ctx): ${g.numCtx}`);
    if(g.thinkMode && g.thinkMode !== "auto") items.push(`Thinking: ${g.thinkMode}`);
    if(g.topP) items.push(`top_p: ${g.topP}`);
    if(g.topK) items.push(`top_k: ${g.topK}`);
    if(g.minP) items.push(`min_p: ${g.minP}`);
    if(g.presencePenalty) items.push(`presence_penalty: ${g.presencePenalty}`);

    if(!items.length){
      generalSection.classList.add("hide");
    } else {
      generalSection.classList.remove("hide");
      items.forEach(txt => {
        const badge = document.createElement("span");
        badge.style.cssText = "background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-family:var(--font-mono);font-size:11.5px;color:var(--fg)";
        badge.textContent = txt;
        generalDetails.appendChild(badge);
      });
    }
  }

  m.classList.remove("hide");
}

/* ------------------- Agent configuration import ------------------- */
function importSingleAgentSpec(agentSpec, parentBundle = {}){
  if(!agentSpec || typeof agentSpec !== "object") return null;

  // 1. Determine Agent name
  const firstProv = agentSpec.config?.providers?.[0] || null;
  let agentName = "Shared agent";
  if(agentSpec.name){
    agentName = agentSpec.name.trim();
  } else if(firstProv && firstProv.name){
    agentName = `Agent · ${firstProv.name}`;
  } else if(agentSpec.systemPrompt){
    agentName = agentSpec.systemPrompt.slice(0, 24).trim();
  }

  // 2. Prepare providers
  const rawProvs = agentSpec.config?.providers || [];
  const incomingProviders = [];
  let activeModelForChat = "";
  if(Array.isArray(rawProvs)){
    rawProvs.forEach((p, idx) => {
      const type = p.type || "openai";
      const base = (p.base || "").trim() || defaultBaseForType(type);
      const name = (p.name || "").trim() || defaultNameForType(type);
      const key = (p.key || "").trim();
      const models = p.models || "";
      const headers = (p.headers && typeof p.headers === "object") ? p.headers : (p.headers ? parseCustomHeaders(p.headers) : undefined);
      const provObj = {
        id: `prov_${type}_${Date.now()}_${idx}`,
        type,
        name,
        base,
        key,
        ...(headers ? { headers } : {}),
        models,
        ...(p.protocol ? { protocol: p.protocol } : {}),
        enabled: p.enabled !== false,
        ...(p.proxy ? { proxy: normalizeConnectionProxy(p.proxy) } : {})
      };
      incomingProviders.push(provObj);
      if(!activeModelForChat && models){
        const firstM = models.split("\n").map(x=>x.trim()).filter(Boolean)[0];
        if(firstM){
          const mClean = firstM.split("|")[0].trim();
          activeModelForChat = `${provObj.id}::${mClean}`;
        }
      }
    });
  }

  // 3. Prepare MCP Servers
  const rawMcp = agentSpec.config?.mcpServers || [];
  const incomingMcp = [];
  if(Array.isArray(rawMcp)){
    rawMcp.forEach((s, idx) => {
      const url = (s.url || "").trim();
      if(url){
        const headers = (s.headers && typeof s.headers === "object") ? s.headers : (s.headers ? parseCustomHeaders(s.headers) : undefined);
        incomingMcp.push({
          id: `mcp_${Date.now()}_${idx}`,
          name: (s.name || "Custom MCP").trim(),
          url,
          apiKey: (s.apiKey || "").trim(),
          ...(headers ? { headers } : {}),
          enabled: s.enabled !== false,
          ...(s.proxy ? { proxy: normalizeConnectionProxy(s.proxy) } : {})
        });
      }
    });
  }

  const sysPrompt = agentSpec.systemPrompt ?? "You are a helpful assistant. Answer in the user's language.";
  const temp = normalizeTemperature(agentSpec.temperature);
  const author = (agentSpec.author || parentBundle.author || "").trim();
  const description = (agentSpec.description || "").trim();
  const version = (agentSpec.version || "1.0.0").trim();
  const userName = String(agentSpec.userName || "").trim();
  const variables = normalizeAgentVariables(agentSpec.variables);
  const ephemeral = agentSpec.ephemeral === true;

  // 4. Compute Signature & Check Deduplication
  const probeAgent = {
    name: agentName,
    userName,
    variables,
    author: author,
    description,
    version: version,
    systemPrompt: sysPrompt,
    config: {
      providers: incomingProviders,
      mcpServers: incomingMcp,
      inspectionEnabled: agentSpec.config?.inspectionEnabled !== false
    }
  };
  const signature = computeAgentSignature(probeAgent);

  // Check if an agent with the exact same signature already exists!
  const existingAgent = (state.agents || []).find(t => t.signature === signature);
  if(existingAgent){
    return { agent: existingAgent, isNew: false };
  }

  // 5. Create New agent
  const incomingPrompts = parsePromptButtons(agentSpec.welcomePrompts);

  const agentId = "agent_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  const newAgent = {
    id: agentId,
    name: agentName,
    userName,
    variables,
    author: author,
    description,
    version: version,
    ephemeral: ephemeral,
    signature: signature,
    config: {
      providers: incomingProviders,
      mcpServers: incomingMcp,
      agent: normalizeAgentSettings(agentSpec.config?.agent),
      inspectionEnabled: agentSpec.config?.inspectionEnabled !== false
    },
    systemPrompt: sysPrompt,
    temperature: temp,
    welcomeTitle: (agentSpec.welcomeTitle || "").trim(),
    welcomeDesc: (agentSpec.welcomeDesc || "").trim(),
    welcomePrompts: incomingPrompts,
    chats: []
  };

  if(!Array.isArray(state.agents)) state.agents = [];
  state.agents.push(newAgent);

  // Create the first conversation for this agent
  const firstChatId = uid();
  const firstChat = {
    id: firstChatId,
    title: agentSpec.chatTitle || (sysPrompt ? sysPrompt.slice(0, 30) : t("chat.new.default")),
    model: activeModelForChat || state.lastModel || "",
    agentId: agentId,
    promptMode: "inherit",
    messages: [],
    createdAt: Date.now()
  };
  const initPrompt = agentSpec.initialPrompt;
  if(initPrompt){
    firstChat.messages.push({ role: "user", content: initPrompt, time: Date.now() });
  }
  newAgent.chats.unshift(firstChat);
  if(activeModelForChat) state.lastModel = activeModelForChat;

  return { agent: newAgent, isNew: true };
}

function importConfigBundle(bundle){
  if(!bundle || bundle.v !== 1 || !Array.isArray(bundle.agents) || !bundle.agents.length){
    throw new Error("Expected a v:1 configuration with a nonempty agents array.");
  }
  const rawAgents = bundle.agents;

  const results = [];
  let newAgentsCount = 0;

  rawAgents.forEach(spec => {
    const res = importSingleAgentSpec(spec, bundle);
    if(res && res.agent){
      results.push(res.agent);
      if(res.isNew) newAgentsCount++;
    }
  });

  if(!results.length) return null;

  // Determine which agent to activate
  let agentToActivate = null;
  if(bundle.activeAgent){
    const activeQuery = String(bundle.activeAgent).trim().toLowerCase();
    agentToActivate = results.find(t => t.name.toLowerCase() === activeQuery || t.id === activeQuery)
      || (state.agents || []).find(t => t.name.toLowerCase() === activeQuery || t.id === activeQuery);
  }
  if(!agentToActivate){
    agentToActivate = results[0];
  }

  switchAgent(agentToActivate.id);
  if(typeof isSettingsOpen === "function" && isSettingsOpen()) selectAgentInSettings(agentToActivate.id);

  closeImportModal();

  if(typeof showToast === "function"){
    if(results.length === 1){
      const t = results[0];
      if(newAgentsCount > 0){
        showToast(`✨ Agent created: "${t.name}"`);
      } else {
        showToast(`✨ Switched to existing agent: "${t.name}"`);
      }
    } else {
      showToast(`✨ ${results.length} Agents ready (${newAgentsCount} new, ${results.length - newAgentsCount} existing)`);
    }
  } else {
    flashStatus(results.length === 1 ? `Agent: "${results[0].name}"` : `${results.length} Agents ready`);
  }

  return results;
}

function importBundleToAgent(bundle){
  const res = importConfigBundle(bundle);
  return res ? res[0] : null;
}

function executeSmartMerge(bundle){
  return importBundleToAgent(bundle);
}

/* ------------------- Hash Inspection at Startup ------------------- */
async function checkHashForConfigImport(){
  // Check hash AND query string!
  const hashRaw = window.location.hash ? window.location.hash.slice(1) : "";
  const queryRaw = window.location.search ? window.location.search.slice(1) : "";
  
  const hashParams = new URLSearchParams(hashRaw);
  const queryParams = new URLSearchParams(queryRaw);

  const params = (hashParams.has("enc") || hashParams.has("config") || hashParams.has("provider") || hashParams.has("agent")) ? hashParams : queryParams;

  const hasEnc = params.has("enc");
  const hasConfig = params.has("config");
  const hasProvider = params.has("provider");
  const hasShorthand = hasProvider || params.has("agent");

  if(!hasEnc && !hasConfig && !hasShorthand) return;

  // Instantly strip parameters from browser address bar for absolute privacy
  try {
    history.replaceState(null, "", window.location.pathname);
  } catch(e){}

  if(hasEnc){
    showEncryptedPasswordPrompt(params.get("enc"));
    return;
  }

  if(hasConfig){
    try {
      const jsonStr = base64UrlDecode(params.get("config"));
      const bundle = JSON.parse(jsonStr);
      importBundleToAgent(bundle);
    } catch(err){
      console.warn("Failed to decode configuration bundle from link:", err);
    }
    return;
  }

  if(hasShorthand){
    const pType = params.get("provider") || "openai";
    const agentSpec = {
      name: params.get("agent") || "",
      userName: params.get("user") || "",
      author: params.get("author") || "",
      version: params.get("ver") || "1.0.0",
      ephemeral: ["1","true"].includes(params.get("ephemeral")),
      welcomeTitle: params.get("title") || "",
      welcomeDesc: params.get("desc") || "",
      welcomePrompts: params.get("prompts") || "",
      initialPrompt: params.get("q") || "",
      systemPrompt: params.get("system") || undefined,
      ...(params.has("temp") ? {temperature:normalizeTemperature(params.get("temp"))} : {}),
      config: {
        providers: hasProvider ? [{
          type: pType,
          name: params.get("name") || defaultNameForType(pType),
          base: params.get("base") || defaultBaseForType(pType),
          key: params.get("key") || "",
          models: params.get("models") || params.get("model") || ""
        }] : [],
        mcpServers: params.has("mcp") ? [{
          name: params.get("mcp_name") || "Custom MCP",
          url: params.get("mcp"),
          apiKey: params.get("mcp_key") || ""
        }] : []
      }
    };
    importBundleToAgent({v:1,agents:[agentSpec]});
  }
}

/* ------------------- Share Config Settings Tab ------------------- */
function renderShareSettingsTab(){
  const curAgent = (typeof getCurrentAgent === "function") ? getCurrentAgent() : null;

  // Set Scope details
  const scopeCurrent = document.getElementById("shareScopeCurrent");
  const scopeAll = document.getElementById("shareScopeAll");
  const scopeCurrentName = document.getElementById("shareScopeCurrentName");
  const scopeAllCount = document.getElementById("shareScopeAllCount");
  if(scopeCurrent) scopeCurrent.checked = true;
  if(scopeCurrentName) scopeCurrentName.textContent = curAgent ? curAgent.name : "Default";
  if(scopeAllCount) scopeAllCount.textContent = (state.agents || []).length;

  const agentNameWrap = document.getElementById("shareSingleAgentNameWrap");
  if(agentNameWrap) agentNameWrap.style.display = "";

  const checklistWrap = document.getElementById("shareProvidersChecklist")?.closest("div");
  if(checklistWrap) checklistWrap.style.display = "";

  const checklist = document.getElementById("shareProvidersChecklist");
  const providers = (curAgent?.config?.providers) || [];
  if(checklist){
    checklist.innerHTML = "";
    if(!providers.length){
      checklist.innerHTML = `<span style="color:var(--fg-3);font-size:12px">${escapeHtml(t("share.empty.providers"))}</span>`;
    } else {
      providers.forEach(p => {
        const item = document.createElement("label");
        item.className = "share-checklist-item";
        item.innerHTML = `
          <input type="checkbox" class="share-prov-chk" data-prov-id="${escapeHtml(p.id)}" checked />
          <span class="share-item-name">${escapeHtml(p.name)}</span>
          <span class="share-item-type">${escapeHtml(p.type)}</span>
        `;
        checklist.appendChild(item);
      });
    }
  }

  const mcpCountEl = document.getElementById("shareMcpCount");
  const mcpServers = (curAgent?.config?.mcpServers) || state.config.mcpServers || [];
  if(mcpCountEl) mcpCountEl.textContent = mcpServers.length;
  const mcpRow = document.getElementById("shareMcpRow");
  if(mcpRow) mcpRow.style.display = mcpServers.length ? "" : "none";

  const wsInp = document.getElementById("shareWorkspaceInput");
  if(wsInp){
    wsInp.value = curAgent?.name || "Shared agent";
  }
  const description = document.getElementById("shareAgentDescription");
  if(description) description.textContent = `Share the AI, instructions and tools of ${curAgent?.name || "this agent"}.`;

  // Reset inputs
  const incKeys = document.getElementById("shareIncludeKeys");
  if(incKeys) incKeys.checked = false;
  const protPass = document.getElementById("shareProtectPassword");
  if(protPass) protPass.checked = false;
  const passWrap = document.getElementById("sharePasswordWrap");
  if(passWrap) passWrap.classList.add("hide");
  const passInput = document.getElementById("sharePasswordInput");
  if(passInput) passInput.value = "";
  const resWrap = document.getElementById("shareResultWrap");
  if(resWrap) resWrap.classList.add("hide");
}

function openShareConfigModal(){
  if(typeof openSettings === "function"){
    openSettings("share");
  } else {
    renderShareSettingsTab();
  }
}

function closeShareConfigModal(){}

async function handleGenerateShareLink(){
  const isAllScope = !!document.getElementById("shareScopeAll")?.checked;
  const curAgent = (typeof getCurrentAgent === "function") ? getCurrentAgent() : null;
  const includeKeys = !!document.getElementById("shareIncludeKeys")?.checked;
  const includeMcp = !!document.getElementById("shareIncludeMcp")?.checked;
  const includePrompt = !!document.getElementById("shareIncludePrompt")?.checked;
  const includeWelcome = !!document.getElementById("shareIncludeWelcome")?.checked;
  const protectPass = !!document.getElementById("shareProtectPassword")?.checked;
  const password = (document.getElementById("sharePasswordInput")?.value || "").trim();

  if(protectPass && !password){
    alert("Please enter an unlock password, or uncheck password protection.");
    document.getElementById("sharePasswordInput")?.focus();
    return;
  }

  let bundle = null;

  if(isAllScope){
    // Export all agent configurations
    const agentsList = (state.agents || []).map(agent => {
      const provs = (agent.config?.providers || []).map(p => ({
        type: p.type,
        name: p.name,
        base: p.base,
        key: includeKeys ? (p.key || "") : "",
        ...(includeKeys && p.headers ? { headers: p.headers } : {}),
        models: p.models || "",
        enabled: p.enabled !== false,
        protocol: p.protocol,
        ...exportConnectionProxy(p, includeKeys)
      }));

      const mcps = includeMcp ? (agent.config?.mcpServers || []).map(s => ({
        name: s.name,
        url: s.url,
        apiKey: includeKeys ? (s.apiKey || "") : "",
        ...(includeKeys && s.headers ? { headers: s.headers } : {}),
        enabled: s.enabled,
        ...exportConnectionProxy(s, includeKeys)
      })) : [];

      return {
        name: agent.name,
        userName: agent.userName || "",
        variables: normalizeAgentVariables(agent.variables),
        author: agent.author || "",
        description: agent.description || "",
        version: agent.version || "1.0.0",
        ephemeral: !!agent.ephemeral,
        welcomeTitle: includeWelcome ? (agent.welcomeTitle || "") : "",
        welcomeDesc: includeWelcome ? (agent.welcomeDesc || "") : "",
        welcomePrompts: includeWelcome ? (agent.welcomePrompts || []) : [],
        config: {
          providers: provs,
          agent: normalizeAgentSettings(agent.config?.agent || {}),
          inspectionEnabled: agent.config?.inspectionEnabled !== false,
          mcpServers: mcps
        },
        systemPrompt: includePrompt ? (agent.systemPrompt || "") : "",
        temperature: normalizeTemperature(agent.temperature)
      };
    });

    bundle = {
      v: 1,
      author: curAgent?.author || "",
      activeAgent: curAgent?.name || agentsList[0]?.name,
      agents: agentsList
    };
  } else {
    // Export the selected agent configuration
    const providers = getProviders();
    const checkedProvIds = Array.from(document.querySelectorAll(".share-prov-chk:checked")).map(el => el.dataset.provId);
    const selectedProviders = providers
      .filter(p => checkedProvIds.includes(p.id))
      .map(p => ({
        type: p.type,
        name: p.name,
        base: p.base,
        key: includeKeys ? (p.key || "") : "",
        ...(includeKeys && p.headers ? { headers: p.headers } : {}),
        models: p.models || "",
        enabled: p.enabled !== false,
        protocol: p.protocol,
        ...exportConnectionProxy(p, includeKeys)
      }));

    const welcomeTitle = (curAgent?.welcomeTitle || state.general.welcomeTitle || "").trim();
    const welcomeDesc = (curAgent?.welcomeDesc || state.general.welcomeDesc || "").trim();
    const welcomePrompts = (curAgent?.welcomePrompts && curAgent.welcomePrompts.length)
      ? curAgent.welcomePrompts
      : (state.general.welcomePrompts || []);
    const agentName = (document.getElementById("shareWorkspaceInput")?.value || "").trim() || (curAgent ? curAgent.name : "Shared agent");

    const singleAgentObj = {
      name: agentName,
      userName: curAgent?.userName || "",
      variables: normalizeAgentVariables(curAgent?.variables),
      author: curAgent?.author || "",
      description: curAgent?.description || "",
      version: curAgent?.version || "1.0.0",
      ephemeral: !!curAgent?.ephemeral,
      ...(includeWelcome && welcomeTitle ? { welcomeTitle } : {}),
      ...(includeWelcome && welcomeDesc ? { welcomeDesc } : {}),
      ...(includeWelcome && welcomePrompts.length ? { welcomePrompts } : {}),
      config: {
        providers: selectedProviders,
        inspectionEnabled: curAgent?.config?.inspectionEnabled !== false,
        agent: structuredClone(curAgent?.config?.agent || state.toolSettings),
        mcpServers: includeMcp ? ((curAgent?.config?.mcpServers) || state.config.mcpServers || []).map(s => ({
          name: s.name,
          url: s.url,
          apiKey: includeKeys ? (s.apiKey || "") : "",
          ...(includeKeys && s.headers ? { headers: s.headers } : {}),
          enabled: s.enabled,
          ...exportConnectionProxy(s, includeKeys)
        })) : []
      },
      systemPrompt: includePrompt ? (curAgent?.systemPrompt || state.general.systemPrompt || "") : "",
      temperature: normalizeTemperature(curAgent?.temperature)
    };

    bundle = {
      v: 1,
      author: curAgent?.author || "",
      activeAgent: agentName,
      agents: [ singleAgentObj ]
    };
  }

  const jsonStr = JSON.stringify(bundle);
  let hashFragment = "";

  if(protectPass && password){
    const encStr = await encryptConfig(jsonStr, password);
    hashFragment = `#enc=${encStr}`;
  } else {
    const b64 = base64UrlEncode(jsonStr);
    hashFragment = `#config=${b64}`;
  }

  const baseUrl = window.location.origin + window.location.pathname;
  const fullUrl = `${baseUrl}${hashFragment}`;

  const resWrap = document.getElementById("shareResultWrap");
  const resInput = document.getElementById("shareResultInput");
  if(resWrap) resWrap.classList.remove("hide");
  if(resInput){
    resInput.value = fullUrl;
    resInput.select();
  }
}

/* ------------------- Module Event Wiring ------------------- */
function initConfigShareWiring(){
  // Import modal buttons
  const closeImpBtn = document.getElementById("closeImportConfigBtn");
  if(closeImpBtn) closeImpBtn.onclick = closeImportModal;
  const cancelImpBtn = document.getElementById("cancelImportConfigBtn");
  if(cancelImpBtn) cancelImpBtn.onclick = closeImportModal;
  const confirmImpBtn = document.getElementById("confirmImportConfigBtn");
  if(confirmImpBtn) confirmImpBtn.onclick = () => executeSmartMerge(_pendingImportBundle);

  // Decrypt button
  const unlockBtn = document.getElementById("importUnlockBtn");
  const passInput = document.getElementById("importPasswordInput");
  const doUnlock = async () => {
    const pw = (passInput ? passInput.value : "").trim();
    const errEl = document.getElementById("importPasswordError");
    if(errEl) errEl.classList.add("hide");
    if(!pw){
      if(errEl){ errEl.textContent = "Please enter password"; errEl.classList.remove("hide"); }
      return;
    }
    unlockBtn.disabled = true;
    try {
      const decryptedJson = await decryptConfig(_pendingEncryptedData, pw);
      const bundle = JSON.parse(decryptedJson);
      closeImportModal();
      importConfigBundle(bundle);
    } catch(err){
      if(errEl){
        errEl.textContent = t("import.enc.error");
        errEl.classList.remove("hide");
      }
    } finally {
      unlockBtn.disabled = false;
    }
  };
  if(unlockBtn) unlockBtn.onclick = doUnlock;
  if(passInput){
    passInput.addEventListener("keydown", (e) => {
      if(e.key === "Enter"){ e.preventDefault(); doUnlock(); }
    });
  }

  // Share scope toggle wiring
  const scopeCurrent = document.getElementById("shareScopeCurrent");
  const scopeAll = document.getElementById("shareScopeAll");
  const updateScopeUI = () => {
    const isAll = !!(scopeAll && scopeAll.checked);
    const agentNameWrap = document.getElementById("shareSingleAgentNameWrap");
    const checklistWrap = document.getElementById("shareProvidersChecklist")?.closest("div");
    if(agentNameWrap) agentNameWrap.style.display = isAll ? "none" : "";
    if(checklistWrap) checklistWrap.style.display = isAll ? "none" : "";
  };
  if(scopeCurrent) scopeCurrent.onchange = updateScopeUI;
  if(scopeAll) scopeAll.onchange = updateScopeUI;

  // Share modal buttons
  const shareBtn = document.getElementById("shareConfigModalBtn");
  if(shareBtn) shareBtn.onclick = openShareConfigModal;
  const closeShareBtn = document.getElementById("closeShareConfigBtn");
  if(closeShareBtn) closeShareBtn.onclick = closeShareConfigModal;
  const cancelShareBtn = document.getElementById("cancelShareConfigBtn");
  if(cancelShareBtn) cancelShareBtn.onclick = closeShareConfigModal;

  const protChk = document.getElementById("shareProtectPassword");
  if(protChk){
    protChk.onchange = () => {
      const wrap = document.getElementById("sharePasswordWrap");
      if(wrap) wrap.classList.toggle("hide", !protChk.checked);
      if(protChk.checked) document.getElementById("sharePasswordInput")?.focus();
    };
  }

  const genBtn = document.getElementById("generateShareLinkBtn");
  if(genBtn) genBtn.onclick = handleGenerateShareLink;

  const copyBtn = document.getElementById("shareCopyBtn");
  if(copyBtn){
    copyBtn.onclick = () => {
      const input = document.getElementById("shareResultInput");
      if(!input) return;
      navigator.clipboard.writeText(input.value).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = t("share.copied");
        setTimeout(() => { copyBtn.textContent = orig; }, 1800);
      }).catch(() => {
        input.select();
        document.execCommand("copy");
      });
    };
  }
}
