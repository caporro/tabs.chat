import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
let calls = [];
let responder = async () => new Response('{"data":[{"id":"fixture-model"}]}', { headers: { "Content-Type": "application/json" } });
const context = vm.createContext({
  URL, Response, Headers, ReadableStream, TextEncoder, AbortController, console,
  fetch: async (url, options) => { calls.push({ url, options }); return responder(url, options); },
  escapeHtml: value => String(value).replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  t: key => key, icon: () => "", structuredClone
});
for(const file of ["src/js/state.js", "src/js/provider-helpers.js", "src/js/connection-access.js"]){
  vm.runInContext(await fs.readFile(new URL(file, root), "utf8"), context);
}
const wiring = await fs.readFile(new URL("src/js/ui/wiring.js", root), "utf8");
vm.runInContext(wiring.slice(wiring.indexOf("async function fetchModelsForType("), wiring.indexOf("\nfunction renderModelPickerPanel(")), context);
const run = code => vm.runInContext(code, context);
run(`var connection = {id:"fixture",type:"openai",base:"https://api.example.com/v1",key:"private-key"};`);
const target = "https://api.example.com/v1/models?limit=2&order=asc";
const signal = new AbortController().signal;
context.options = { method: "POST", headers: { Authorization: "Bearer private-key", "Content-Type": "application/json" }, body: '{"fixture":true}', signal };
context.target = target;

await run("connectionFetch(connection,target,options)");
assert.equal(calls[0].url, target);
assert.equal(calls[0].options.signal, signal);
assert.equal(run("connectionAccessInfo(connection).label"), "Direct access verified");
assert.equal(JSON.stringify(run("connection")).includes("verified"), false);

run(`connection.proxy={enabled:true,url:"https://relay.example/?url={encodedUrl}"}`);
assert.equal(run("connectionAccessInfo(connection).state"), "unknown");
calls = [];
await run("connectionFetch(connection,target,options)");
assert.equal(calls[0].url, "https://relay.example/?url=" + encodeURIComponent(target));
assert.equal(calls[0].options.body, '{"fixture":true}');
assert.equal(calls[0].options.headers.Authorization, "Bearer private-key");
assert.equal(calls[0].options.credentials, "omit");
assert.equal(calls[0].options.redirect, "error");
assert.equal(run("connectionAccessInfo(connection).label"), "Proxy access verified");
context.rawCall = { request: { url: target } };
await run("connectionFetch(connection,target,options,rawCall)");
await run("connectionFetch(connection,target,options,rawCall)");
assert.equal(context.rawCall.request.url, "https://relay.example/?url=" + encodeURIComponent(target), "Retry inspection must not wrap the proxy twice");
run(`connection.key="a-different-key"`);
assert.equal(run("connectionAccessInfo(connection).state"), "unknown");

for(const proxyUrl of ["", "javascript:alert(1)", "https://user:password@relay.example/{url}", "https://relay.example/#{url}"]){
  context.proxyUrl = proxyUrl;
  run("connection.proxy.url=proxyUrl");
  calls = [];
  await assert.rejects(run("connectionFetch(connection,target,options)"), { name: "ConnectionConfigurationError" });
  assert.equal(calls.length, 0, "Invalid proxy settings must never send credentials directly");
  assert.equal(run("connectionAccessInfo(connection).label"), "Check proxy settings");
}

run(`connection.proxy.url="https://relay.example/{url}"`);
responder = async () => { throw new TypeError("Failed to fetch"); };
calls = [];
await assert.rejects(run("connectionFetch(connection,target,options)"));
assert.equal(calls.length, 1, "Proxy failure must not retry another destination");
assert.equal(run("connectionAccessInfo(connection).label"), "Access needs checking");
assert.match(run("connectionAccessInfo(connection).hint"), /Possible causes include CORS, network, certificate or proxy/);

responder = async () => ({ type: "opaque", status: 0 });
await assert.rejects(run("connectionFetch(connection,target,options)"), { name: "TypeError" });
assert.equal(run("connectionAccessInfo(connection).state"), "attention", "An opaque response cannot verify browser access");

responder = async () => new Response("Unauthorized", { status: 401 });
await run("connectionFetch(connection,target,options)");
assert.equal(run("connectionAccessInfo(connection).state"), "verified");
assert.match(run("connectionAccessInfo(connection).hint"), /Authentication failed/);

let release;
responder = () => new Promise(resolve => { release = resolve; });
const oldRequest = run("connectionFetch(connection,target,options)");
run(`connection.base="https://different.example/v1"`);
release(new Response("OK"));
await oldRequest;
assert.equal(run("connectionAccessInfo(connection).state"), "unknown", "A stale response must not verify an edited connection");

let finishStream;
responder = async () => new Response(new ReadableStream({ start(controller){
  controller.enqueue(new TextEncoder().encode("first chunk"));
  finishStream = () => { controller.enqueue(new TextEncoder().encode("last chunk")); controller.close(); };
} }), { headers: { "Content-Type": "text/event-stream" } });
const response = await run("connectionFetch(connection,target,options)");
const reader = response.body.getReader();
assert.equal(new TextDecoder().decode((await reader.read()).value), "first chunk");
finishStream();
assert.equal(new TextDecoder().decode((await reader.read()).value), "last chunk");
assert.equal((await reader.read()).done, true);

responder = async () => new Response('{"data":[{"id":"fixture-model"}]}');
calls = [];
assert.equal((await run(`fetchModelsForType("openai",connection.base,connection.key,{},connection)`))[0], "fixture-model");
assert.ok(calls.every(call => call.url.startsWith("https://relay.example/")));

assert.equal(run(`connectionAccessInfo({type:"openai",base:"https://api.openai.com/v1"}).state`), "expected");
assert.equal(run(`connectionAccessInfo({type:"openai",base:"https://custom.example/v1"}).state`), "unknown");
assert.match(run(`connectionAccessInfo({type:"ollama",base:"http://localhost:11434"}).hint`), /OLLAMA_ORIGINS/);
assert.equal(run(`connectionAccessInfo({type:"openai",base:"https://api.x.ai/v1"}).state`), "unknown");

run(`var shareConnection={proxy:{enabled:true,url:"https://relay.example/?key=private-proxy-key&url={encodedUrl}"}}`);
assert.equal(run("exportConnectionProxy(shareConnection).proxy.url.includes('private-proxy-key')"), false);
assert.equal(run("exportConnectionProxy(shareConnection,true).proxy.url.includes('private-proxy-key')"), true);
assert.equal(run("shareConnection.proxy.url.includes('private-proxy-key')"), true);
assert.notEqual(run(`computeAgentSignature({config:{providers:[connection]}})`), run(`computeAgentSignature({config:{providers:[{...connection,proxy:{enabled:false,url:""}}]}})`));
console.log("✓ Direct/proxy transport, credential forwarding, streaming, stale-result invalidation, honest diagnostics and safe sharing");
