/* ------------------------- Persistence ------------------------- */
function mergePreconfiguredState(target, source){
  if(!source || typeof source !== "object") return;
  if(source.theme) target.theme = source.theme;
  if(Array.isArray(source.notes)) target.notes = structuredClone(source.notes);
  if(source.lastModel) target.lastModel = source.lastModel;
  if(source.activeAgentId) target.activeAgentId = source.activeAgentId;
  if(Array.isArray(source.agents) && source.agents.length){
    target.agents = structuredClone(source.agents);
    if(!target.agents.some(agent => agent.id === target.activeAgentId)){
      target.activeAgentId = target.agents[0].id;
    }
  }
  if(source.general && typeof source.general === "object"){
    Object.assign(target.general, source.general);
  }
}

function loadState(){
  try{
    // Force-override if preset specifies _force: true
    if(typeof PRECONFIGURED_STATE !== "undefined" && PRECONFIGURED_STATE && PRECONFIGURED_STATE._force){
      console.log("⚡ Force-applying build-time preconfigured state...");
      const seeded = structuredClone(DEFAULT_STATE);
      mergePreconfiguredState(seeded, PRECONFIGURED_STATE);
      normalizeStateProviders(seeded);
      defineStateAccessors(seeded);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(cloneStateForStorage(seeded)));
      } catch(e) {}
      return seeded;
    }

    let raw = localStorage.getItem(LS_KEY);

    // If no existing state in localStorage, but a preconfigured state was embedded at build-time, use it!
    if(!raw && typeof PRECONFIGURED_STATE !== "undefined" && PRECONFIGURED_STATE){
      console.log("⚡ Initializing tabs.chat with build-time preconfigured state...");
      const seeded = structuredClone(DEFAULT_STATE);
      mergePreconfiguredState(seeded, PRECONFIGURED_STATE);
      normalizeStateProviders(seeded);
      defineStateAccessors(seeded);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(cloneStateForStorage(seeded)));
      } catch(e) {}
      return seeded;
    }

    if(!raw){
      const s = structuredClone(DEFAULT_STATE);
      defineStateAccessors(s);
      return s;
    }

    const s = JSON.parse(raw);
    s.lang = "en";

    // Ensure there is an agent to select
    if(!Array.isArray(s.agents) || !s.agents.length){
      const defaultAgent = createDefaultAgent("Default");
      defaultAgent.signature = computeAgentSignature(defaultAgent);
      s.agents = [defaultAgent];
      s.activeAgentId = defaultAgent.id;
    }

    if(!s.activeAgentId || !s.agents.some(t => t.id === s.activeAgentId)){
      s.activeAgentId = s.agents[0].id;
    }

    s.agents.forEach(agent => {
      if(!agent.id) agent.id = "agent_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
      if(!agent.name) agent.name = "Default";
      if(!agent.author) agent.author = "";
      if(!agent.description) agent.description = "";
      if(!agent.version) agent.version = "1.0.0";
      agent.ephemeral = !!agent.ephemeral;
      if(!agent.config) agent.config = { providers: [], mcpServers: [] };
      if(!Array.isArray(agent.config.providers)) agent.config.providers = [];
      if(!Array.isArray(agent.config.mcpServers)) agent.config.mcpServers = [];
      if(!Array.isArray(agent.chats)) agent.chats = [];
      normalizeAgentDefinition(agent);
      if(!agent.systemPrompt && agent.systemPrompt !== "") agent.systemPrompt = "You are a helpful assistant. Answer in the user's language.";
      if(!agent.welcomeTitle) agent.welcomeTitle = "";
      if(!agent.welcomeDesc) agent.welcomeDesc = "";
      if(!Array.isArray(agent.welcomePrompts)) agent.welcomePrompts = [];
      if(!agent.signature) agent.signature = computeAgentSignature(agent);
      normalizeAgentProviders(agent);
    });

    const loaded = Object.assign(structuredClone(DEFAULT_STATE), s, {
      agents: s.agents,
      activeAgentId: s.activeAgentId,
      general: Object.assign(structuredClone(DEFAULT_STATE.general), s.general||{}),
      trash: Array.isArray(s.trash) ? s.trash : []
    });

    defineStateAccessors(loaded);
    return loaded;
  }catch(e){
    console.error("Failed to load state from localStorage:", e);
    const fallback = structuredClone(DEFAULT_STATE);
    defineStateAccessors(fallback);
    return fallback;
  }
}

