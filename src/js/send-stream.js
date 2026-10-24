/* ------------------------- Send / Streaming ------------------------- */
async function sendMessage(){
  const ta = document.getElementById("input");
  const text = ta.value.trim();
  if(!text && pendingAttachments.length===0) return;
  let chat = currentChat();
  if(!chat){ newChat(); chat = currentChat(); }

  // Welcome chat without any configured LLM → reply with a canned onboarding tip
  const welcomeMode = chat.isWelcome && !hasConfiguredLLM();

  const sel = document.getElementById("modelSelect").value;
  if(!welcomeMode){
    if(!sel){ alert(t("alert.modelRequiredSend")); return; }
    chat.model = sel; state.lastModel = sel;
  }

  const userMsg = {
    role:"user", content:text,
    attachments: pendingAttachments.slice(),
    time: Date.now()
  };
  chat.messages.push(userMsg);
  pendingAttachments = []; renderAttachStrip();
  ta.value = ""; autoresize(ta);

  // auto title
  const defaultTitleZh = "新对话";
  const defaultTitleEn = "New chat";
  const welcomeTitleEn = "Welcome", welcomeTitleZh = "欢迎";
  if(chat.messages.filter(m=>m.role==="user").length===1 && (chat.title===defaultTitleZh || chat.title===defaultTitleEn || chat.title===welcomeTitleEn || chat.title===welcomeTitleZh || !chat.title)){
    chat.title = (text || userMsg.attachments[0]?.name || t("chat.new.default")).slice(0,30);
  }

  const aiMsg = { role:"assistant", content:"", reasoning:"", reasoningMs:0, thought:false, time:Date.now() };
  chat.messages.push(aiMsg);
  saveState(); renderChatList(); renderMessages(); updateTopBar();

  if(welcomeMode){
    await sendWelcomeReply(chat, aiMsg);
    return;
  }
  if(state.agent?.enabled && toolRegistry.hasTools()){
    await runAgentLoop(chat, aiMsg, sel);
  } else {
    await streamResponse(chat, aiMsg, sel);
  }
  // Scenario chats: auto-fold older context into long-term memory when it grows too large.
  maybeAutoCompress(chat);
}

/* Fake-streamed canned tip when chat.isWelcome and no LLM configured */
async function sendWelcomeReply(chat, aiMsg){
  setSending(true, t("status.connecting"));
  // Small "thinking" delay so it feels like a response, not a teleport
  await new Promise(r=>setTimeout(r, 350 + Math.random()*250));
  setSending(true, t("status.generating"));
  // Pick a random tip; avoid repeating the immediately previous one if possible
  const pool = WELCOME_TIP_KEYS.slice();
  const lastTipKey = [...chat.messages].reverse().find(m=>m.role==="assistant" && m._welcomeTipKey)?._welcomeTipKey;
  const candidates = lastTipKey && pool.length>1 ? pool.filter(k=>k!==lastTipKey) : pool;
  const tipKey = candidates[Math.floor(Math.random()*candidates.length)];
  aiMsg._welcomeTipKey = tipKey;
  const full = t(tipKey);
  // Type out gradually for a small bit of polish
  const chunkSize = Math.max(2, Math.ceil(full.length/40));
  for(let i=0;i<full.length;i+=chunkSize){
    aiMsg.content = full.slice(0, i+chunkSize);
    const msgEl = document.querySelector(".messages .msg-wrap .msg:last-child");
    if(msgEl){
      const contentEl = msgEl.querySelector(".content");
      contentEl.innerHTML = renderMarkdown(aiMsg.content)+'<span class="cursor-blink"></span>';
      enhanceCodeBlocks(contentEl);
    }
    maybeAutoScroll();
    await new Promise(r=>setTimeout(r, 12));
  }
  aiMsg.content = full;
  const msgEl = document.querySelector(".messages .msg-wrap .msg:last-child");
  if(msgEl){
    const last = msgEl.querySelector(".content");
    last.innerHTML = renderMarkdown(aiMsg.content);
    enhanceCodeBlocks(last);
    renderMathIn(last);
  }
  setSending(false);
  saveState();
}

