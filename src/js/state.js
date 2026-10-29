/* ============================================================
   tabs.chat — Single-file multi-provider chat UI
   ============================================================ */

const LS_KEY = "tabschat_v1";
const APP_VERSION = "__APP_VERSION__";
function getAppVersion(){
  return (typeof APP_VERSION !== "undefined" && !APP_VERSION.startsWith("__")) ? APP_VERSION : "0.3.2-beta.1";
}
const PRECONFIGURED_STATE = /* __PRECONFIGURED_STATE__ */ null;
const detectLang = () => "en";

function normalizeTemperature(value){
  if(value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  if(typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeAgentVariables(source){
  if(!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source).filter(([key,value]) =>
    /^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !["constructor","prototype"].includes(key) &&
    ["string","number","boolean"].includes(typeof value)
  ).sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) => [key,String(value)]));
}

function normalizeAgentDefinition(agent){
  agent.temperature = normalizeTemperature(agent.temperature);
  agent.userName = typeof agent.userName === "string" ? agent.userName.trim() : "";
  agent.variables = normalizeAgentVariables(agent.variables);
  for(const chat of agent.chats || []){
    chat.agentId = agent.id;
    if(!["inherit","override"].includes(chat.promptMode)) chat.promptMode = "inherit";
  }
  return agent;
}

function computeAgentSignature(agent){
  if(!agent) return "";
  const name = (agent.name || "").trim().toLowerCase();
  const author = (agent.author || "").trim().toLowerCase();
  const version = (agent.version || "").trim();
  const sysPrompt = (agent.systemPrompt || "").trim();

  const provs = ((agent.config && agent.config.providers) || []).map(p => ({
    type: (p.type || "openai").trim().toLowerCase(),
    base: (p.base || "").trim().replace(/\/+$/, "").toLowerCase(),
    name: (p.name || "").trim().toLowerCase(),
    models: (p.models || "").trim(),
    key: (p.key || "").trim(),
    ...(p.proxy ? { proxy: { enabled: p.proxy.enabled === true, url: typeof p.proxy.url === "string" ? p.proxy.url.trim() : "" } } : {})
  })).sort((a,b) => (a.type + a.base + a.name).localeCompare(b.type + b.base + b.name));

  const mcps = ((agent.config && agent.config.mcpServers) || []).map(s => ({
    url: (s.url || "").trim().replace(/\/+$/, "").toLowerCase(),
    name: (s.name || "").trim().toLowerCase(),
    apiKey: (s.apiKey || "").trim(),
    ...(s.proxy ? { proxy: { enabled: s.proxy.enabled === true, url: typeof s.proxy.url === "string" ? s.proxy.url.trim() : "" } } : {})
  })).sort((a,b) => a.url.localeCompare(b.url));

  const description = (agent.description || "").trim();
  const variables = normalizeAgentVariables(agent.variables);
  const canonicalObj = { name, author, version, sysPrompt, provs, mcps, ...(description ? { description } : {}), ...(agent.config?.inspectionEnabled === false ? { inspectionEnabled: false } : {}), ...(agent.userName?.trim() ? {userName:agent.userName.trim()} : {}), ...(Object.keys(variables).length ? {variables} : {}) };
  const str = JSON.stringify(canonicalObj);
  let hash = 2166136261;
  for(let i = 0; i < str.length; i++){
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "sig_" + (hash >>> 0).toString(16);
}

function createDefaultAgent(name = "Default", config = null, systemPrompt = null, meta = {}){
  const agent = {
    id: "agent_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    name: (name || "Default").trim(),
    userName: typeof meta.userName === "string" ? meta.userName.trim() : "",
    variables: normalizeAgentVariables(meta.variables),
    author: (meta.author || "").trim(),
    description: (meta.description || "").trim(),
    version: (meta.version || "1.0.0").trim(),
    ephemeral: !!meta.ephemeral,
    signature: "",
    config: config || {
      providers: [],
      mcpServers: []
    },
    systemPrompt: systemPrompt || "You are a helpful assistant. Answer in the user's language.",
    temperature: null,
    welcomeTitle: "",
    welcomeDesc: "",
    welcomePrompts: [],
    chats: []
  };
  agent.signature = computeAgentSignature(agent);
  return agent;
}

const DEFAULT_TOOL_SETTINGS = {
  enabled: true,
  maxTurns: 10,
  autoApprove: true,
  builtInTools: { datetime: true, web_fetch: true, calculator: true, notepad: true }
};

const DEFAULT_STATE = {
  theme: "system",
  lang: "en",
  activeAgentId: "agent_default",
  agents: [
    {
      id: "agent_default",
      name: "Default",
      userName: "",
      variables: {},
      author: "",
      description: "",
      version: "1.0.0",
      ephemeral: false,
      signature: "sig_default",
      config: {
        providers: [],
        mcpServers: []
      },
      systemPrompt: "You are a helpful assistant. Answer in the user's language.",
      temperature: null,
      welcomeTitle: "",
      welcomeDesc: "",
      welcomePrompts: [],
      chats: []
    }
  ],
  trash: [],
  notes: [],
  activeChatId: null,
  general: {
    enablePlatformPrompt: true,
    enableSystemPrompt: true,
    systemPrompt: "You are a helpful assistant. Answer in the user's language.",
    temperature: null,
    maxTokens: "",
    topP: "", topK: "", minP: "", presencePenalty: "",
    thinkMode: "auto",
    numCtx: "",
    keepAlive: "30m",
    contextTokenBudget: "",
    historyN: 40,
    showThinking: true,
    userName: "",
    scenarioAutoCompress: true,
    scenarioCompressChars: 4000,
    scenarioMemoryMaxChars: 800,
    imageDetail: "standard",
    attachmentKeepRecent: 1,
    welcomeTitle: "",
    welcomeDesc: "",
    welcomePrompts: []
  },
  lastModel: ""
};

function normalizeAgentSettings(source = {}){
  const settings = Object.assign(structuredClone(DEFAULT_TOOL_SETTINGS), source || {});
  settings.builtInTools = Object.assign({}, DEFAULT_TOOL_SETTINGS.builtInTools, source?.builtInTools || {});
  return settings;
}

function getCurrentAgent(){
  if(!state || !Array.isArray(state.agents) || state.agents.length === 0){
    if(!state) state = structuredClone(DEFAULT_STATE);
    else if(!Array.isArray(state.agents) || state.agents.length === 0){
      state.agents = [createDefaultAgent("Default")];
      state.activeAgentId = state.agents[0].id;
    }
  }
  let agent = state.agents.find(t => t.id === state.activeAgentId);
  if(!agent){
    agent = state.agents[0];
    state.activeAgentId = agent.id;
  }
  if(!agent.config) agent.config = { providers: [], mcpServers: [] };
  if(!Array.isArray(agent.config.providers)) agent.config.providers = [];
  if(!Array.isArray(agent.config.mcpServers)) agent.config.mcpServers = [];
  if(!agent.config.agent) agent.config.agent = normalizeAgentSettings();
  if(!Array.isArray(agent.chats)) agent.chats = [];
  return agent;
}

// Merge imported notes without discarding conflicting IDs.
function mergeNoteArchive(target, incoming, defaultAgentId = null){
  if(!Array.isArray(target.notes)) target.notes = [];
  for(const item of Array.isArray(incoming) ? incoming : []){
    if(!item || typeof item !== "object") continue;
    const note = { ...item, agentId: item.agentId === undefined ? defaultAgentId : item.agentId };
    const existing = target.notes.find(saved => saved.id && saved.id === note.id);
    if(target.notes.some(saved => (saved.id === note.id || saved.importedId === note.id) && saved.title === note.title && saved.body === note.body && saved.agentId === note.agentId)) continue;
    if(!note.id || existing){ note.importedId = note.id; note.id = "note_" + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)); }
    target.notes.push(note);
  }
}

