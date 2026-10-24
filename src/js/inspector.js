/* ---------------- Raw Call Inspector (I/O) ---------------- */
let _activeRawCall = null;

function maskApiKey(key){
  if(!key) return "";
  const s = String(key).trim();
  if(s.length <= 8) return "••••••••";
  return s.slice(0, 4) + "••••••••" + s.slice(-4);
}

function sanitizeBodyForRecord(obj){
  if(!obj) return obj;
  try{
    return JSON.parse(JSON.stringify(obj, (k, v) => {
      if(typeof v === "string" && v.startsWith("data:image/") && v.length > 200){
        return v.slice(0, 60) + `... [base64 image truncated, total ${v.length} chars]`;
      }
      return v;
    }));
  }catch{
    return obj;
  }
}

function getMessageRawCall(chat, msg, idx){
  if(msg.rawCall) return msg.rawCall;
  const activeModel = msg.model || chat.model || state.lastModel || "";
  const idxSep = activeModel.indexOf("::");
  const providerId = idxSep >= 0 ? activeModel.slice(0, idxSep) : "openai";
  const model = idxSep >= 0 ? activeModel.slice(idxSep + 2) : activeModel;
  const prov = getProvider(providerId);
  const provider = prov ? prov.type : providerId;
  const cfg = prov || { base: "", key: "" };
  const priorChat = Object.assign({}, chat, { messages: chat.messages ? chat.messages.slice(0, Math.max(0, idx)) : [] });
  let reqUrl = "";
  let reqBody = null;
  const reqHeaders = { "Content-Type": "application/json" };
  if(cfg.key) reqHeaders["Authorization"] = "Bearer " + maskApiKey(cfg.key);

  if(provider === "ollama"){
    reqUrl = (cfg.base || "http://localhost:11434").replace(/\/+$/,"").replace(/\/v\d+$/,"") + "/api/chat";
    reqBody = {
      model,
      messages: buildOpenAIMessages(priorChat, {langLock: true}, cfg),
      stream: true,
      options: { temperature: llmTemp(), ...samplingParams() }
    };
  } else if(provider === "claude"){
    reqUrl = (cfg.base || "https://api.anthropic.com/v1").replace(/\/+$/,"") + "/messages";
    reqBody = {
      model,
      stream: true,
      max_tokens: Number(state.general.maxTokens) || 4096,
      temperature: llmTemp()
    };
  } else if(provider === "gemini"){
    reqUrl = `${(cfg.base || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/,"")}/models/${encodeURIComponent(model)}:streamGenerateContent`;
    reqBody = {
      generationConfig: { temperature: llmTemp() }
    };
  } else {
    reqUrl = normalizeBase(cfg.base || "https://api.openai.com/v1", "openai") + "/chat/completions";
    reqBody = {
      model,
      messages: buildOpenAIMessages(priorChat, {}, cfg),
      temperature: llmTemp(),
      stream: true
    };
  }

  return {
    request: {
      url: reqUrl,
      method: "POST",
      headers: reqHeaders,
      body: sanitizeBodyForRecord(reqBody)
    },
    response: {
      status: msg.error ? 500 : 200,
      statusText: msg.error ? "Error" : "OK",
      durationMs: msg.reasoningMs || 0,
      reasoningMs: msg.reasoningMs || 0,
      finishReason: "completed",
      content: msg.content || "",
      reasoning: msg.reasoning || "",
      error: msg.error ? (msg.content || "Error") : null
    },
    meta: {
      provider: prov ? (prov.name || provider) : provider,
      providerType: provider,
      model,
      modelId: activeModel,
      timestamp: msg.time || Date.now(),
      reconstructed: true
    }
  };
}

