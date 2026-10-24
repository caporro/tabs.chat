/* -------- SSE reader -------- */
async function readSSE(response, onEvent){
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const handleLine = (line)=>{
    if(!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if(!data || data==="[DONE]") return;
    try{ onEvent(JSON.parse(data)); }catch{}
  };
  while(true){
    const {value, done} = await reader.read();
    if(done) break;
    buf += dec.decode(value,{stream:true});
    let i;
    while((i = buf.indexOf("\n")) >= 0){
      const line = buf.slice(0,i).replace(/\r$/,""); buf = buf.slice(i+1);
      handleLine(line);
    }
  }
  // flush 末段：部分服务端最后一行不带换行结尾
  if(buf.trim()) handleLine(buf.replace(/\r$/,""));
}

function lastN(messages, chat){
  const n = Math.max(2, Number(state.general.historyN)||40);
  // Honor context dividers: only consider messages after the most recent divider
  let start = 0;
  for(let i=messages.length-1;i>=0;i--){
    if(messages[i].role === "divider"){ start = i+1; break; }
  }
  const slice = messages.slice(start).filter(m=>m.role !== "divider");
  return fitTokenBudget(slice.slice(-n), chat);
}

/* 粗略 token 估算：CJK 按 1 字/token，其余按 4 字符/token。只用于"别把上下文窗口
   撑爆"的二级裁剪，不追求精确 —— 条数窗口（historyN）挡不住夹带 PDF 正文的长消息。 */
function estimateTokens(text){
  const s = String(text||"");
  if(!s) return 0;
  const cjk = (s.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)||[]).length;
  return Math.ceil(cjk + (s.length - cjk)/4);
}
const IMAGE_TOKEN_COST = { low:300, standard:1200, high:1800 };
function estimateMessageTokens(m, withAttachments){
  let n = estimateTokens(m.content) + 8;   // 角色/分隔符开销
  if(withAttachments){
    for(const a of (m.attachments||[])){
      if(a.kind === "file" && a.text) n += estimateTokens(a.text);
      else if(a.kind === "image") n += IMAGE_TOKEN_COST[state.general.imageDetail] ?? IMAGE_TOKEN_COST.standard;
    }
  }
  return n;
}
/* 在条数窗口之上再按 token 预算从最旧的一端裁剪；留空 = 不启用。
   预算里先扣掉 system prompt 和预留的输出长度，最后一条消息永远保留。 */
function fitTokenBudget(list, chat){
  const budget = optNum(state.general.contextTokenBudget);
  if(!budget || budget <= 0 || !list.length) return list;
  const allow = computeAttachmentAllowSet(list);   // 只对真正会发出去的附件计费
  let left = budget
    - estimateTokens(chat ? effectiveSystemPrompt(chat) : "")
    - (Number(state.general.maxTokens) || 0);
  const kept = [];
  for(let i = list.length-1; i >= 0; i--){
    const cost = estimateMessageTokens(list[i], allow.has(list[i]));
    if(kept.length && left - cost < 0) break;
    left -= cost;
    kept.unshift(list[i]);
  }
  return kept;
}

/* Attachments (images/files) are expensive "memory" — resending them on every
   turn multiplies their token cost by how many turns they stay in the window.
   Only the most recent N user turns that carry attachments actually get their
   attachments included in the outgoing request; older turns keep their text
   only. This applies uniformly across all providers. */
function attachmentKeepRecent(){
  const v = Number(state.general.attachmentKeepRecent);
  return Number.isFinite(v) ? Math.max(0, v) : 1;
}
function computeAttachmentAllowSet(msgs){
  const withAttachments = msgs.filter(m => m.role==="user" && (m.attachments||[]).length);
  const keep = attachmentKeepRecent();
  return new Set(keep > 0 ? withAttachments.slice(-keep) : []);
}

