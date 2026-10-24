/* ---------------- 本地模型输出语言锁（仅 provider==="ollama"） ----------------
   现象：本地模型只要上下文里混进英文（英文历史、英文附件、英文代码注释），就会先用
   英文思考、再把正文一起带偏 —— 而且它心里是清楚的，思考链原话是
   "We need answer in Simplified Chinese. User asks..."，用英文说着要用中文答。

   实测（llama.cpp + Qwen3-27B，48 样本 / 3 类含英文上下文 × 4 次）：
     原样发送                    出问题 58%
     语言指令追加到最后一条 user   出问题  8%   ← 采用
     改 system prompt            出问题 50%   ← 无效
     两者都上                    出问题 25%
   改 system 之所以无效：不少本地模型的 chat template 自带一条语言指令，且拼在用户
   system prompt 之前，头部早就不缺指令了；真正稀缺的是靠近生成点的位置。

   默认 off。开关在「本地模型」设置块里，其他厂商的请求路径完全不经过这里。 */
const LANG_LOCK_TEXT = {
  zh: "【输出语言】本次回复必须全程使用简体中文，思考过程也用简体中文。代码、命令、专有名词、API 名保留原文，其余不要输出英文句子。",
  ja: "【出力言語】今回の返答はすべて日本語で書いてください。思考過程も日本語で行ってください。コード・コマンド・固有名詞・API 名は原文のままで構いません。",
  en: "[OUTPUT LANGUAGE] Write this entire reply in English, and reason in English as well. Keep code, commands, identifiers and API names as they are."
};
/* 场景对话的目标语言是用户自由填写的（"日本語 (Japanese)" / "English" / …），
   认得出才锁 —— 认不出就返回空，宁可不锁也不要锁错语言。 */
function langLockKey(chat, cfg){
  if(chat && chat.noLangLock) return "";              // 内部一次性任务（记忆压缩等）不锁
  let mode = cfg?.langLock;
  if(!mode){
    const ollamaProv = getProviders().find(p => p.type === "ollama");
    mode = ollamaProv?.langLock || "off";
  }
  if(mode === "off") return "";
  if(mode !== "auto") return mode;
  const scen = (chat && chat.kind === "scenario") ? ((chat.scenario||{}).lang||"").trim() : "";
  if(scen){
    if(/日本語|japanese|にほんご/i.test(scen)) return "ja";
    if(/简体|繁體|中文|chinese|汉语|漢語/i.test(scen)) return "zh";
    if(/english|英语|英文/i.test(scen)) return "en";
    return "";
  }
  return "en";
}
/* 语言漂移检测。两道判据缺一不可：
   1) 目标语言字符占比低；
   2) 出现足够多的英文**虚词**。
   只看占比会误伤"中文夹密集标识符"的正常回答 —— "在 Kubernetes 中，InitContainer 与
   Sidecar 的 restartPolicy…" 汉字占比只有 0.32，但它是完全合格的中文。区别在于标识符
   不带虚词，而真正塌成英文的句子一定带（"…gets a conflict error, must retry"）。
   阈值 0.75 在 38 条真实样本上标定：该修的 7/7 全抓，正常的 31 条零误触发。 */
const LANG_REPAIR_THRESHOLD = 0.75;
const EN_FUNCTION_WORDS = /\b(the|is|are|was|were|be|been|being|to|of|and|or|in|on|for|with|that|this|it|its|as|at|by|from|but|if|when|while|which|who|you|we|they|not|no|can|could|will|would|shall|should|must|may|might|has|have|had|do|does|did|so|than|then|there|these|those|only|also|actually|because|however|instead|both|each|every|any|all|more|most|other|such|about|into|over|under|after|before)\b/gi;
/* 连续两个英文单词。标识符（restartPolicy / InitContainer）在中文里总是被 CJK 隔开、
   凑不成对；而半译的表头（"Pessimistic Locking"）和塌掉的句子（"conflicts are likely"）
   会大量成对。实测：正常回答最多 5 对，表格型漂移是 6～52 对。 */