function renderRawCallInputTab(rawCall){
  const el = document.getElementById("rawCallTabInput");
  if(!el) return;
  const req = rawCall.request || {};
  const body = req.body || {};
  const msgs = body.messages || body.contents || [];

  let headersHtml = "";
  if(req.headers && Object.keys(req.headers).length){
    headersHtml = `
      <div class="drawer-section">
        <div class="drawer-sec-title">Headers</div>
        <pre class="drawer-pre">${escapeHtml(JSON.stringify(req.headers, null, 2))}</pre>
      </div>
    `;
  }

  let paramsHtml = "";
  const params = Object.assign({}, body);
  delete params.messages;
  delete params.contents;
  if(Object.keys(params).length){
    paramsHtml = `
      <div class="drawer-section">
        <div class="drawer-sec-title">Request Parameters</div>
        <pre class="drawer-pre">${escapeHtml(JSON.stringify(params, null, 2))}</pre>
      </div>
    `;
  }

  let msgsHtml = "";
  if(Array.isArray(msgs) && msgs.length){
    msgsHtml = `
      <div class="drawer-section">
        <div class="drawer-sec-title">
          <span>Prompt Messages (${msgs.length})</span>
          <button type="button" class="sec-btn" id="rawCallCopyMsgs">Copy Messages</button>
        </div>
        <div class="drawer-msgs-list">
          ${msgs.map((m, i) => {
            const role = (m.role || "user").toUpperCase();
            let contentStr = typeof m.content === "string" ? m.content : JSON.stringify(m.content || m.parts || "", null, 2);
            return `
              <div class="drawer-msg-item">
                <div class="drawer-msg-role">${escapeHtml(role)} #${i+1}</div>
                <div style="white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:200px;overflow-y:auto">${escapeHtml(contentStr)}</div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="drawer-section">
      <div class="drawer-sec-title">Endpoint</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:12px;word-break:break-all;color:var(--accent);font-weight:600">
        <span style="background:var(--accent-subtle);padding:2px 6px;border-radius:4px;margin-right:6px">${escapeHtml(req.method || "POST")}</span>
        ${escapeHtml(req.url || "—")}
      </div>
    </div>
    ${headersHtml}
    ${paramsHtml}
    ${msgsHtml}
    <div class="drawer-section">
      <div class="drawer-sec-title">
        <span>Raw Request Body</span>
        <button type="button" class="sec-btn" id="rawCallCopyReqBody">Copy Body</button>
      </div>
      <pre class="drawer-pre">${escapeHtml(JSON.stringify(body, null, 2))}</pre>
    </div>
  `;

  const copyMsgsBtn = el.querySelector("#rawCallCopyMsgs");
  if(copyMsgsBtn){
    copyMsgsBtn.onclick = () => {
      navigator.clipboard.writeText(JSON.stringify(msgs, null, 2));
      const orig = copyMsgsBtn.textContent;
      copyMsgsBtn.textContent = "Copied!";
      setTimeout(() => { copyMsgsBtn.textContent = orig; }, 1200);
    };
  }
  const copyReqBodyBtn = el.querySelector("#rawCallCopyReqBody");
  if(copyReqBodyBtn){
    copyReqBodyBtn.onclick = () => {
      navigator.clipboard.writeText(JSON.stringify(body, null, 2));
      const orig = copyReqBodyBtn.textContent;
      copyReqBodyBtn.textContent = "Copied!";
      setTimeout(() => { copyReqBodyBtn.textContent = orig; }, 1200);
    };
  }
}

function renderRawCallOutputTab(rawCall){
  const el = document.getElementById("rawCallTabOutput");
  if(!el) return;
  const res = rawCall.response || {};

  let reasoningHtml = "";
  if(res.reasoning){
    const rTime = res.reasoningMs ? ` · ${(res.reasoningMs/1000).toFixed(2)}s` : "";
    reasoningHtml = `
      <div class="drawer-section">
        <div class="drawer-sec-title">
          <span>Thinking / Reasoning (${res.reasoning.length} chars${rTime})</span>
          <button type="button" class="sec-btn" id="rawCallCopyReasoning">Copy</button>
        </div>
        <pre class="drawer-pre" style="max-height:240px;color:var(--fg-2)">${escapeHtml(res.reasoning)}</pre>
      </div>
    `;
  }

  let errorHtml = "";
  if(res.error){
    errorHtml = `
      <div class="drawer-section" style="border-color:var(--danger)">
        <div class="drawer-sec-title" style="color:var(--danger)">Error Details</div>
        <pre class="drawer-pre" style="color:var(--danger);background:rgba(239,68,68,0.08)">${escapeHtml(res.error)}</pre>
      </div>
    `;
  }

  const dTime = res.durationMs ? `${(res.durationMs/1000).toFixed(2)}s` : "—";
  const content = res.content || "";

  el.innerHTML = `
    <div class="drawer-section">
      <div class="drawer-sec-title">Execution Summary</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
        <div><b>HTTP Status:</b> ${escapeHtml(String(res.status || 200))} ${escapeHtml(res.statusText || "OK")}</div>
        <div><b>Total Latency:</b> ${escapeHtml(dTime)}</div>
        <div><b>Finish Reason:</b> ${escapeHtml(res.finishReason || "—")}</div>
        <div><b>Output Chars:</b> ${content.length}</div>
      </div>
    </div>
    ${errorHtml}
    ${reasoningHtml}
    <div class="drawer-section">
      <div class="drawer-sec-title">
        <span>Generated Content (${content.length} chars)</span>
        <button type="button" class="sec-btn" id="rawCallCopyContent">Copy Content</button>
      </div>
      <pre class="drawer-pre" style="max-height:360px">${escapeHtml(content || "(empty)")}</pre>
    </div>
  `;

  const copyReasoningBtn = el.querySelector("#rawCallCopyReasoning");
  if(copyReasoningBtn){
    copyReasoningBtn.onclick = () => {
      navigator.clipboard.writeText(res.reasoning || "");
      const orig = copyReasoningBtn.textContent;
      copyReasoningBtn.textContent = "Copied!";
      setTimeout(() => { copyReasoningBtn.textContent = orig; }, 1200);
    };
  }
  const copyContentBtn = el.querySelector("#rawCallCopyContent");
  if(copyContentBtn){
    copyContentBtn.onclick = () => {
      navigator.clipboard.writeText(content);
      const orig = copyContentBtn.textContent;
      copyContentBtn.textContent = "Copied!";
      setTimeout(() => { copyContentBtn.textContent = orig; }, 1200);
    };
  }
}

function renderRawCallFullTab(rawCall){
  const el = document.getElementById("rawCallTabFull");
  if(!el) return;
  const jsonStr = JSON.stringify(rawCall, null, 2);
  el.innerHTML = `
    <div class="drawer-section">
      <div class="drawer-sec-title">
        <span>Complete Call Record (JSON)</span>
        <button type="button" class="sec-btn" id="rawCallCopyFullJson">Copy JSON</button>
      </div>
      <pre class="drawer-pre" style="max-height:500px">${escapeHtml(jsonStr)}</pre>
    </div>
  `;
  const copyBtn = el.querySelector("#rawCallCopyFullJson");
  if(copyBtn){
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(jsonStr);
      const orig = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = orig; }, 1200);
    };
  }
}

function switchRawCallTab(tabName){
  document.querySelectorAll(".drawer-tab").forEach(t => {
    t.classList.toggle("active", t.getAttribute("data-dtab") === tabName);
  });
  const tabIds = {
    input: "rawCallTabInput",
    output: "rawCallTabOutput",
    full: "rawCallTabFull"
  };
  for(const k in tabIds){
    const el = document.getElementById(tabIds[k]);
    if(el){
      const isCur = (k === tabName);
      el.classList.toggle("hide", !isCur);
      el.style.display = isCur ? "flex" : "none";
    }
  }
}

function openRawCallDrawer(m, idx){
  const chat = currentChat();
  if(!chat || !m) return;
  const rawCall = getMessageRawCall(chat, m, idx);
  _activeRawCall = rawCall;
  const drawer = document.getElementById("rawCallDrawer");
  const mask = document.getElementById("rawCallMask");
  if(!drawer || !mask) return;

  const subEl = document.getElementById("rawCallSubtitle");
  if(subEl) subEl.textContent = `${(rawCall.meta.provider||"").toUpperCase()} · ${rawCall.meta.model||""}`;

  const metaEl = document.getElementById("rawCallMetaBar");
  if(metaEl){
    const dMs = rawCall.response.durationMs ? `${(rawCall.response.durationMs/1000).toFixed(2)}s` : "—";
    const rMs = rawCall.response.reasoningMs ? `${(rawCall.response.reasoningMs/1000).toFixed(2)}s` : "0s";
    const stCode = rawCall.response.status || (rawCall.response.error ? 500 : 200);
    const badgeColor = stCode >= 200 && stCode < 300 ? "accent" : "error";
    metaEl.innerHTML = `
      <span class="drawer-badge ${badgeColor}">${stCode} ${escapeHtml(rawCall.response.statusText || (stCode===200?"OK":"Error"))}</span>
      <span class="drawer-badge">${escapeHtml(rawCall.meta.provider)}</span>
      <span class="drawer-badge">${escapeHtml(rawCall.meta.model)}</span>
      <span class="drawer-badge">⏱ ${dMs}</span>
      <span class="drawer-badge">🧠 ${rMs}</span>
      ${rawCall.meta.reconstructed ? '<span class="drawer-badge" style="opacity:0.75" title="Reconstructed from history">Historical</span>' : ''}
    `;
  }

  renderRawCallInputTab(rawCall);
  renderRawCallOutputTab(rawCall);
  renderRawCallFullTab(rawCall);
  switchRawCallTab("input");

  mask.classList.remove("hide");
  drawer.classList.remove("hide");
}

function closeRawCallDrawer(){
  const drawer = document.getElementById("rawCallDrawer");
  const mask = document.getElementById("rawCallMask");
  if(drawer) drawer.classList.add("hide");
  if(mask) mask.classList.add("hide");
}

async function streamResponse(chat, aiMsg, modelId){
  const idxSep = modelId.indexOf("::");
  const providerId = idxSep >= 0 ? modelId.slice(0, idxSep) : modelId;
  const model = idxSep >= 0 ? modelId.slice(idxSep + 2) : "";
  const prov = getProvider(providerId);
  const provider = prov ? prov.type : providerId;
  const cfg = prov || { base: "", key: "" };
  const chatId = chat.id;
  const streamStartTime = Date.now();
  aiMsg.model = modelId;
  const rawCall = {
    request: { url: "", method: "POST", headers: {}, body: null },
    response: { status: 200, statusText: "OK", durationMs: 0, reasoningMs: 0, finishReason: "", content: "", reasoning: "", error: null },
    meta: { provider: prov ? (prov.name || provider) : provider, providerType: provider, model, modelId, timestamp: streamStartTime }
  };
  aiMsg.rawCall = rawCall;
  // 本次请求是否携带了图片（用于在 400 时提示"该模型/服务可能不支持视觉"）
  const _allowImg = computeAttachmentAllowSet(lastN(chat.messages, chat));
  const sentImages = [..._allowImg].some(m => (m.attachments||[]).some(a=>a.kind==="image"));
  // 仅当此会话正处于前台时才允许操作 DOM —— 这是会话隔离的关键。
  const onActive = ()=> state.activeChatId === chatId;
  const ctrl = new AbortController();
  streamStart(chatId, ctrl, t("status.connecting"));

  let reasoningStart = 0;
  let inReasoning = false;
  let firstChunkSeen = false;
  let firstChunkAt = 0;
  let lastActivity = Date.now();   // 供超时看门狗判定停顿
  let chunkCount = 0;

  const markFirstChunk = ()=>{
    lastActivity = Date.now();
    if(firstChunkSeen) return;
    firstChunkSeen = true; firstChunkAt = Date.now();
    streamPhase(chatId, t("status.generating"));
  };

  const refresh = ()=>{
    if(!onActive()) return; // 后台会话：只累积数据，不触碰前台 DOM
    const msgEl = document.querySelector(".messages .msg-wrap .msg:last-child");
    if(!msgEl) return;
    const body = msgEl.querySelector(".body");
    let panel = body.querySelector(".thinking-panel");
    // 思考指示：只要模型在思考就显示（无论开关）
    if(aiMsg.thought){
      if(!panel){
        panel = document.createElement("details");
        panel.className = "thinking-panel streaming";
        panel.open = state.general.showThinking;
        const initLabel = state.general.showThinking ? t("thinking.streaming") : t("thinking.streaming.hidden");
        panel.innerHTML = `<summary><span class="dot"></span><span class="label">${escapeHtml(initLabel)}</span></summary><div class="thinking-content"></div>`;
        body.querySelector(".thinking-slot").appendChild(panel);
        // 思考开始 → 清掉气泡里的"等待"占位
        const tdots = body.querySelector(".content .typing-dots");
        if(tdots) tdots.remove();
      }
      if(state.general.showThinking && aiMsg.reasoning){
        const tc = panel.querySelector(".thinking-content");
        tc.textContent = aiMsg.reasoning;
        tc.scrollTop = tc.scrollHeight;
      }
    }
    // 正文
    const contentEl = body.querySelector(".content");
    if(aiMsg.content){
      if(panel && panel.classList.contains("streaming")){
        panel.classList.remove("streaming");
        panel.open = false;
        const ms = aiMsg.reasoningMs || 0;
        const prefix = state.general.showThinking ? t("thinking.done") : t("thinking.done.hidden");
        panel.querySelector(".label").textContent = `${prefix}${ms?` · ${(ms/1000).toFixed(1)}s`:""}`;
      }
      contentEl.innerHTML = renderMarkdown(aiMsg.content)+'<span class="cursor-blink"></span>';
      enhanceCodeBlocks(contentEl);
    }
    // 只在用户未离开底部时自动跟随，否则只更新按钮的"新内容"提示
    maybeAutoScroll();
  };

  // Return the assistant bubble to its "waiting" state before a retry, so a
  // failed attempt's partial output (if any) doesn't linger on screen.
  const resetAssistantBubble = ()=>{
    if(!onActive()) return;
    const msgEl = document.querySelector(".messages .msg-wrap .msg:last-child");
    if(!msgEl) return;
    const panel = msgEl.querySelector(".thinking-panel");
    if(panel) panel.remove();
    const c = msgEl.querySelector(".content");
    if(c) c.innerHTML = `<span class="typing-dots" aria-label="${escapeHtml(t("waiting.aria"))}"><span></span><span></span><span></span></span>`;
  };

  const onReasoning = (delta)=>{
    chunkCount++;
    markFirstChunk(); lastActivity = Date.now();
    // 不管开关都标记"在思考"，让指示器始终可见，避免假死
    if(!inReasoning){ inReasoning = true; reasoningStart = Date.now(); aiMsg.thought = true; }
    // 始终累积。隐藏思考时若不累积，一条"只有 CoT、没有正文"的响应会被判成空响应
    // 并整轮重试（本地小模型在 <think> 里撞上 max_tokens 时很常见）。
    // 是否展示由 refresh() 按 showThinking 决定，这里只负责不丢数据。
    aiMsg.reasoning += delta;
    refresh();
  };
  const onContent = (delta)=>{
    chunkCount++;
    markFirstChunk(); lastActivity = Date.now();
    if(inReasoning){ aiMsg.reasoningMs = Date.now() - reasoningStart; inReasoning = false; }
    aiMsg.content += delta;
    refresh();
  };
  // 解析器发现"孤儿 </think>"时回调：把已经当正文流出去的内容改判为思考。
  const onOrphanThink = ()=>{
    if(!aiMsg.content) return;
    aiMsg.thought = true;
    if(!inReasoning){ inReasoning = true; reasoningStart = firstChunkAt || Date.now(); }
    aiMsg.reasoning = aiMsg.content + aiMsg.reasoning;
    aiMsg.content = "";
    if(onActive()){
      const el = document.querySelector(".messages .msg-wrap .msg:last-child .content");
      if(el) el.innerHTML = `<span class="typing-dots" aria-label="${escapeHtml(t("waiting.aria"))}"><span></span><span></span><span></span></span>`;
    }
    refresh();
  };

  // Build tool list based on active provider and MCP registry
  let activeTools = null;
  if(state.agent?.enabled && toolRegistry.hasTools()){
    if(provider==="openai" || provider==="ollama") activeTools = toolRegistry.formatForOpenAI();
    else if(provider==="claude") activeTools = toolRegistry.formatForClaude();
    else if(provider==="gemini") activeTools = toolRegistry.formatForGemini();
  }

  let capturedToolCalls = null;
  const onToolCall = (calls)=>{
    capturedToolCalls = calls;
    aiMsg.tool_calls = calls;
  };

  // Build the per-attempt request runner once (avoids re-probing the local
  // protocol on every retry).
  let runOnce;
  let useLocalNative = false;
  if(provider==="ollama"){
    const useNative = await pickLocalProtocol(cfg);
    useLocalNative = useNative;
    runOnce = useNative
      ? (signal)=>callOllamaNative({cfg, model, chat, signal, onContent, onReasoning, onOrphanThink, onToolCall, tools:activeTools, rawCall})
      : (signal)=>callOpenAICompat({cfg, model, chat, signal, onContent, onReasoning, onOrphanThink, onToolCall, tools:activeTools, provider:"ollama", rawCall});
  }else if(provider==="openai"){
    runOnce = (signal)=>callOpenAICompat({cfg, model, chat, signal, onContent, onReasoning, onOrphanThink, onToolCall, tools:activeTools, provider, rawCall});
  }else if(provider==="claude"){
    runOnce = (signal)=>callClaude({cfg, model, chat, signal, onContent, onReasoning, onToolCall, tools:activeTools, rawCall});
  }else if(provider==="gemini"){
    runOnce = (signal)=>callGemini({cfg, model, chat, signal, onContent, onReasoning, onToolCall, tools:activeTools, rawCall});
  }else{
    runOnce = async ()=>{};
  }

  // 超时看门狗：首字节前用"连接超时"，出字节后用"停顿超时"（token 间隔）。
  // 本地模型冷加载较慢，连接超时给得宽；服务端卡死时靠停顿超时自动中断并重试。
  const CONNECT_MS = Math.max(5000, Number(state.general.connectTimeoutMs) || 60000);
  const STALL_MS   = Math.max(5000, Number(state.general.stallTimeoutMs)   || 60000);

  // Local servers (llama.cpp / LM Studio / Ollama) occasionally close the
  // stream with no tokens at all — a clean 200 but an empty answer. Auto-retry
  // a few times so a transient empty/failed response recovers itself instead of
  // surfacing a blank bubble. Tunable via state.general.emptyRetries.
  const maxAttempts = Math.max(1, (Number(state.general.emptyRetries) || 2) + 1);
  let lastErr = null;
  for(let attempt=1; attempt<=maxAttempts; attempt++){
    // Reset accumulation + indicators for this attempt.
    aiMsg.content = ""; aiMsg.reasoning = ""; aiMsg.thought = false; aiMsg.reasoningMs = 0;
    aiMsg.error = false;
    firstChunkSeen = false; firstChunkAt = 0; inReasoning = false;
    if(attempt>1){
      resetAssistantBubble();
      streamPhase(chatId, t("status.retrying", attempt, maxAttempts));
      await new Promise(r=>setTimeout(r, 400*(attempt-1))); // small linear backoff
    }

    // 每次尝试独立的中止信号：用户停止 or 看门狗超时都会触发它，
    // 但共享的 ctrl（停止按钮）只创建一次、不会因超时而作废后续重试。
    const attemptCtrl = new AbortController();
    const onUserAbort = ()=>attemptCtrl.abort();
    if(ctrl.signal.aborted) attemptCtrl.abort();
    else ctrl.signal.addEventListener("abort", onUserAbort, {once:true});
    let timedOut = false;
    lastActivity = Date.now();
    const watch = setInterval(()=>{
      const idle = Date.now() - lastActivity;
      const limit = firstChunkSeen ? STALL_MS : CONNECT_MS;
      if(idle > limit){ timedOut = true; attemptCtrl.abort(); }
    }, 1000);

    let err = null;
    try{ await runOnce(attemptCtrl.signal); }
    catch(e){ err = e; }
    finally{ clearInterval(watch); ctrl.signal.removeEventListener("abort", onUserAbort); }

    // 用户主动停止：中止且非超时触发
    if(err && err.name==="AbortError" && !timedOut){ aiMsg.content += "\n\n" + t("msg.aborted"); aiMsg.error = true; break; }
    // 看门狗触发的中止：转成可重试的超时错误
    if(timedOut && err && err.name==="AbortError"){
      err = new Error(firstChunkSeen ? t("msg.timeout.stall") : t("msg.timeout.connect"));
      err.name = "TimeoutError";
    }
    lastErr = err;

    const gotSomething = aiMsg.content.trim()!=="" || aiMsg.reasoning.trim()!=="";
    if(!err && gotSomething) break;                                  // good response
    if(attempt < maxAttempts && isRetryableLLM(err)) continue;       // transient → retry

    // Out of attempts, or a non-retryable error: surface the outcome.
    if(err){
      let hint = networkHint(err, cfg);
      if(isContextOverflow(err)) hint = t("msg.error.contextMaybe") + "\n\n" + hint;
      if(err.status === 400 && sentImages) hint = t("msg.error.visionMaybe") + "\n\n" + hint;
      aiMsg.content += `\n\n> ❌ **${t("msg.error.label")}**: ${err.message}\n\n${hint}`;
      aiMsg.error = true;
    }
    else if(!gotSomething){ aiMsg.content = t("msg.empty"); aiMsg.error = true; }
    break;
  }
  if(inReasoning){ aiMsg.reasoningMs = Date.now() - reasoningStart; }
  // 只有思考、没有正文：明确说明，而不是留个空气泡或误报"空响应"。
  if(!aiMsg.content.trim() && aiMsg.reasoning.trim()) aiMsg.content = t("msg.thinkingOnly");
  // 语言补丁兜底：尾部锁把漂移率压到 8%，剩下的这 8% 在同一上下文里补一句纠正重答。
  // 修不好就保留原文 —— 宁可交一份夹英文的答案，也不要把用户的回答弄丢。
  if(provider === "ollama" && !aiMsg.error && !ctrl.signal.aborted && needsLangRepair(chat, aiMsg.content, cfg)){
    const original = aiMsg.content, originalReasoning = aiMsg.reasoning;
    streamPhase(chatId, t("status.langRepair"));
    try{
      const ok = await runLangRepair({chat, aiMsg, cfg, model, useNative:useLocalNative,
        signal: ctrl.signal, onPartial:(partial)=>{ aiMsg.content = partial; refresh(); }});
      if(!ok){ aiMsg.content = original; aiMsg.reasoning = originalReasoning; }
    }catch(e){ aiMsg.content = original; aiMsg.reasoning = originalReasoning; }
  }
  const totalText = (aiMsg.content || "") + (aiMsg.reasoning || "");
  const exactTokens = rawCall.response.tokens || 0;
  const tokens = exactTokens > 0 ? exactTokens : Math.max(chunkCount, estimateTokenCount(totalText));
  const genDurationMs = rawCall.response.evalDurationMs || (
    (firstChunkAt && firstChunkAt > 0)
      ? Math.max(50, Date.now() - firstChunkAt)
      : Math.max(50, Date.now() - streamStartTime)
  );
  const tokPerSec = (tokens > 0 && genDurationMs > 0 && !aiMsg.error) ? Number((tokens / (genDurationMs / 1000)).toFixed(1)) : 0;
  aiMsg.tokens = tokens;
  aiMsg.durationMs = genDurationMs;
  aiMsg.tokPerSec = tokPerSec;
  rawCall.response.tokens = tokens;
  rawCall.response.tokPerSec = tokPerSec;
  rawCall.response.durationMs = genDurationMs;

  // 最终渲染：仅当此会话在前台时更新 DOM；否则数据已存入 aiMsg，
  // 切回该会话时由 renderMessages 重建。
  if(onActive()){
    const msgEl = document.querySelector(".messages .msg-wrap .msg:last-child");
    if(msgEl){
      const panel = msgEl.querySelector(".thinking-panel");
      if(panel){
        panel.classList.remove("streaming");
        panel.open = false;
        const ms = aiMsg.reasoningMs || 0;
        const prefix = (state.general.showThinking && aiMsg.reasoning) ? t("thinking.done") : t("thinking.done.hidden");
        panel.querySelector(".label").textContent = `${prefix}${ms?` · ${(ms/1000).toFixed(1)}s`:""}`;
      }
      const last = msgEl.querySelector(".content");
      last.innerHTML = renderMarkdown(aiMsg.content);
      enhanceCodeBlocks(last);
      renderMathIn(last);
      enhanceMermaid(last);
      // 更新速度指示器
      const actBar = msgEl.querySelector(".msg-actions");
      if(actBar && !actBar.querySelector(".tok-speed") && tokPerSec > 0){
        const badge = document.createElement("span");
        badge.className = "tok-speed";
        badge.innerHTML = `<svg class="mi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span class="lbl">${tokPerSec} tok/s</span>`;
        badge.title = `${tokens ? tokens + " tokens · " : ""}${tokPerSec} tokens/s`;
        actBar.prepend(badge);
      }
    }
  }
  rawCall.response.content = aiMsg.content;
  rawCall.response.reasoning = aiMsg.reasoning;
  rawCall.response.reasoningMs = aiMsg.reasoningMs || 0;
  if(aiMsg.error){
    rawCall.response.status = lastErr?.status || (lastErr?.name === "AbortError" ? 499 : 500);
    rawCall.response.statusText = lastErr?.name || "Error";
    rawCall.response.error = lastErr?.message || "Request failed";
  }
  streamEnd(chatId);
  saveState();
  return {
    toolCalls: capturedToolCalls,
    error: aiMsg.error,
    aborted: ctrl.signal.aborted
  };
}

