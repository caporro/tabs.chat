/* ---------------- Ollama Provider Helpers ---------------- */

function buildOpenAIMessages(chat, opts, cfg){
  const out = [];
  const sys = effectiveSystemPrompt(chat);
  if(sys) out.push({role:"system", content:sys});
  const msgs = lastN(chat.messages, chat);
  const allowAttach = computeAttachmentAllowSet(msgs);
  for(const m of msgs){
    if(m.role==="tool"){
      out.push({role:"tool", tool_call_id: m.tool_call_id || "call_1", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)});
      continue;
    }
    if(m.role==="assistant"){
      const content = assistantRequestContent(m);
      const msgObj = {role:"assistant"};
      if(m.tool_calls && m.tool_calls.length){
        msgObj.tool_calls = m.tool_calls.map(tc => ({
          id: tc.id || "call_1",
          type: "function",
          function: {
            name: tc.function?.name,
            arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
          }
        }));
        msgObj.content = content || null;
      } else {
        if(!content) continue;
        msgObj.content = content;
      }
      out.push(msgObj);
      continue;
    }
    // user
    const parts = [];
    let txt = m.content||"";
    const attachments = allowAttach.has(m) ? (m.attachments||[]) : [];
    const fileTexts = attachments.filter(a=>a.kind==="file" && a.text);
    if(fileTexts.length){
      txt += "\n\n" + fileTexts.map(f=>`${t("attach.label", f.name)}\n${f.text}`).join("\n\n");
    }
    const images = attachments.filter(a=>a.kind==="image" && a.dataUrl);
    if(images.length){
      parts.push({type:"text", text:txt});
      for(const img of images) parts.push({type:"image_url", image_url:{url:img.dataUrl, detail: img.detail || "auto"}});
      out.push({role:"user", content:parts});
    }else{
      out.push({role:"user", content:txt});
    }
  }
  // 丢弃错误轮次后可能留下连续 user 消息；部分本地 chat template
  // （Gemma / Mistral 系）会直接报 "roles must alternate"。合并掉。
  const merged = mergeAdjacentRoles(out, (a,b)=>{
    const parts = v => Array.isArray(v) ? v : [{type:"text", text:String(v||"")}];
    if(typeof a.content === "string" && typeof b.content === "string"){
      a.content = [a.content, b.content].filter(Boolean).join("\n\n");
    }else{
      a.content = [...parts(a.content), ...parts(b.content)];
    }
  });
  return merged;
}

/* -------- Controlla se il modello è attualmente caricato in memoria (VRAM/RAM) -------- */
async function checkOllamaLoaded(cfg, modelName){
  if(!cfg || !cfg.base) return null;
  const base = cfg.base.replace(/\/+$/,"").replace(/\/v\d+$/,"");
  try{
    const ac = new AbortController();
    const tm = setTimeout(()=>ac.abort(), 1200);
    const headers = {};
    if(cfg.key) headers["Authorization"] = "Bearer " + cfg.key;
    if(cfg.headers) Object.assign(headers, parseCustomHeaders(cfg.headers));
    let r;
    try {
      r = await connectionFetch(cfg,base + "/api/ps", {method:"GET", headers, signal:ac.signal});
    } finally {
      clearTimeout(tm);
    }
    if(!r.ok) return null;
    const j = await r.json().catch(()=>null);
    if(!j || !Array.isArray(j.models)) return null;

    const norm = s => (s || "").toLowerCase().trim();
    const target = norm(modelName);
    const targetBase = target.includes(":") ? target.split(":")[0] : target;

    return j.models.some(m => {
      const n = norm(m.name);
      const mod = norm(m.model);
      if(n === target || mod === target) return true;
      if(n === `${target}:latest` || mod === `${target}:latest`) return true;
      if(`${n}:latest` === target || `${mod}:latest` === target) return true;
      const nBase = n.split(":")[0];
      const modBase = mod.split(":")[0];
      return Boolean(targetBase && (nBase === targetBase || modBase === targetBase));
    });
  }catch{
    return null;
  }
}