const EN_WORD_PAIR = /\b[A-Za-z][a-z]{1,}\s+[A-Za-z][a-z]{1,}\b/g;
function langSignals(text){
  const s = String(text||"")
    .replace(/```[\s\S]*?```/g, " ").replace(/```[\s\S]*/g, " ")
    .replace(/`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " ");
  return {
    han:  (s.match(/[\u4e00-\u9fff]/g)||[]).length,
    kana: (s.match(/[\u3040-\u30ff]/g)||[]).length,
    lat:  (s.match(/[A-Za-z]/g)||[]).length,
    enWords: (s.match(EN_FUNCTION_WORDS)||[]).length,
    enPairs: (s.match(EN_WORD_PAIR)||[]).length
  };
}
/* 目标语言得分，只用于"补丁有没有把回答变好"这道校验（不参与是否触发的判定）。 */
function langScore(text, key){
  const g = langSignals(text);
  const total = g.han + g.kana + g.lat;
  if(!total) return null;
  if(key === "en") return g.lat / total;
  if(key === "ja") return g.kana === 0 ? 0 : (g.han + g.kana) / total;
  return g.han / total;
}
function needsLangRepair(chat, text, cfg){
  const key = langLockKey(chat, cfg);
  if(!key) return false;
  const g = langSignals(text);
  const total = g.han + g.kana + g.lat;
  if(total < 30) return false;                         // 太短，信号不足，不判
  if(key === "en") return (g.han + g.kana) / total > 0.25;   // 目标英语：混进成片 CJK 就是漂
  if(key === "ja"){
    if(g.kana === 0) return true;                     // 一个假名都没有 = 输出成中文了
    if((g.han + g.kana) / total >= LANG_REPAIR_THRESHOLD) return false;
  }else{                                               // zh
    if(g.kana >= 6) return true;                      // 混进成片假名 = 输出成日语了
    if(g.han / total >= LANG_REPAIR_THRESHOLD) return false;
  }
  // 占比偏低还不足以判定 —— 中文夹密集标识符同样会把占比拉到 0.3。
  // 真正塌掉的输出二选一：成片英文虚词（散文式漂移），或大量连续英文词（半译表格）。
  return g.enWords >= 4 || g.enPairs >= 6;
}

/* 纠正语。就用"在同一上下文里再补一句"这个最笨的办法 —— 实测 7 条真实漂移输出
   7/7 全部修好，中文占比 0.48 → 0.86，代价约 +12.5s / +736 token。
   措辞按实测过的原样保留，改了就得重测。 */
const LANG_REPAIR_TEXT = { zh:"用中文输出", ja:"日本語で出力してください", en:"Output in English." };
/* 在同一上下文里追加纠正轮次并重答，成功则就地改写 aiMsg。
   纠正轮次和漂掉的原文都不写回历史 —— 上下文里留着英文助手回复正是下一轮漂移的
   头号诱因（实测该条件下思考链中文占比只剩 0.04）。 */
async function runLangRepair({chat, aiMsg, cfg, model, useNative, signal, onPartial}){
  const key = langLockKey(chat, cfg);
  const corr = key && LANG_REPAIR_TEXT[key];
  if(!corr) return false;
  const before = langScore(aiMsg.content, key);
  const repairChat = Object.assign({}, chat, {
    noLangLock: true,   // 纠正语本身就是指令，不必再挂一遍尾部锁
    messages: [...chat.messages, {role:"user", content:corr, time:Date.now()}]
  });
  let content = "", reasoning = "";
  const onContent = (d)=>{ content += d; if(onPartial) onPartial(content); };
  const onReasoning = (d)=>{ reasoning += d; };
  const onOrphanThink = ()=>{ reasoning = content + reasoning; content = ""; };
  if(useNative) await callOllamaNative({cfg, model, chat:repairChat, signal, onContent, onReasoning, onOrphanThink});
  else await callOpenAICompat({cfg, model, chat:repairChat, signal, onContent, onReasoning, onOrphanThink, provider:"ollama"});
  if(!content.trim()) return false;
  const after = langScore(content, key);
  // 只在确实变好时采纳，避免越修越糟
  if(after === null || (before !== null && after <= before)) return false;
  aiMsg.content = content;
  if(reasoning.trim()) aiMsg.reasoning = reasoning;
  aiMsg.langRepaired = true;
  return true;
}