function normalizeNoteArchive(target){
  if(!Array.isArray(target.notes)) target.notes = [];
  const ids = new Set((target.agents || []).map(agent => agent.id));
  target.notes.forEach(note => { if(!ids.has(note.agentId)) note.agentId = null; });
}

function notesForAgent(agentId, target = state){
  return (target.notes || []).filter(note => !note.agentId || note.agentId === agentId);
}

// These views address the currently selected agent; agents remains the source of truth.
function defineStateAccessors(s){
  if(!s) return s;
  normalizeNoteArchive(s);
  (s.agents || []).forEach(agent => {
    normalizeAgentDefinition(agent);
    if(!agent.config) agent.config = { providers: [], mcpServers: [] };
    agent.config.agent = normalizeAgentSettings(agent.config.agent);
  });
  Object.defineProperties(s, {
    toolSettings: {
      get() {
        const agent = s.agents.find(item => item.id === s.activeAgentId) || s.agents[0];
        return agent?.config.agent || normalizeAgentSettings();
      },
      set(value) {
        const agent = s.agents.find(item => item.id === s.activeAgentId) || s.agents[0];
        if(agent) agent.config.agent = normalizeAgentSettings(value);
      },
      configurable: true
    },
    config: {
      get() { return getCurrentAgent().config; },
      set(value) { getCurrentAgent().config = value || { providers: [], mcpServers: [] }; },
      configurable: true
    },
    chats: {
      get() { return getCurrentAgent().chats; },
      set(value) { getCurrentAgent().chats = Array.isArray(value) ? value : []; },
      configurable: true
    }
  });
  return s;
}

let state = structuredClone(DEFAULT_STATE);
defineStateAccessors(state);