// 解析内联 <think>/<thinking> 标签的流式状态机
// 额外能力：剥离聊天模板泄漏前缀（如 "assistant\n\n<think>..."、"<|im_start|>assistant\n..."）
function makeThinkTagParser(onReasoning, onContent, onOrphanClose){
  let mode = null;          // null | 'think' | 'content'
  let closeTag = ""; let closeLen = 0;
  let pending = "";
  let stripped = false;     // 是否已完成前缀剥离
  let sawOpen = false;      // 是否见过 <think> 开标签
  let orphanDone = false;   // 是否已处理过"孤儿闭合标签"
  const OPEN = /<(think|thinking)>/i;
  const CLOSE_ANY = /<\/(think|thinking)>/i;
  const TAIL_PREFIX = /<(t(h(i(n(k(i(n(g)?)?)?)?)?)?)?)?$/i;
  // 末尾可能是 </think> 的一半（"<"、"</"、"</thin" …），先扣住别当正文吐出
  const TAIL_CLOSE = /<\/?(t(h(i(n(k(i(n(g)?)?)?)?)?)?)?)?$/i;
  // 常见角色 token 泄漏
  const LEAKS = [
    'assistant\n', 'Assistant\n', 'model\n', 'Model\n',
    '<|im_start|>assistant\n', '<|assistant|>\n',
    '<start_of_turn>model\n'
  ];
  function tryStrip(){
    if(stripped) return true;
    const trimmed = pending.replace(/^\s*/, '');
    for(const p of LEAKS){
      if(trimmed.startsWith(p)){
        pending = trimmed.slice(p.length).replace(/^\s+/, '');
        stripped = true; return true;
      }
      // 仍可能是某个 leak 的前缀 → 等更多数据
      if(p.startsWith(trimmed) && trimmed.length > 0) return false;
    }
    stripped = true; return true;
  }
  function feed(chunk){
    pending += chunk;
    while(pending.length){
      if(!stripped && !tryStrip()) return;
      if(mode === null){
        // 纯空白：继续等，避免在 <think> 真正到来前把换行/空格当正文
        if(!/\S/.test(pending)) return;
        const m = pending.match(OPEN);
        if(m){
          const before = pending.slice(0, m.index);
          if(before.trim().length > 0) onContent(before); // 跳过纯空白前导
          sawOpen = true;
          mode = 'think';
          closeTag = `</${m[1].toLowerCase()}>`; closeLen = closeTag.length;
          pending = pending.slice(m.index + m[0].length).replace(/^\s+/, '');
          continue;
        }
        if(TAIL_PREFIX.test(pending)) return; // 末尾可能正好是 <think> 前缀
        mode = 'content';
        continue;
      }
      if(mode === 'think'){
        const i = pending.toLowerCase().indexOf(closeTag);
        if(i >= 0){
          if(i>0) onReasoning(pending.slice(0,i));
          pending = pending.slice(i + closeLen).replace(/^\s+/, '');
          mode = 'content';
          continue;
        }
        if(pending.length > closeLen){ onReasoning(pending.slice(0,-closeLen)); pending = pending.slice(-closeLen); }
        return;
      }
      if(mode === 'content'){
        const o = pending.match(OPEN);
        // 孤儿闭合标签：有些 chat template 会在 prompt 末尾预填 <think>（DeepSeek-R1 系
        // 最典型），模型输出里因此只剩一个 </think>。这时前面流出去的其实全是思考 ——
        // 只在从未见过开标签时才这么判，见过一次就说明该模型是成对输出的。
        const c = (!sawOpen && !orphanDone) ? pending.match(CLOSE_ANY) : null;
        if(o && (!c || o.index < c.index)){
          // 正文之后才出现 <think>（部分模型会先寒暄再思考）：正常进入思考段
          if(o.index > 0) onContent(pending.slice(0, o.index));
          sawOpen = true;
          mode = 'think';
          closeTag = `</${o[1].toLowerCase()}>`; closeLen = closeTag.length;
          pending = pending.slice(o.index + o[0].length).replace(/^\s+/, '');
          continue;
        }
        if(c){
          orphanDone = true;
          if(onOrphanClose) onOrphanClose();   // 已当正文流出的部分改判为思考
          const before = pending.slice(0, c.index);
          if(before) onReasoning(before);
          pending = pending.slice(c.index + c[0].length).replace(/^\s+/, '');
          continue;
        }
        // 末尾可能是标签的一半，扣住等下一个 chunk（flush 时会补吐出来）
        const tail = pending.match(TAIL_CLOSE);
        if(tail && tail[0]){
          if(tail.index > 0) onContent(pending.slice(0, tail.index));
          pending = pending.slice(tail.index);
          return;
        }
        onContent(pending); pending = "";
        return;
      }
    }
  }
  feed.flush = ()=>{
    if(pending){
      stripped = true;
      if(mode === 'think') onReasoning(pending);
      else onContent(pending);
      pending = "";
    }
  };
  return feed;
}

// Should an attempt be retried? `err === null` means the stream finished
// cleanly but produced nothing (the local-server "empty response" case) —
// always worth another try. Real errors are only retried when transient.
function isRetryableLLM(err){
  if(!err) return true;                          // clean finish, no tokens → retry
  if(err.name === "AbortError") return false;    // user pressed stop
  if(err.name === "TimeoutError") return true;   // connect/stall watchdog fired
  if(err.name === "TypeError") return true;      // network/CORS/connection reset
  if(typeof err.status === "number" && err.status >= 500) return true; // server busy / model loading
  return false;                                  // 4xx, auth, parse errors → don't hammer
}

