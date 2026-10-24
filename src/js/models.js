/* ------------------------- Models / Providers ------------------------- */
function parseModelEntry(line){
  const clean = (line||"").replace(/#.*$/,"").trim();
  if(!clean) return null;
  let model = clean;
  let nick = "";
  if(clean.includes("|")){
    const parts = clean.split("|");
    model = parts[0].trim();
    nick = parts.slice(1).join("|").trim();
  }else if(clean.includes("->")){
    const parts = clean.split("->");
    model = parts[0].trim();
    nick = parts.slice(1).join("->").trim();
  }else if(clean.includes("=>")){
    const parts = clean.split("=>");
    model = parts[0].trim();
    nick = parts.slice(1).join("=>").trim();
  }else if(clean.includes(" = ")){
    const parts = clean.split(" = ");
    model = parts[0].trim();
    nick = parts.slice(1).join(" = ").trim();
  }else if(/:\s+/.test(clean)){
    const idx = clean.search(/:\s+/);
    model = clean.slice(0, idx).trim();
    nick = clean.slice(idx + 1).trim();
  }
  if(!model) return null;
  return { model, nick };
}
function parseModelEntries(text){
  return (text||"").split("\n").map(parseModelEntry).filter(Boolean);
}
function parseModelLines(text){
  return parseModelEntries(text).map(e => e.model);
}
function formatModelEntry(model, nick){
  const m = (model||"").trim();
  const n = (nick||"").trim();
  if(!m) return "";
  return n ? `${m} | ${n}` : m;
}
function updateModelNickInText(text, model, newNick){
  const lines = (text||"").split("\n");
  let found = false;
  const newLines = lines.map(line => {
    const e = parseModelEntry(line);
    if(!e) return line;
    if(e.model === model){
      found = true;
      return formatModelEntry(e.model, newNick);
    }
    return line;
  });
  if(!found && model){
    newLines.push(formatModelEntry(model, newNick));
  }
  return newLines.join("\n");
}
// 已知服务商的展示名（大小写美化）；其它情况直接从 host 派生
const KNOWN_VENDORS = {
  "openai":"OpenAI", "deepseek":"DeepSeek", "moonshot":"Moonshot",
  "siliconflow":"SiliconFlow", "openrouter":"OpenRouter", "groq":"Groq",
  "together":"Together", "fireworks":"Fireworks", "anthropic":"Anthropic",
  "mistral":"Mistral", "perplexity":"Perplexity", "bigmodel":"GLM", "zhipuai":"GLM",
  "dashscope":"Qwen", "aliyuncs":"Qwen", "minimax":"MiniMax", "stepfun":"Step",
  "lingyiwanwu":"Yi", "baichuan-ai":"Baichuan", "xai":"xAI", "x":"xAI",
  "cohere":"Cohere", "azure":"Azure", "novita":"Novita", "ppinfra":"PPInfra",
  "volces":"Doubao", "volcengine":"Doubao", "bailian":"Bailian", "tencentcloudapi":"Hunyuan",
  "tigerbot":"TigerBot", "infini-ai":"Infini", "modelscope":"ModelScope"
};
function openaiVendorLabel(base){
  if(!base) return "OpenAI";
  try{
    const u = new URL(base);
    // localhost / 内网 IP：直接给个"本地"类标记
    if(/^(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)){
      return `${t("vendor.local")}:${u.port||u.hostname}`;
    }
    let h = u.hostname.toLowerCase();
    // 去掉常见前缀
    h = h.replace(/^(api|apis|open-?api|gw|gateway|llm|ai|chat|console|inference|service)\./, "");
    const parts = h.split(".").filter(Boolean);
    let main = parts[0] || "";
    // 形如 dashscope.aliyuncs.com → main=dashscope；若 main 太通用，再看下一段
    if(["www","com","cn","net","org","io","co"].includes(main) && parts[1]) main = parts[1];
    if(!main) return "OpenAI";
    if(KNOWN_VENDORS[main]) return KNOWN_VENDORS[main];
    return main.charAt(0).toUpperCase() + main.slice(1);
  }catch{ return "OpenAI"; }
}
function getAllModels(){
  const providers = getProviders();
  const list = [];
  for(const p of providers){
    if(p.enabled === false) continue;
    let labelPrefix = p.name;
    if(!labelPrefix){
      if(p.type === "openai") labelPrefix = openaiVendorLabel(p.base);
      else if(p.type === "claude") labelPrefix = "Claude";
      else if(p.type === "gemini") labelPrefix = "Gemini";
      else if(p.type === "ollama") labelPrefix = t("vendor.local") || "Local";
      else labelPrefix = p.type;
    }
    parseModelEntries(p.models).forEach(({ model: m, nick }) => {
      const display = nick || m;
      list.push({
        id: `${p.id}::${m}`,
        providerId: p.id,
        providerType: p.type,
        model: m,
        nick: nick || "",
        displayName: display,
        label: `${labelPrefix} · ${display}`
      });
    });
  }
  return list;
}
function syncSelectedModelName(modelId){
  if(!modelId) return;
  const models = getAllModels();
  const found = models.find(m => m.id === modelId) || models.find(m => m.model === modelId);
  const name = found ? (found.nick || found.model) : (modelId.includes("::") ? modelId.split("::")[1] : modelId);
  state.general.aiName = name;
  const aiInput = document.getElementById("cfg_ai_name");
  if(aiInput) aiInput.value = name;
}
function populateModelSelect(){
  const sel = document.getElementById("modelSelect");
  const models = getAllModels();
  sel.innerHTML = "";
  if(!models.length){
    const o = document.createElement("option"); o.textContent=t("model.select.empty"); o.value=""; sel.appendChild(o); return;
  }
  for(const m of models){
    const o = document.createElement("option"); o.value=m.id; o.textContent=m.label;
    if(m.nick){ o.title = `${m.nick} (${m.model})`; }
    sel.appendChild(o);
  }
  const chat = currentChat();
  const want = chat?.model || state.lastModel || models[0].id;
  if(models.find(m=>m.id===want)) sel.value = want;
  else sel.value = models[0].id;
  if(chat){ chat.model = sel.value; saveState(); }
  state.lastModel = sel.value;
  syncSelectedModelName(sel.value);
}

