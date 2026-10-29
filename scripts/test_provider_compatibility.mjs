import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const requests = [];
let selectedProvider, respond;
function successfulResponse(url){
  if(url.endsWith("/api/chat")) return new Response('{"message":{"content":"Fixture answer"},"done":true}\n');
  const event = url.endsWith("/messages")
    ? { type: "content_block_delta", delta: { type: "text_delta", text: "Fixture answer" } }
    : url.includes(":streamGenerateContent")
      ? { candidates: [{ content: { parts: [{ text: "Fixture answer" }] } }] }
      : { choices: [{ delta: { content: "Fixture answer" }, finish_reason: "stop" }] };
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
}
function rejected(message, status = 400){
  return new Response(JSON.stringify({ error: message }), { status, statusText: "Rejected" });
}
respond = successfulResponse;
const context = vm.createContext({
  URL, Response, TextDecoder, structuredClone, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
  icon: () => "", t: key => key,
  effectiveSystemPrompt: () => "", lastN: messages => messages, computeAttachmentAllowSet: () => new Set(),
  getProviderForChat: () => selectedProvider,
  renderChatList(){}, saveState(){},
  estimateTokenCount: text => Math.ceil(text.length / 4),
  connectionFetch: async (_connection, url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    return respond(url, body);
  }
});
for(const file of ["state.js", "provider-helpers.js", "send-stream.js", "providers/sse.js", "providers/openai.js", "providers/ollama.js", "providers/anthropic.js", "providers/gemini.js", "agent/tools-registry.js", "inspector.js"]){
  vm.runInContext(await fs.readFile(new URL(`src/js/${file}`, root), "utf8"), context);
}
const run = code => vm.runInContext(code, context);
const state = run("state"), agent = context.getCurrentAgent();
const adapters = [
  { type: "openai", base: "https://api.openai.com/v1", method: "callOpenAICompat", limitKey: "max_completion_tokens" },
  { type: "openai", base: "https://compatible.invalid/v1", method: "callOpenAICompat", limitKey: "max_tokens" },
  { type: "ollama", base: "http://localhost:11434", method: "callOllamaNative", limitKey: "num_predict" },
  { type: "ollama", base: "http://localhost:11434/v1", method: "callOpenAICompat", limitKey: "max_tokens" },
  { type: "claude", base: "https://fixture.invalid/v1", method: "callClaude", limitKey: "max_tokens" },
  { type: "gemini", base: "https://fixture.invalid/v1beta", method: "callGemini", limitKey: "maxOutputTokens" }
];

async function request(adapter, tools = null){
  const rawCall = { request: {}, response: {} };
  let content = "";
  await context[adapter.method]({
    cfg: { type: adapter.type, base: adapter.base, key: "" }, provider: adapter.type, model: "fixture-model",
    chat: { messages: [{ role: "user", content: "Hello" }] }, tools, rawCall,
    onContent: chunk => { content += chunk; }, onReasoning(){}
  });
  assert.equal(content, "Fixture answer");
  assert.deepEqual(JSON.parse(JSON.stringify(rawCall.request.body)), requests.at(-1).body);
  return requests.at(-1).body;
}
function generation(body){ return body.options || body.generationConfig || body; }

// Legacy general defaults must not override an agent's explicit Auto choice.
state.general.temperature = 0.7;
for(const adapter of adapters){
  for(const temperature of [null, "", 0, 0.7]){
    agent.temperature = temperature;
    const body = await request(adapter);
    assert.equal(Object.hasOwn(generation(body), "temperature"), temperature !== null && temperature !== "");
    if(typeof temperature === "number") assert.equal(generation(body).temperature, temperature);
  }
  agent.temperature = null;
  state.general.maxTokens = "257";
  const body = await request(adapter);
  assert.equal(generation(body)[adapter.limitKey], 257);
  const keys = ["max_tokens", "max_completion_tokens", "maxOutputTokens", "num_predict"];
  assert.equal(keys.filter(key => Object.hasOwn(generation(body), key)).length, 1);
  state.general.maxTokens = "";
  const defaultBody = await request(adapter);
  assert.equal(generation(defaultBody)[adapter.limitKey], adapter.type === "claude" ? 4096 : undefined);
}
for(const invalid of ["0", "-1", "1.5", "garbage"]){
  state.general.maxTokens = invalid;
  const before = requests.length;
  await assert.rejects(request(adapters[0]), /msg.error.tokenLimit/);
  assert.equal(requests.length, before, "An invalid cap must never become an uncapped request");
}

