import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const requests = [];
const context = vm.createContext({
  URL, Response, TextDecoder, structuredClone,
  icon: () => "", t: key => key,
  effectiveSystemPrompt: () => "",
  lastN: messages => messages,
  computeAttachmentAllowSet: () => new Set(),
  mergeAdjacentRoles: messages => messages,
  sanitizeBodyForRecord: structuredClone,
  maskApiKey: () => "***",
  connectionFetch: async (_connection, url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    const nonReasoning = body.model === "qwen2.5:0.5b" || url.includes(`/models/${encodeURIComponent("qwen2.5:0.5b")}:`);
    const hasThinkingControl = ["think", "chat_template_kwargs", "reasoning", "include_reasoning"].some(key => Object.hasOwn(body, key))
      || Object.hasOwn(body.generationConfig || {}, "thinkingConfig");
    if(nonReasoning && hasThinkingControl){
      return new Response(JSON.stringify({ error: '"qwen2.5:0.5b" does not support thinking' }), { status: 400, statusText: "Bad Request" });
    }
    const thinking = nonReasoning ? "" : "Fixture reasoning";
    if(url.endsWith("/api/chat")){
      return new Response(JSON.stringify({ message: { thinking, content: "Fixture answer" }, done: true }) + "\n");
    }
    const event = url.includes(":streamGenerateContent")
      ? { candidates: [{ content: { parts: [...(thinking ? [{ thought: true, text: thinking }] : []), { text: "Fixture answer" }] }, finishReason: "STOP" }] }
      : { choices: [{ delta: { reasoning_content: thinking, content: "Fixture answer" }, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
  }
});
for(const file of ["state.js", "provider-helpers.js", "send-stream.js", "providers/sse.js", "providers/openai.js", "providers/ollama.js", "providers/gemini.js"]){
  vm.runInContext(await fs.readFile(new URL(`src/js/${file}`, root), "utf8"), context);
}

const adapters = [
  { name: "Ollama native", call: context.callOllamaNative, type: "ollama", base: "http://localhost:11434" },
  { name: "Ollama compatible", call: context.callOpenAICompat, type: "ollama", base: "http://localhost:11434" },
  { name: "OpenAI compatible", call: context.callOpenAICompat, type: "openai", base: "https://fixture.invalid/v1" },
  { name: "OpenRouter", call: context.callOpenAICompat, type: "openrouter", base: "https://openrouter.ai/api/v1" },
  { name: "Gemini", call: context.callGemini, type: "gemini", base: "https://fixture.invalid/v1beta" }
];

async function request(adapter, mode, showThinking, model = "thinking-fixture"){
  Object.assign(vm.runInContext("state.general", context), { thinkMode: mode, showThinking });
  const content = [], reasoning = [];
  const rawCall = { request: {}, response: {} };
  const before = requests.length;
  await adapter.call({
    cfg: { type: adapter.type, base: adapter.base, key: "" }, provider: adapter.type, model,
    chat: { messages: [{ role: "user", content: "Hello" }] }, rawCall,
    onContent: chunk => content.push(chunk), onReasoning: chunk => reasoning.push(chunk)
  });
  assert.equal(requests.length, before + 1, `${adapter.name}: request should succeed without retrying`);
  assert.equal(content.join(""), "Fixture answer", `${adapter.name}: reasoning must not leak into the answer`);
  assert.deepEqual(reasoning, model === "qwen2.5:0.5b" ? [] : ["Fixture reasoning"], `${adapter.name}: preserve any returned reasoning even when hidden`);
  const { body } = requests.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(rawCall.request.body)), body);
  return body;
}

for(const adapter of adapters){
  for(const mode of ["auto", "on", "off"]){
    const shown = await request(adapter, mode, true);
    const hidden = await request(adapter, mode, false);
    assert.deepEqual(shown, hidden, `${adapter.name}: visibility must not alter the request (${mode})`);
    if(mode === "auto"){
      for(const key of ["think", "chat_template_kwargs", "reasoning", "include_reasoning"]){
        assert.equal(Object.hasOwn(shown, key), false, `${adapter.name}: Auto must omit ${key}`);
      }
      assert.equal(Object.hasOwn(shown.generationConfig || {}, "thinkingConfig"), false);
    } else {
      if(adapter.type === "ollama") assert.equal(shown.think, mode === "on");
      if(adapter.type === "openai") assert.equal(shown.chat_template_kwargs.enable_thinking, mode === "on");
      if(adapter.type === "openrouter") assert.deepEqual(shown.reasoning, { enabled: mode === "on" });
      if(adapter.type === "gemini") assert.deepEqual(shown.generationConfig.thinkingConfig, mode === "on" ? { includeThoughts: true } : { thinkingBudget: 0 });
    }
  }
  for(const visible of [true, false]) await request(adapter, "auto", visible, "qwen2.5:0.5b");
}
console.log("✓ Auto omits thinking controls, non-reasoning models succeed, explicit modes stay independent of visibility, and streamed reasoning remains separate from answers");