/* 追加到**最后一条 user 消息末尾** —— 位置就是这个方案的全部价值所在，别挪到别处。
   content 可能是纯字符串，也可能是 [{type:"text"},{type:"image_url"}…] 的分段数组。 */
function appendLangLock(messages, chat, cfg){
  const key = langLockKey(chat, cfg);
  const tail = key && LANG_LOCK_TEXT[key];
  if(!tail) return messages;
  for(let i = messages.length - 1; i >= 0; i--){
    const m = messages[i];
    if(m.role !== "user") continue;
    if(typeof m.content === "string") m.content = m.content + "\n\n" + tail;
    else if(Array.isArray(m.content)) m.content.push({type:"text", text:tail});
    break;
  }
  return messages;
}
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
  // 合并之后再挂锁 —— 必须是整串消息的最后一句，否则效果就没了
  return (opts && opts.langLock) ? appendLangLock(merged, chat, cfg) : merged;
}

/* -------- 本地后端协议探测（Ollama / llama.cpp / LM Studio） -------- */
const _localProtocolCache = new Map(); // base → bool (true=ollama-native, false=openai-compat)
async function pickLocalProtocol(cfg){
  const p = cfg.protocol || "auto";
  if(p === "ollama") return true;
  if(p === "openai") return false;
  // auto
  const base = cfg.base.replace(/\/+$/,"").replace(/\/v\d+$/,"");
  if(_localProtocolCache.has(base)) return _localProtocolCache.get(base);
  try{
    // 探测加超时，避免主机卡住时阻塞整个发送
    const ac = new AbortController();
    const tm = setTimeout(()=>ac.abort(), 3000);
    let ok = false;
    try{
      const r = await fetch(base + "/api/tags", {method:"GET", signal:ac.signal});
      if(r.ok){
        const j = await r.json().catch(()=>null);
        ok = !!(j && Array.isArray(j.models) && !j.error);
      }
    }
    finally{ clearTimeout(tm); }
    _localProtocolCache.set(base, ok);
    return ok;
  }catch{
    _localProtocolCache.set(base, false);
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
  appendLangLock(mergedO, chat);   // 原生协议同属本地模型，同样受开关控制
  const body = {
    model, messages: mergedO, stream:true,
    options:{ temperature: llmTemp(), ...samplingParams() }
  };
  if(tools && tools.length) body.tools = tools;
  // auto 时沿用旧行为（跟随"显示思考"开关），on/off 为显式覆盖
  const thinkO = thinkMode();
  body.think = thinkO === "auto" ? !!state.general.showThinking : thinkO === "on";
  if(state.general.maxTokens) body.options.num_predict = Number(state.general.maxTokens);
  // Ollama 默认上下文窗口很小（常见 4096），超出的部分会被服务端静默丢弃 ——
  // 最先被丢掉的恰好是排在最前面的 system prompt / 场景记忆，而且毫无报错。
  const numCtx = optNum(state.general.numCtx);
  if(numCtx) body.options.num_ctx = numCtx;
  // 让模型常驻，避免每轮冷加载把首字节拖到连接看门狗之外
  if(state.general.keepAlive) body.keep_alive = state.general.keepAlive;
  const headers = {"Content-Type":"application/json"};
  if(cfg.key) headers["Authorization"] = "Bearer "+cfg.key;
  if(rawCall){
    rawCall.request.url = url;
    rawCall.request.method = "POST";
    rawCall.request.headers = Object.assign({}, headers, cfg.key ? { "Authorization": "Bearer " + maskApiKey(cfg.key) } : {});
    rawCall.request.body = sanitizeBodyForRecord(body);
  }
  const r = await fetch(url,{method:"POST", headers, body:JSON.stringify(body), signal});
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

