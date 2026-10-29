/* Agent identity and a deliberately bounded prompt-template vocabulary. */
function getAgentForChat(chat){
  const agents = state.agents || [];
  const owner = chat && agents.find(agent => (agent.chats || []).includes(chat));
  if(owner){ chat.agentId=owner.id; return owner; }
  return agents.find(agent => chat?.agentId && agent.id === chat.agentId)
    || agents.find(agent => chat?.id && (agent.chats || []).some(item => item.id === chat.id))
    || getCurrentAgent();
}

function getProviderForChat(chat,providerId){
  return getAgentForChat(chat).config?.providers?.find(item => item.id === providerId);
}

function resolvedIdentity(agent = getCurrentAgent()){
  return {
    agentName: String(agent?.name || "").trim() || "Assistant",
    userName: String(state.general?.userName || "").trim() || String(agent?.userName || "").trim()
  };
}

function agentInstructionsTemplate(chat, agent = getAgentForChat(chat)){
  if(chat?.promptMode === "inherit") return agent.systemPrompt || "";
  return chat?.systemPrompt !== undefined ? chat.systemPrompt : agent.systemPrompt ?? state.general?.systemPrompt ?? "";
}

function createPromptContext(chat, {agent = getAgentForChat(chat), modelId = chat?.model || state.lastModel || "", now = new Date()} = {}){
  const identity = resolvedIdentity(agent);
  const separator = modelId.indexOf("::");
  const providerId = separator < 0 ? modelId : modelId.slice(0,separator);
  const provider = agent.config?.providers?.find(item => item.id === providerId);
  const pad = value => String(value).padStart(2,"0");
  const values = {
    "user.name": identity.userName,
    "agent.name": identity.agentName,
    "agent.description": agent.description || "",
    "agent.version": agent.version || "1.0.0",
    "now.date": `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,
    "now.time": `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    "now.datetime": now.toISOString(),
    "now.timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    "model.id": separator < 0 ? modelId : modelId.slice(separator+2),
    "provider.name": provider?.name || "",
    "app.version": getAppVersion(),
    "app.edition": appEditionName()
  };
  for(const [key,value] of Object.entries(normalizeAgentVariables(agent.variables))) values[`vars.${key}`] = value;
  return {agent, values, template:agentInstructionsTemplate(chat,agent)};
}

function resolvePromptTemplate(template, values){
  const unknown = new Set();
  const text = String(template || "").replace(/(\\)?\{\{([^{}]+)\}\}/g, (match,escaped,key) => {
    if(escaped) return match.slice(1);
    const name = key.trim();
    if(!Object.hasOwn(values,name)){ unknown.add(name); return match; }
    return String(values[name]); // One pass: values cannot inject further substitutions.
  });
  return {text, unknown:[...unknown]};
}

function captureRequestPromptContext(chat,modelId){
  const context = createPromptContext(chat,{modelId});
  Object.defineProperty(chat,"_promptContext",{value:context,writable:true,configurable:true,enumerable:false});
  return context;
}