/* -------- 本地后端协议探测（Ollama / llama.cpp / LM Studio） -------- */
const _localProtocolCache = new Map(); // base → bool (true=ollama-native, false=openai-compat)
async function pickLocalProtocol(cfg){
  const p = cfg.protocol || "auto";
  if(p === "ollama") return true;
  if(p === "openai") return false;
  // auto
  const base = cfg.base.replace(/\/+$/,"").replace(/\/v\d+$/,"");
  const cacheKey = connectionAccessFingerprint(cfg);
  if(_localProtocolCache.has(cacheKey)) return _localProtocolCache.get(cacheKey);
  try{
    // 探测加超时，避免主机卡住时阻塞整个发送
    const ac = new AbortController();
    const tm = setTimeout(()=>ac.abort(), 3000);
    const headers = {};
    if(cfg.key) headers["Authorization"] = "Bearer " + cfg.key;
    if(cfg.headers) Object.assign(headers, parseCustomHeaders(cfg.headers));
    let ok = false;
    try{
      const r = await connectionFetch(cfg,base + "/api/tags", {method:"GET", headers, signal:ac.signal});
      if(r.ok){
        const j = await r.json().catch(()=>null);
        ok = !!(j && Array.isArray(j.models) && !j.error);
      }
    }
    finally{ clearTimeout(tm); }
    _localProtocolCache.set(cacheKey, ok);
    return ok;
  }catch{
    _localProtocolCache.set(cacheKey, false);
    return false;
  }
}

