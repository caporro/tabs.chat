/* ------------------------- Send / Streaming ------------------------- */
async function sendMessage(){
  closeNoteMentions();
  if(typeof stopVoiceInput === "function") stopVoiceInput();
  const ta = document.getElementById("input");
  const text = ta.value.trim();
  if(!text && pendingAttachments.length===0) return;

  if(!hasConfiguredLLM()){
    openSettings("providers");
    flashStatus(t("onboarding.configureFirst"));
    return;
  }

  const sel = document.getElementById("modelSelect").value;
  if(!sel){
    openSettings("providers");
    flashStatus(t("alert.modelRequiredSend"));
    return;
  }

  let chat = currentChat();
  if(!chat){ newChat(); chat = currentChat(); }
  try {
    captureRequestPromptContext(chat,sel);
    effectiveSystemPrompt(chat);
  } catch(error){
    delete chat._promptContext;
    flashStatus(error.message);
    showToast(error.message,6000);
    if(chat.promptMode === "override") openChatPromptModal();
    else openSettings("instructions");
    return;
  }
  chat.model = sel; state.lastModel = sel;

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

  try {
    if(state.toolSettings?.enabled && toolRegistry.hasTools()){
      await runAgentLoop(chat, aiMsg, sel);
    } else {
      await streamResponse(chat, aiMsg, sel);
    }
  } finally { delete chat._promptContext; }
  // Scenario chats: auto-fold older context into long-term memory when it grows too large.
  maybeAutoCompress(chat);
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

