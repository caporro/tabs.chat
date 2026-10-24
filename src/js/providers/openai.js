/* -------- OpenAI compat (OpenAI / DeepSeek / Moonshot / Ollama / LM Studio) -------- */
function normalizeBase(base, provider){
  let b = (base||"").replace(/\/+$/,"");
  // Ollama 的 OpenAI 兼容端点位于 /v1，自动补全，避免 404
  if(provider==="ollama" && !/\/v\d+$/.test(b)) b += "/v1";
  // 本机/内网的 OpenAI 兼容服务同样挂在 /v1 下（LM Studio / llama.cpp / vLLM），
  // 用户常只填到端口就结束 → 直接 404。远端地址不猜，交给 404 兜底重试。
  if(provider==="openai" && !/\/v\d+(\/|$)/.test(b) && isLocalHost(b)) b += "/v1";
  return b;
}
/* 温度：尊重显式的 0（`Number(x)||0.7` 会把 0 误判为 0.7），
   但把空/未设置当作默认 0.7（注意 Number("") === 0）。 */
function llmTemp(){
  const raw = state.general.temperature;
  if(raw === "" || raw === null || raw === undefined) return 0.7;
  const v = Number(raw);
  return Number.isFinite(v) ? v : 0.7;
}
/* 思考模式：auto=不干预服务端默认 / on=强制思考 / off=强制关闭思考。
   与 showThinking（是否"展示"）分离 —— 旧版把两件事混在一个开关里，
   结果"关掉思考"只是把 CoT 丢弃，模型照样思考、token 照样付。 */
function thinkMode(){
  const v = state.general.thinkMode;
  return (v === "on" || v === "off") ? v : "auto";
}
/* 可选数值参数：留空/非法 → null（该字段不发送）；显式填 0 必须保留。 */
function optNum(raw){
  if(raw === "" || raw === null || raw === undefined) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}
/* 采样参数。只发用户填过的；字段名在 OpenAI 兼容端点和 Ollama options 里一致。
   本地小模型（Qwen3 8B 等）缺 top_k / min_p / presence_penalty 时极易复读。 */
function samplingParams(){
  const out = {};
  const map = { top_p:"topP", top_k:"topK", min_p:"minP", presence_penalty:"presencePenalty" };
  for(const k in map){
    const v = optNum(state.general[map[k]]);
    if(v !== null) out[k] = v;
  }
  return out;
}
function hostOf(u){ try{ return new URL(u).hostname; }catch{ return ""; } }
/* 本机 / 内网地址：这类 OpenAI 兼容服务（LM Studio 1234、llama.cpp 8080、vLLM 8000）
   一律挂在 /v1 下，而用户常常只填到端口就结束。 */
function isLocalHost(u){
  const h = hostOf(u);
  if(!h) return false;
  return /^(localhost|0\.0\.0\.0)$/i.test(h) || h === "::1" || h === "[::1]"
      || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.local$/i.test(h);
}
/* 上下文超长：各家措辞不同，模糊匹配后给一条可操作的提示。 */
function isContextOverflow(err){
  if(!err || (err.status !== 400 && err.status !== 413)) return false;
  return /context[_ ]?(length|window|size)|max(imum)?[_ ]?context|n_ctx|too many tokens|too long|reduce the length|exceeds?\b.*(context|token)/i.test(err.message||"");
}
/* 非标字段被端点拒绝时的报文特征。 */
const UNKNOWN_ARG_RE = /unrecogni[sz]ed|unknown (field|argument|parameter)|unsupported (field|argument|parameter)|unexpected keyword|extra_forbidden|extra fields|not permitted|invalid[_ ]?(request[_ ]?)?(argument|parameter|field)/i;
/* 发 chat/completions，并对两类常见的"端点差异"各自愈一次：
   1) 400 + 未知参数 → 剥掉全部非标字段重发（Azure / 严格网关）；
   2) 404 且 URL 里没有 /vN 段 → 补 /v1 重发（本地服务最常见的填法错误）。 */