/* -------- Ollama 原生端点（图片/思考支持更好） -------- */
async function callOllamaNative({cfg, model, chat, signal, onContent, onReasoning, onOrphanThink, onToolCall, tools, rawCall}){
  let base = cfg.base.replace(/\/+$/,"").replace(/\/v\d+$/,""); // 去掉 /v1
  const url = base + "/api/chat";
  const messages = [];
  const sysO = effectiveSystemPrompt(chat);
  if(sysO) messages.push({role:"system", content:sysO});
  const msgsO = lastN(chat.messages, chat);
  const allowAttachO = computeAttachmentAllowSet(msgsO);
  for(const m of msgsO){
    if(m.role==="tool"){
      messages.push({role:"tool", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)});
      continue;
    }
    if(m.role==="assistant"){
      const content = assistantRequestContent(m);
      const msgObj = {role:"assistant"};
      if(m.tool_calls && m.tool_calls.length){
        msgObj.tool_calls = m.tool_calls.map(tc => {
          let args = tc.function?.arguments;
          if(typeof args === "string"){
            try { args = JSON.parse(args); } catch {}
          }
          return {
            function: {
              name: tc.function?.name,
              arguments: (args && typeof args === "object") ? args : {}
            }
          };
        });
        msgObj.content = content || "";
      } else {
        if(!content) continue;
        msgObj.content = content;
      }
      messages.push(msgObj);
      continue;
    }
    let txt = m.content||"";
    const attachments = allowAttachO.has(m) ? (m.attachments||[]) : [];
    const fileTexts = attachments.filter(a=>a.kind==="file" && a.text);
    if(fileTexts.length){ txt += "\n\n" + fileTexts.map(f=>`${t("attach.label", f.name)}\n${f.text}`).join("\n\n"); }
    const images = attachments.filter(a=>a.kind==="image" && a.dataUrl);
    const msg = {role:"user", content:txt};
    if(images.length){
      // 仅保留 base64 部分，不带 "data:image/...;base64," 前缀
      msg.images = images.map(img => (img.dataUrl||"").split(",")[1] || "");
    }
    messages.push(msg);
  }
  // 丢弃错误轮次后可能留下连续 user 消息，部分 chat template（Gemma/Mistral 系）会直接报错
  const mergedO = mergeAdjacentRoles(messages, (a,b)=>{
    a.content = [a.content, b.content].filter(Boolean).join("\n\n");
    if(b.images) a.images = [...(a.images||[]), ...b.images];
  });

  const body = {
    model, messages: mergedO, stream:true,
    options:{ ...temperatureParams(), ...samplingParams() }
  };
  if(tools && tools.length) body.tools = tools;
  // Auto leaves the model/server default unchanged; visibility is a UI preference.
  const thinkO = thinkMode();
  if(thinkO !== "auto") body.think = thinkO === "on";
  const tokenLimit = outputTokenLimit();
  if(tokenLimit !== null) body.options.num_predict = tokenLimit;
  // Ollama 默认上下文窗口很小（常见 4096），超出的部分会被服务端静默丢弃 ——
  // 最先被丢掉的恰好是排在最前面的 system prompt / 场景记忆，而且毫无报错。
  const numCtx = optNum(state.general.numCtx);
  if(numCtx) body.options.num_ctx = numCtx;
  // 让模型常驻，避免每轮冷加载把首字节拖到连接看门狗之外
  if(state.general.keepAlive) body.keep_alive = state.general.keepAlive;
  const headers = {"Content-Type":"application/json"};
  if(cfg.key) headers["Authorization"] = "Bearer "+cfg.key;
  if(cfg.headers){
    Object.assign(headers, parseCustomHeaders(cfg.headers));
  }
  if(rawCall){
    rawCall.request.url = url;
    rawCall.request.method = "POST";
    const recordedHeaders = Object.assign({}, headers);
    if(cfg.key && recordedHeaders["Authorization"]) recordedHeaders["Authorization"] = "Bearer " + maskApiKey(cfg.key);
    rawCall.request.headers = recordedHeaders;
    rawCall.request.body = sanitizeBodyForRecord(body);
  }
  const r = await connectionFetch(cfg,url,{method:"POST", headers, body:JSON.stringify(body), signal},rawCall);
  if(rawCall){
    rawCall.response.status = r.status;
    rawCall.response.statusText = r.statusText || (r.status===200?"OK":"");
  }
  if(!r.ok) throw await httpError(r);
  // Ollama 用 NDJSON 流式（每行一个 JSON）
  const parser = makeThinkTagParser(onReasoning, onContent, onOrphanThink);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", streamErr = null, doneReason = "";
  const toolCallsAcc = [];
  const handleLine = (line)=>{
    if(!line.trim()) return;
    try{
      const j = JSON.parse(line);
      if(j.error){ streamErr = new Error(streamErrMessage(j.error)); return; }
      if(j.done_reason){ doneReason = j.done_reason; if(rawCall) rawCall.response.finishReason = doneReason; }
      const mm = j.message;
      if(mm){
        if(mm.thinking) onReasoning(mm.thinking);   // 原生 thinking 字段
        if(mm.content) parser(mm.content);          // 兼容 <think> 标签
        if(mm.tool_calls && Array.isArray(mm.tool_calls)){
          for(const tc of mm.tool_calls){
            toolCallsAcc.push({
              id: tc.id || `call_${Date.now()}_${toolCallsAcc.length}`,
              type: "function",
              function: {
                name: tc.function?.name,
                arguments: typeof tc.function?.arguments === "object" ? JSON.stringify(tc.function.arguments) : String(tc.function?.arguments || "{}")
              }
            });
          }
        }
      }
      if(j.load_duration && rawCall){
        rawCall.response.loadDurationMs = Math.round(j.load_duration / 1e6);
      }
      if(j.eval_count && rawCall){
        rawCall.response.tokens = j.eval_count;
        if(j.eval_duration) rawCall.response.evalDurationMs = j.eval_duration / 1e6;
      }
    }catch{}
  };
  while(true){
    const {value, done} = await reader.read();
    if(done) break;
    buf += dec.decode(value, {stream:true});
    let i;
    while((i = buf.indexOf("\n")) >= 0){
      const line = buf.slice(0, i).replace(/\r$/,""); buf = buf.slice(i+1);
      handleLine(line);
    }
  }
  if(buf.trim()) handleLine(buf.replace(/\r$/,"")); // flush 末段（无换行结尾）
  parser.flush();
  if(toolCallsAcc.length && onToolCall){
    onToolCall(toolCallsAcc);
  }
  if(streamErr) throw streamErr;
  if(doneReason === "length") onContent("\n\n> ⚠️ "+t("msg.truncated"));
}