function isQuotaExceeded(e){
  return e && (e.name==="QuotaExceededError" || e.name==="NS_ERROR_DOM_QUOTA_REACHED" || e.code===22 || e.code===1014);
}

function cloneStateForStorage(targetState){
  const base = targetState || state;
  const savedAgents = (base.agents || []).filter(agent => !agent.ephemeral).map(agent => ({
    id: agent.id,
    name: agent.name,
    userName: agent.userName || "",
    variables: normalizeAgentVariables(agent.variables),
    author: agent.author || "",
    description: agent.description || "",
    version: agent.version || "1.0.0",
    signature: agent.signature || computeAgentSignature(agent),
    config: {
      providers: agent.config?.providers || [],
      mcpServers: agent.config?.mcpServers || [],
      agent: normalizeAgentSettings(agent.config?.agent || {}),
      inspectionEnabled: agent.config?.inspectionEnabled !== false
    },
    systemPrompt: agent.systemPrompt || "",
    temperature: normalizeTemperature(agent.temperature),
    welcomeTitle: agent.welcomeTitle || "",
    welcomeDesc: agent.welcomeDesc || "",
    welcomePrompts: agent.welcomePrompts || [],
    chats: (agent.chats || []).map(c => ({
      id: c.id,
      title: c.title,
      model: c.model,
      systemPrompt: c.systemPrompt,
      promptMode: c.promptMode,
      agentId: agent.id,
      enableSystemPrompt: c.enableSystemPrompt,
      contextSummary: c.contextSummary,
      memoryHistory: c.memoryHistory,
      disableAutoMemory: c.disableAutoMemory,
      messages: (c.messages || []).map(m => {
        const clean = { role: m.role, content: m.content, time: m.time };
        if(m.attachments && m.attachments.length) clean.attachments = m.attachments;
        if(m.reasoning) clean.reasoning = m.reasoning;
        if(m.notice) clean.notice = m.notice;
        return clean;
      }),
      createdAt: c.createdAt,
      pinned: c.pinned
    }))
  }));

  const s = {
    schemaVersion: 1,
    theme: base.theme || "system",
    lang: "en",
    activeAgentId: (base.activeAgentId && savedAgents.some(t => t.id === base.activeAgentId))
      ? base.activeAgentId
      : (savedAgents[0]?.id || "agent_default"),
    agents: savedAgents.length ? savedAgents : [createDefaultAgent("Default")],
    notes: (base.notes || []).map(note => ({ ...note, agentId: savedAgents.some(agent => agent.id === note.agentId) ? note.agentId : null })),
    trash: (base.trash || []).slice(0, 50),
    general: base.general,
    lastModel: base.lastModel || ""
  };
  return s;
}

function saveState(){
  try{
    const payload = JSON.stringify(cloneStateForStorage());
    localStorage.setItem(LS_KEY, payload);
    return true;
  }catch(e){
    if(isQuotaExceeded(e)){
      console.warn("tabs.chat state was too large for localStorage; pruning reasoning and attachments.");
      try{
        const slim = cloneStateForStorage();
        for(const agent of (slim.agents || [])){
          for(const chat of (agent.chats || [])){
            for(const m of (chat.messages || [])){
              delete m.reasoning;
              delete m.attachments;
            }
          }
        }
        localStorage.setItem(LS_KEY, JSON.stringify(slim));
        return true;
      }catch(err){
        console.error("Failed to save state even after pruning:", err);
      }
    }
    console.error("Failed to save tabs.chat state:", e);
    return false;
  }
}

state = loadState();