async function postChatCompletions(url, headers, core, optional, signal){
  const send = (u, b)=>fetch(u,{method:"POST", headers, body:JSON.stringify(b), signal});
  let r = await send(url, {...core, ...optional});
  if(r.ok) return r;
  if(r.status === 400 && Object.keys(optional).length){
    const e = await httpError(r);
    if(!UNKNOWN_ARG_RE.test(e.message)) throw e;
    r = await send(url, core);
    if(r.ok) return r;
  }
  if(r.status === 404 && !/\/v\d+\/chat\/completions$/.test(url)){
    const r2 = await send(url.replace(/\/chat\/completions$/, "/v1/chat/completions"), {...core, ...optional});
    if(r2.ok) return r2;
  }
  throw await httpError(r);
}
/* 统一 HTTP 错误：带上 status，供 isRetryableLLM 判定 5xx 可重试。 */
async function httpError(r){
  let body = ""; try{ body = await r.text(); }catch{}
  const e = new Error(`${r.status} ${r.statusText}${body?": "+body:""}`);
  e.status = r.status;
  return e;
}
/* 从流内错误对象里抽一句可读信息。 */
function streamErrMessage(errObj){
  if(!errObj) return "";
  if(typeof errObj === "string") return errObj;
  return errObj.message || errObj.error || errObj.reason || JSON.stringify(errObj);
}
/* 根据错误类型给出更有针对性的排查提示（尤其本地/私有部署）。 */
function networkHint(err, cfg){
  if(err && err.name === "TimeoutError") return t("msg.error.timeoutHint");
  if(err && err.name === "TypeError"){
    const base = (cfg && cfg.base || "").trim();
    // HTTPS 页面请求 http:// 本地服务 → 浏览器按混合内容拦截
    if(location.protocol === "https:" && /^http:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(base)){
      return t("msg.error.mixedContent");
    }
    return t("msg.error.network");
  }
  return t("msg.error.suffix");
}
async function callOpenAICompat({cfg, model, chat, signal, onContent, onReasoning, onOrphanThink, onToolCall, tools, provider, rawCall}){
  const url = normalizeBase(cfg.base, provider) + "/chat/completions";
  // 语言锁只对本地模型开放；openai / openrouter / azure 等走同一函数但一律不加
  const messages = buildOpenAIMessages(chat, {langLock: provider === "ollama"}, cfg);
  // 核心字段：任何 OpenAI 兼容端点都认。
  const core = {
    model, messages, stream:true,
    temperature: llmTemp(),
    ...samplingParams(),
  };
  if(tools && tools.length) core.tools = tools;
  if(state.general.maxTokens) core.max_tokens = Number(state.general.maxTokens);
  // 可选/非标字段：严格端点（Azure、部分 vLLM/网关）会以 400 "unrecognized request
  // argument" 拒绝整个请求，所以单独存放，失败时剥掉重发一次（见 postChatCompletions）。
  const optional = {};
  const think = thinkMode();
  if(think !== "auto"){
    // Qwen3 等混合思考模型的真正开关（vLLM / SGLang / llama.cpp --jinja）。
    // 不发这个字段的话，"关闭思考"只是把已经生成的 CoT 丢掉，token 和时延照付。
    optional.chat_template_kwargs = { enable_thinking: think === "on" };
  }
  if(provider === "ollama"){
    // Ollama 的 OpenAI 兼容端点支持 think 扩展；auto 时沿用旧行为
    optional.think = think === "auto" ? !!state.general.showThinking : think === "on";
  }
  if(/(^|\.)openrouter\.ai$/i.test(hostOf(url))){
    // OpenRouter 专有的统一推理参数 —— 发给别家会 400，所以只在这里发
    optional.include_reasoning = !!state.general.showThinking;
    optional.reasoning = think === "off" ? { exclude:true } : { effort:"medium" };
  }
  // llama.cpp's slot/prompt-cache reuse can get confused by multimodal chunks
  // whose token positions are not strictly one-token-per-position. Avoid the
  // LCP reuse path for local OpenAI-compatible image requests.
  if(provider==="ollama" && openAIMessagesContainImages(messages)){
    optional.cache_prompt = false;
  }
  if(provider !== "ollama"){
    optional.stream_options = { include_usage: true };
  }
  const headers = {"Content-Type":"application/json"};
  if(cfg.key) headers["Authorization"] = "Bearer "+cfg.key;
  if(rawCall){
    rawCall.request.url = url;
    rawCall.request.method = "POST";
    rawCall.request.headers = Object.assign({}, headers, cfg.key ? { "Authorization": "Bearer " + maskApiKey(cfg.key) } : {});
    rawCall.request.body = sanitizeBodyForRecord({ ...core, ...optional });
  }
  const r = await postChatCompletions(url, headers, core, optional, signal);
  if(rawCall){
    rawCall.response.status = r.status;
    rawCall.response.statusText = r.statusText || (r.status===200?"OK":"");
  }
  const parser = makeThinkTagParser(onReasoning, onContent, onOrphanThink);
  let streamErr = null, finish = "";
  const toolCallsAcc = [];
  await readSSE(r, (json)=>{
    // 有些本地/兼容服务端会在 HTTP 200 的流里直接回传错误对象
    if(json.error){ streamErr = new Error(streamErrMessage(json.error)); return; }
    const choice = json.choices?.[0] || {};
    const delta = choice.delta || {};
    if(choice.finish_reason){ finish = choice.finish_reason; if(rawCall) rawCall.response.finishReason = finish; }
    // 各家命名的"思考"字段全部捕获
    if(delta.reasoning_content) onReasoning(delta.reasoning_content);
    if(delta.reasoning && typeof delta.reasoning==="string") onReasoning(delta.reasoning);
    if(delta.thinking) onReasoning(delta.thinking);
    // 常规 content 流，再做 <think>/<thinking> 标签剥离
    if(delta.content) parser(delta.content);
    // 工具调用流式累积
    if(delta.tool_calls && Array.isArray(delta.tool_calls)){
      for(const tc of delta.tool_calls){
        const idx = tc.index ?? 0;
        if(!toolCallsAcc[idx]){
          toolCallsAcc[idx] = { id: tc.id || `call_${idx}`, type: "function", function: { name: "", arguments: "" } };
        }
        if(tc.id) toolCallsAcc[idx].id = tc.id;
        if(tc.function?.name) toolCallsAcc[idx].function.name += tc.function.name;
        if(tc.function?.arguments) toolCallsAcc[idx].function.arguments += tc.function.arguments;
      }
    }
    if(json.usage && json.usage.completion_tokens && rawCall){
      rawCall.response.tokens = json.usage.completion_tokens;
      rawCall.response.usage = json.usage;
    }
  });
  parser.flush();
  if(toolCallsAcc.length && onToolCall){
    const validCalls = toolCallsAcc.filter(Boolean);
    if(validCalls.length) onToolCall(validCalls);
  }
  if(streamErr) throw streamErr;
  if(finish === "length") onContent("\n\n> ⚠️ "+t("msg.truncated"));
  else if(finish === "content_filter") onContent("\n\n> ⚠️ "+t("msg.blocked"));
}
function assistantRequestContent(m){
  // 出错/中止/空响应气泡里的文字是给人看的提示，不该再作为模型输出回灌上下文 ——
  // 小模型很容易顺着 "错误: ..." 往下解释。
  if(m?.error) return null;
  const content = (m?.content ?? "").toString();
  return content.trim() ? content : null;
}
/* 合并相邻同角色消息。上面会丢弃不可用的 assistant 轮次，于是可能留下连续两条
   user；Anthropic 要求角色交替，Gemma/Mistral 的 chat template 也会直接报错。 */
function mergeAdjacentRoles(list, mergeInto){
  const out = [];
  for(const m of list){
    const prev = out[out.length-1];
    if(prev && prev.role === m.role) mergeInto(prev, m);
    else out.push(m);
  }
  return out;
}
function openAIMessagesContainImages(messages){
  return messages.some(m => Array.isArray(m.content) && m.content.some(p => p?.type === "image_url"));
}