state.general.maxTokens = "257";
const tool = { type: "function", function: { name: "fixture_lookup", parameters: { type: "object", properties: {} } } };
for(const [adapter, unsupported, expected] of [[adapters[0], "max_completion_tokens", "max_tokens"], [adapters[1], "max_tokens", "max_completion_tokens"]]){
  const before = requests.length;
  respond = (url, body) => Object.hasOwn(body, unsupported) ? rejected(`Unsupported parameter: '${unsupported}'. Use '${expected}' instead.`) : successfulResponse(url);
  const body = await request(adapter, [tool]);
  assert.equal(requests.length - before, 2);
  assert.equal(body[expected], 257);
  assert.equal(Object.hasOwn(body, unsupported), false);
  assert.deepEqual(body.tools, [tool], "Token-parameter fallback must preserve tool declarations");
}
respond = (url, body) => Object.hasOwn(body, "max_tokens")
  ? rejected("Unsupported parameter: max_tokens. Use max_completion_tokens instead.")
  : body.stream_options ? rejected("Unknown field: stream_options") : successfulResponse(url);
let before = requests.length;
const adjusted = await request(adapters[1], [tool]);
assert.equal(requests.length - before, 3);
assert.equal(adjusted.max_completion_tokens, 257, "Optional-field fallback must preserve the renamed cap");
assert.deepEqual(adjusted.tools, [tool]);
before = requests.length;
respond = () => rejected("Unsupported parameter: max_tokens", 401);
await assert.rejects(request(adapters[1]), /401/);
assert.equal(requests.length - before, 1, "Authentication failures must not trigger compatibility retries");
respond = () => rejected("Unsupported parameter: max_tokens; max_completion_tokens is not supported either");
before = requests.length;
await assert.rejects(request(adapters[1]), /400/);
assert.equal(requests.length - before, 2, "Token-parameter fallback must stop after one swap");

// Exercise the real orchestrator: capability errors retry once, schema errors do not.
state.general.maxTokens = "";
state.toolSettings.enabled = true;
selectedProvider = { id: "fixture", type: "openai", base: "https://compatible.invalid/v1", key: "", models: "fixture-model" };
async function stream(history = []){
  const ai = { role: "assistant", content: "", reasoning: "", reasoningMs: 0, thought: false };
  const chat = { id: "background-fixture", messages: [...history, { role: "user", content: "Hello" }, ai] };
  const result = await context.streamResponse(chat, ai, "fixture::fixture-model");
  return { ai, result };
}
respond = (url, body) => body.tools?.length ? rejected('"fixture-model" does not support tools') : successfulResponse(url);
before = requests.length;
const recovered = await stream();
assert.equal(requests.length - before, 2);
assert.equal(recovered.result.error, false);
assert.equal(recovered.ai.content, "Fixture answer");
assert.equal(recovered.ai.notice, "msg.toolsUnsupported");
assert.equal(recovered.ai.rawCall.meta.toolsUnsupported, true);
assert.equal(Object.hasOwn(recovered.ai.rawCall.request.body, "tools"), false);
assert.equal(state.toolSettings.enabled, true, "Capability fallback must not change the agent's settings");
before = requests.length;
const toolHistory = await stream([{ role: "tool", name: "fixture_lookup", tool_call_id: "prior", content: "Prior result" }]);
assert.equal(requests.length - before, 1);
assert.equal(toolHistory.result.error, true);
assert.equal(toolHistory.ai.notice, undefined, "Tool history must not be silently discarded");

respond = () => rejected("Invalid tools[0].function.parameters: properties must be an object");
before = requests.length;
const schemaError = await stream();
assert.equal(requests.length - before, 1);
assert.equal(schemaError.result.error, true);
assert.equal(schemaError.ai.notice, undefined);

// Native Ollama must recover through the same orchestrator, without an OpenAI retry path.
selectedProvider = { ...selectedProvider, type: "ollama", base: "http://localhost:11434", protocol: "ollama" };
run("checkOllamaLoaded = async () => true");
respond = (url, body) => body.tools?.length ? rejected('"fixture-model" does not support tools') : successfulResponse(url);
before = requests.length;
const native = await stream();
assert.equal(requests.length - before, 2);
assert.equal(native.result.error, false);
assert.equal(native.ai.notice, "msg.toolsUnsupported");

for(const type of ["claude", "gemini"]){
  selectedProvider = { ...selectedProvider, type, base: "https://fixture.invalid/v1" };
  respond = (url, body) => body.tools?.length ? rejected("Function calling is not supported by this model") : successfulResponse(url);
  before = requests.length;
  const recovered = await stream();
  assert.equal(requests.length - before, 2);
  assert.equal(recovered.result.error, false);
  assert.equal(recovered.ai.notice, "msg.toolsUnsupported");
}

const geminiTools = run("toolRegistry.formatForGemini()[0].functionDeclarations");
assert.equal(Object.hasOwn(geminiTools.find(tool => tool.name === "get_current_datetime"), "parameters"), false);
assert.ok(geminiTools.find(tool => tool.name === "calculator").parameters.properties.expression);
console.log("✓ Temperature Auto and explicit zero, provider token fields and bounded cap-preserving retries, tool capability fallback, schema errors, tool history and Gemini parameterless functions");
