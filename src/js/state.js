/* ============================================================
   AChat — Single-file multi-provider chat UI
   ============================================================ */

const LS_KEY = "achat_v1";
const detectLang = () => "en";
const DEFAULT_STATE = {
  theme: "light",
  lang: "en",
  chats: [],            // [{id,title,model,messages:[{role,content,attachments,time}],systemPrompt,createdAt}]
  trash: [],            // [{id,title,model,messages,deletedAt,...}]
  activeChatId: null,
  notepad: {            // 记事本：知识卡片 + 待办
    notes: [],          // [{id,title,body,src,time}]
    todos: []           // [{id,text,done,time,due}]  due=预计完成时间(ms)或 null
  },
  config: {
    providers: [],
    mcpServers: []        // [{id, name, url, apiKey, enabled}]
  },
  agent: {
    enabled: true,
    maxTurns: 10,
    autoApprove: true
  },
  general: {
    systemPrompt:"You are a helpful assistant. Answer in the user's language.",
    temperature:0.7,
    maxTokens:"",
    // 采样参数：留空 = 该字段完全不发送（本地小模型缺 top_k/min_p/presence_penalty 极易复读）
    topP:"", topK:"", minP:"", presencePenalty:"",
    thinkMode:"auto",       // auto | on | off —— 是否"请求"模型思考（与 showThinking 的"是否展示"分离）
    numCtx:"",              // Ollama num_ctx，留空 = 用服务端默认（常见 4096）
    keepAlive:"30m",        // Ollama keep_alive，避免每轮冷加载撞上连接看门狗
    contextTokenBudget:"",  // token 预算二级裁剪，留空 = 不启用
    historyN:40,
    showThinking:true,
    userName:"",
    aiName:"AI",
    scenarioAutoCompress:true,
    scenarioCompressChars:4000,
    scenarioMemoryMaxChars:800,
    imageDetail:"standard",
    attachmentKeepRecent:1
  },
  lastModel:""
};

