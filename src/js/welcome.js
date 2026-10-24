/* ------------------------- Welcome chat ------------------------- */
const WELCOME_SUGGESTIONS = ["welcome.q1","welcome.q2","welcome.q3","welcome.q4"];
const WELCOME_TIP_KEYS = ["welcome.tip.1","welcome.tip.2","welcome.tip.3","welcome.tip.4","welcome.tip.5"];
function hasConfiguredLLM(){
  const providers = getProviders();
  if(!providers || !providers.length) return false;
  return providers.some(p => p.enabled !== false && ((p.key||"").trim() || p.type === "ollama"));
}
function createWelcomeChat(){
  const id = uid();
  const chat = {
    id,
    title: t("welcome.title"),
    model: state.lastModel || "",
    systemPrompt: state.general.systemPrompt,
    messages: [
      { role:"assistant", i18nKey:"welcome.greeting", content:"", time: Date.now() }
    ],
    isWelcome: true,
    createdAt: Date.now()
  };
  state.chats.unshift(chat);
  state.activeChatId = id;
  saveState();
}

