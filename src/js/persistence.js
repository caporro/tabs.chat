/* ------------------------- Persistence ------------------------- */
function loadState(){
  try{
    let raw = localStorage.getItem(LS_KEY);
    if(!raw) return structuredClone(DEFAULT_STATE);
    const s = JSON.parse(raw);
    s.lang = "en";
    normalizeStateProviders(s);
    // shallow merge defaults
    const cfg = Object.assign(structuredClone(DEFAULT_STATE.config), s.config||{});
    if(!Array.isArray(cfg.mcpServers)) cfg.mcpServers = [];
    return Object.assign(structuredClone(DEFAULT_STATE), s, {
      config: cfg,
      agent: Object.assign(structuredClone(DEFAULT_STATE.agent), s.agent||{}),
      general: Object.assign(structuredClone(DEFAULT_STATE.general), s.general||{}),
      notepad: Object.assign(structuredClone(DEFAULT_STATE.notepad), s.notepad||{}),
      trash: Array.isArray(s.trash) ? s.trash : [],
    });
  }catch(e){ console.error(e); return structuredClone(DEFAULT_STATE); }
}
function isQuotaExceeded(e){
  return e && (e.name==="QuotaExceededError" || e.name==="NS_ERROR_DOM_QUOTA_REACHED" || e.code===22 || e.code===1014);
}
function cloneStateForStorage(keepAttachmentMessages){
  const s = structuredClone(state);
  const keep = Math.max(0, Number(keepAttachmentMessages)||0);
  for(const chat of (s.chats||[])){
    const msgs = chat.messages||[];
    const withAttachments = msgs.filter(m => (m.attachments||[]).length);
    const keepSet = new Set(withAttachments.slice(-keep));
    for(const m of msgs){
      if((m.attachments||[]).length && !keepSet.has(m)) delete m.attachments;
    }
  }
  for(const chat of (s.trash||[])){
    for(const m of (chat.messages||[])){
      if((m.attachments||[]).length) delete m.attachments;
    }
  }
  return s;
}
function saveState(){
  const configuredKeep = Math.max(0, Number(state.general?.attachmentKeepRecent ?? 1)||0);
  const attempts = [...new Set([configuredKeep, 1, 0])];
  let lastErr = null;
  for(const keep of attempts){
    try{
      localStorage.setItem(LS_KEY, JSON.stringify(cloneStateForStorage(keep)));
      return true;
    }catch(e){
      lastErr = e;
      if(!isQuotaExceeded(e)) break;
    }
  }
  console.warn("AChat state was too large for localStorage; dropped persisted attachment payloads.", lastErr);
  try{
    const slim = cloneStateForStorage(0);
    for(const chat of (slim.chats||[])){
      for(const m of (chat.messages||[])) delete m.reasoning;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(slim));
    return true;
  }catch(e){
    console.error("Failed to save AChat state.", e);
    return false;
  }
}

