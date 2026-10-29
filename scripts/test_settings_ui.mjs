import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "tabs-settings-test-"));
const hosted = path.join(scratch, "hosted");
const portable = path.join(scratch, "standalone");
const chromePath = process.env.CHROME_PATH || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "google-chrome");
const screenshots = process.env.UI_ARTIFACT_DIR;
let chrome, ws, server;
let chromeDiagnostics = "";
let lastChatRequest = null;
const chatRequests = [];
const proxyRequests = [];
let commandId = 0;
const pending = new Map();
const exceptions = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const mime = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

function command(method, params = {}){
  return new Promise((resolve,reject) => {
    const id = ++commandId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression){
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function ready(){
  for(let i=0;i<80;i++){
    if(await evaluate("!window.__leavingTestPage && document.readyState === 'complete' && typeof state !== 'undefined' && !!document.getElementById('settingsBtn')?.onclick")) return;
    await pause(100);
  }
  throw new Error(`App did not initialize: ${exceptions.join("\n")}`);
}

async function screenshot(name){
  if(!screenshots) return;
  await fs.mkdir(screenshots, { recursive:true });
  await pause(250);
  const result = await command("Page.captureScreenshot", { format:"png", captureBeyondViewport:true });
  await fs.writeFile(path.join(screenshots, `${name}.png`), Buffer.from(result.data,"base64"));
}

try {
  for(const [target,out] of [["hosted",hosted],["standalone",portable]]){
    execFileSync(process.execPath,["build.js",`--target=${target}`,`--out=${out}`],{cwd:root,stdio:"pipe"});
  }
  server = http.createServer(async (req,res) => {
    const url = new URL(req.url,"http://localhost");
    if(url.pathname === "/cors-relay"){
      const target = new URL(url.searchParams.get("url"));
      if(target.hostname !== "localhost" || target.port !== String(server.address().port) || !target.pathname.startsWith("/cors-fixture/")){
        res.writeHead(403);res.end("Fixture target only");return;
      }
      let body="";for await(const chunk of req)body+=chunk;
      proxyRequests.push({target:target.href,method:req.method,body,authorization:req.headers.authorization,owner:req.headers["x-owner-id"]});
      const upstream=await fetch(target,{method:req.method,headers:{...(req.headers.authorization?{authorization:req.headers.authorization}:{}),...(req.headers["x-owner-id"]?{"x-owner-id":req.headers["x-owner-id"]}:{}),...(req.headers["content-type"]?{"content-type":req.headers["content-type"]}:{})},...(!["GET","HEAD"].includes(req.method)?{body}:{})});
      res.writeHead(upstream.status,{"Content-Type":upstream.headers.get("content-type")||"text/plain"});
      for await(const chunk of upstream.body)res.write(chunk);
      res.end();return;
    }
    if(url.pathname.startsWith("/cors-fixture/")){
      // Deliberately omit all CORS headers. Only the relay can make this readable.
      if(url.pathname.endsWith("/models")){
        if(req.headers.authorization === "Bearer rejected-fixture-key"){
          res.writeHead(401,{"Content-Type":"application/json"});res.end('{"error":"Invalid fixture key"}');return;
        }
        res.setHeader("Content-Type","application/json");res.end(JSON.stringify({data:[{id:"test-model"}]}));return;
      }
      if(url.pathname.endsWith("/chat/completions")){
        let body="";for await(const chunk of req)body+=chunk;lastChatRequest=JSON.parse(body);
        res.setHeader("Content-Type","text/event-stream");
        res.end('data: '+JSON.stringify({choices:[{delta:{content:"Proxied stream response"},finish_reason:null}]})+'\n\ndata: [DONE]\n\n');return;
      }
      if(url.pathname.endsWith("/mcp") && req.method === "POST"){
        let body="";for await(const chunk of req)body+=chunk;
        const rpc=JSON.parse(body);
        const result=rpc.method === "initialize"?{protocolVersion:"2024-11-05",capabilities:{tools:{}}}:rpc.method === "tools/list"?{tools:[{name:"proxied_lookup",description:"Fixture through relay",inputSchema:{type:"object",properties:{}}}]}:{content:[{type:"text",text:"Proxied tool result"}]};
        res.setHeader("Content-Type","application/json");res.end(JSON.stringify({jsonrpc:"2.0",id:rpc.id,result}));return;
      }
    }
    if(url.pathname === "/v1/models"){
      res.setHeader("Content-Type","application/json");
      res.end(JSON.stringify({data:[{id:"test-model"},{id:"another-model"}]})); return;
    }
    if(url.pathname === "/v1/chat/completions" && req.method === "POST"){
      let body="";for await(const chunk of req)body+=chunk;lastChatRequest=JSON.parse(body);
      chatRequests.push(lastChatRequest);
      if(lastChatRequest.model === "no-tools-model" && lastChatRequest.tools?.length){
        res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:'"no-tools-model" does not support tools'}));return;
      }
      res.setHeader("Content-Type","text/event-stream");
      const reasoning = lastChatRequest.messages.at(-1)?.content === "Reasoning visibility check"
        ? 'data: '+JSON.stringify({choices:[{delta:{reasoning_content:"Fixture reasoning"},finish_reason:null}]})+'\n\n' : "";
      res.end(reasoning+'data: '+JSON.stringify({choices:[{delta:{content:"Fixture response"},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:"stop"}],usage:{completion_tokens:2}})+'\n\ndata: [DONE]\n\n');return;
    }
    if(url.pathname === "/mcp" && req.method === "POST"){
      let body="";for await(const chunk of req) body+=chunk;
      const rpc=JSON.parse(body);
      const result=rpc.method === "initialize" ? {protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"Fixture",version:"1"}}
        : rpc.method === "tools/list" ? {tools:[{name:"fixture_lookup",description:"Read a fixture",inputSchema:{type:"object",properties:{}}}]}
        : {content:[{type:"text",text:"Fixture result"}]};
      res.setHeader("Content-Type","application/json");res.end(JSON.stringify({jsonrpc:"2.0",id:rpc.id,result}));return;
    }
    try {
      const standalone=url.pathname === "/portable/index.html";
      const file=standalone?path.join(portable,"index.html"):path.join(hosted,url.pathname === "/"?"index.html":url.pathname);
      if(!file.startsWith(scratch+path.sep)) throw new Error("Invalid path");
      const data=await fs.readFile(file);res.setHeader("Content-Type",mime[path.extname(file)]||"application/octet-stream");res.end(data);
    } catch {res.writeHead(404);res.end("Not found");}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const sandboxFlags=process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox","--disable-dev-shm-usage"] : [];
  chrome=spawn(chromePath,[...sandboxFlags,"--headless=new","--remote-debugging-port=0",`--user-data-dir=${path.join(scratch,"profile")}`,"--no-first-run","--no-default-browser-check","--disable-background-networking",origin],{stdio:["ignore","ignore","pipe"]});
  chrome.stderr.on("data",chunk=>{chromeDiagnostics=(chromeDiagnostics+chunk).slice(-4000);});
  chrome.on("error",error=>console.error(error));
  let port;
  for(let i=0;i<100;i++){
    try{port=(await fs.readFile(path.join(scratch,"profile/DevToolsActivePort"),"utf8")).split("\n")[0];break;}catch{await pause(100);}
  }
  assert.ok(port,"Chrome did not expose its debugging port; set CHROME_PATH if needed\n"+chromeDiagnostics);
  let page;
  for(let i=0;i<50;i++){
    const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page=pages.find(p=>p.type === "page" && p.url.startsWith(origin));
    if(page)break;await pause(100);
  }
  assert.ok(page,"No app browser page");
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id){const item=pending.get(message.id);if(!item)return;clearTimeout(item.timer);pending.delete(message.id);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}
    if(message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
    if(message.method === "Page.javascriptDialogOpening") command("Page.handleJavaScriptDialog",{accept:true}).catch(()=>{});
  };
  await command("Runtime.enable");await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await ready();
  const connectionGroups = await evaluate(`Array.from(document.querySelectorAll('.onboarding-provider-section'),section=>Array.from(section.querySelectorAll('[data-onboarding-provider]'),button=>button.dataset.onboardingProvider))`);
  assert.deepEqual(connectionGroups,[['openai','claude','gemini','deepseek','openrouter','groq','mistral','xai',''],['ollama','llamacpp','lmstudio']]);
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#pm_type option'),option=>option.value).filter(Boolean).sort()"),connectionGroups.flat().filter(Boolean).sort());
  assert.equal(await evaluate("!!document.getElementById('obOllamaBtn') || !!document.querySelector('.onboarding-supported-list')"),false);
  await screenshot("welcome-connections");
  for(const [type,base] of [['ollama','http://localhost:11434'],['llamacpp','http://localhost:8080/v1'],['lmstudio','http://localhost:1234/v1']]){
    await evaluate(`getCurrentAgent().config.providers=[];getCurrentAgent().chats=[];state.activeChatId=null;renderMessages();document.querySelector('[data-onboarding-provider="${type}"]').click();`);
    assert.deepEqual(await evaluate(`({type:document.getElementById('pm_type').value,base:document.getElementById('pm_base').value,keyVisible:document.getElementById('pm_key').checkVisibility(),addressVisible:document.getElementById('pm_base').checkVisibility(),focus:document.activeElement.id,configured:hasConfiguredLLM()})`),{type,base,keyVisible:false,addressVisible:true,focus:'pm_base',configured:true});
    await evaluate("document.getElementById('pm_base').value=location.origin+'/v1';settingsDraftChanged();document.getElementById('pm_fetch_btn').onclick(new Event('click'));");
    assert.ok((await evaluate("Array.from(document.querySelectorAll('#pm_models_tbody .ump-row'),row=>row.dataset.model)")).includes('test-model'));
    await evaluate(`document.querySelectorAll('#pm_models_tbody .ump-row').forEach(row=>row.querySelector('input[type=checkbox]').checked=row.dataset.model==='test-model');document.getElementById('pm_models_tbody').dispatchEvent(new Event('change',{bubbles:true}));closeProviderModal();closeSettings();state.toolSettings.enabled=false;document.getElementById('input').value='Local connection check';sendMessage();`);
    assert.equal(lastChatRequest.model,'test-model');
    assert.equal(Object.hasOwn(lastChatRequest,'think'),false,'Auto must not force thinking for local models');
    assert.equal(Object.hasOwn(lastChatRequest,'temperature'),false,'Temperature Auto must omit the parameter');
    assert.equal(await evaluate("currentChat().messages.at(-1).content"),'Fixture response');
    assert.equal(await evaluate("getProviders()[0].key"),'');
    assert.equal(await evaluate("getProviders()[0].type"),type);
    await evaluate(`openSettings('providers');document.querySelector('.pb-edit-btn').click();`);
    assert.equal(await evaluate("document.getElementById('pm_type').value"),type);
    assert.equal(await evaluate("document.getElementById('pm_key').checkVisibility()"),false);
    await evaluate("closeProviderModal();closeSettings();");
  }
  for(const type of ['groq','openrouter','deepseek','mistral','xai']){
    assert.deepEqual(await evaluate(`fetchModelsForType('${type}',location.origin+'/v1','fixture-key')`),['test-model','another-model']);
  }
  await evaluate("document.getElementById('input').value='Reasoning visibility check';sendMessage();");
  assert.equal(await evaluate("currentChat().messages.at(-1).reasoning"),'Fixture reasoning');
  assert.equal(await evaluate("document.querySelector('.msg-wrap:last-child .thinking-content').textContent"),'Fixture reasoning');
  lastChatRequest = null;
  await evaluate("document.getElementById('thinkingToggle').click();");
  assert.equal(await evaluate("document.getElementById('thinkingToggle').getAttribute('aria-pressed')"),'false');
  assert.equal(await evaluate("document.querySelector('.msg-wrap:last-child .thinking-content').textContent"),'');
  assert.equal(await evaluate("currentChat().messages.at(-1).reasoning"),'Fixture reasoning');
  assert.equal(await evaluate("state.general.thinkMode"),'auto');
  await evaluate("document.getElementById('thinkingToggle').click();");
  assert.equal(await evaluate("document.getElementById('thinkingToggle').getAttribute('aria-pressed')"),'true');
  assert.equal(await evaluate("document.querySelector('.msg-wrap:last-child .thinking-content').textContent"),'Fixture reasoning');
  assert.equal(lastChatRequest,null,'Showing and hiding reasoning must not make another API request');
  console.log("✓ Reasoning display hides and restores streamed content without changing generation mode or making API requests");
  const beforeToolFallback = chatRequests.length;
  await evaluate(`getProviders()[0].models='no-tools-model';populateModelSelect();state.toolSettings.enabled=true;document.getElementById('input').value='Check unsupported tools';sendMessage();`);
  assert.equal(chatRequests.length-beforeToolFallback,2);
  assert.ok(chatRequests.at(-2).tools.length);
  assert.equal(Object.hasOwn(chatRequests.at(-1),'tools'),false);
  assert.equal(await evaluate("currentChat().messages.at(-1).error"),false);
  assert.equal(await evaluate("currentChat().messages.at(-1).rawCall.meta.toolsUnsupported"),true);
  assert.equal(await evaluate("state.toolSettings.enabled"),true);
  assert.match(await evaluate("document.querySelector('.msg-wrap:last-child .message-notice').textContent"),/does not support tools/);
  assert.equal(await evaluate("Object.hasOwn(currentChat().messages.at(-1).rawCall.request.body,'tools')"),false);
  await evaluate("state.toolSettings.enabled=false;");
  console.log("✓ Unsupported tools recover once with a visible notice and the actual final request in the inspector");
  lastChatRequest = null;
  console.log("✓ Complete cloud/local connection catalog, local setup without API keys, model discovery and chat requests");
  const blockedBase = origin.replace("127.0.0.1","localhost")+"/cors-fixture/v1";
  const proxyTemplate = origin+"/cors-relay?url={encodedUrl}";
  await evaluate(`(()=>{
    const tab=getCurrentAgent();tab.config.providers=[{id:'cors-provider',type:'openai',name:'CORS fixture',base:${JSON.stringify(blockedBase)},key:'fixture-private-key',models:'test-model'}];tab.config.mcpServers=[];
    openSettings('providers');_expandedProviderIds.add('cors-provider');renderConfiguredProviders();
  })()`);
  assert.equal(await evaluate("document.querySelector('.connection-access-badge').textContent"),"Server CORS configurable");
  await evaluate(`(async()=>{const p=getProvider('cors-provider');try{await fetchModelsForType(p.type,p.base,p.key,p.headers,p)}catch{}})()`);
  assert.equal(await evaluate("document.querySelector('.connection-access-badge').textContent"),"Access needs checking");
  assert.match(await evaluate("document.querySelector('.connection-access-hint').textContent"),/Possible causes include CORS, network, certificate/);
  await evaluate(`(()=>{
    const block=document.querySelector('[data-provider-id="cors-provider"]');block.querySelector('.connection-advanced').open=true;
    const toggle=block.querySelector('.connection-proxy-enabled');toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));
    const input=block.querySelector('.connection-proxy-url');input.value=${JSON.stringify(proxyTemplate)};input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  assert.equal(await evaluate("document.querySelector('.connection-proxy-url').checkVisibility()"),true);
  assert.match(await evaluate("document.querySelector('.connection-proxy-recipient').textContent"),/including access credentials/);
  await evaluate("document.querySelector('.pb-fetch-btn').onclick(new Event('click'))");
  assert.equal(await evaluate("document.querySelector('.connection-access-badge').textContent"),"Proxy access verified");
  assert.equal(await evaluate("getProvider('cors-provider').models"),"test-model","Checking access must preserve the selected models");
  await evaluate("flushSettingsAutosave();openEditProviderModal('cors-provider');document.getElementById('providerConnectionAdvanced').open=true;");
  assert.equal(await evaluate("document.querySelector('#pm_connection_proxy .connection-proxy-enabled').checked"),true);
  assert.equal(await evaluate("document.getElementById('pm_connection_access').textContent.includes('Proxy access verified')"),true);
  await screenshot("connection-browser-access");
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate("document.querySelector('#providerModal .modal').scrollWidth>document.querySelector('#providerModal .modal').clientWidth"),false,"Proxy controls must fit the mobile connection dialog");
  await screenshot("connection-browser-access-mobile");
  await command("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate("closeProviderModal();closeSettings();state.toolSettings.enabled=false;document.getElementById('input').value='Check proxy streaming';sendMessage();");
  assert.equal(await evaluate("currentChat().messages.at(-1).content"),"Proxied stream response");
  assert.ok(proxyRequests.some(request=>request.target.endsWith('/chat/completions')&&request.authorization==='Bearer fixture-private-key'&&JSON.parse(request.body).model==='test-model'));
  await evaluate(`(async()=>{
    const p=getProvider('cors-provider');p.key='rejected-fixture-key';openSettings('providers');
    try{await fetchModelsForType(p.type,p.base,p.key,p.headers,p)}catch{}
  })()`);
  assert.equal(await evaluate("document.querySelector('[data-provider-id=\"cors-provider\"] .connection-access-badge').textContent"),"Proxy access verified");
  assert.match(await evaluate("document.querySelector('[data-provider-id=\"cors-provider\"] .connection-access-hint').textContent"),/Authentication failed/);
  assert.equal(await evaluate("document.querySelector('[data-provider-id=\"cors-provider\"] .connection-access-hint').checkVisibility()"),true,"Authentication errors remain visible on collapsed connections");
  await evaluate(`(async()=>{const p=getProvider('cors-provider');p.key='fixture-private-key';renderConfiguredProviders();await fetchModelsForType(p.type,p.base,p.key,p.headers,p)})()`);
  await evaluate(`(()=>{
    getCurrentAgent().config.mcpServers=[{id:'cors-mcp',name:'MCP through relay',url:${JSON.stringify(blockedBase.replace(/\/v1$/,"/mcp"))},apiKey:'fixture-mcp-key',headers:{'x-owner-id':'fixture-owner'},enabled:true,proxy:{enabled:true,url:${JSON.stringify(proxyTemplate)}}}];
    openSettings('mcp');
  })()`);
  await evaluate("document.getElementById('testMcpToolsBtn').onclick()");
  assert.equal(await evaluate("document.querySelector('[data-connection-id=\"cors-mcp\"] .connection-access-badge').textContent"),"Proxy access verified");
  assert.equal(await evaluate("toolRegistry.toolsMap.has('proxied_lookup')"),true);
  await evaluate("document.querySelector('[data-mcp-id=\"cors-mcp\"]').classList.remove('collapsed');document.querySelector('[data-mcp-id=\"cors-mcp\"] .connection-advanced').open=true;");
  await screenshot("connection-mcp-proxy");
  assert.ok(proxyRequests.some(request=>request.target.endsWith('/mcp')&&request.authorization==='Bearer fixture-mcp-key'&&request.owner==='fixture-owner'&&JSON.parse(request.body).method==='tools/list'));
  const proxyRoundTrip = await evaluate(`(()=>{
    const source=getCurrentAgent();const p=source.config.providers[0],s=source.config.mcpServers[0];
    const imported=importSingleAgentSpec({name:'Proxy portability',config:{providers:[structuredClone(p)],mcpServers:[structuredClone(s)]}}).agent;
    showImportPreview({providers:[p],mcpServers:[s]});const disclosed=document.querySelectorAll('.import-proxy-note').length===2;closeImportModal();
    return {provider:imported.config.providers[0].proxy,mcp:imported.config.mcpServers[0].proxy,verification:connectionAccessInfo(imported.config.providers[0]).state,disclosed};
  })()`);
  assert.deepEqual(proxyRoundTrip,{provider:{enabled:true,url:proxyTemplate},mcp:{enabled:true,url:proxyTemplate},verification:'unknown',disclosed:true});
  const duplicateAccess = await evaluate(`(()=>{
    const source=getCurrentAgent();
    const duplicate=createDefaultAgent('Duplicate connections',structuredClone(source.config));state.agents.push(duplicate);state.activeAgentId=duplicate.id;
    openSettings('providers');
    const label=document.querySelector('[data-provider-id="cors-provider"] .connection-access-badge').textContent;
    state.activeAgentId=source.id;openSettings('providers');
    return {duplicate:label,original:document.querySelector('[data-provider-id="cors-provider"] .connection-access-badge').textContent};
  })()`);
  assert.deepEqual(duplicateAccess,{duplicate:'Proxy access not verified',original:'Proxy access verified'},'Duplicated provider IDs must not share verification between agents');
  await evaluate("closeSettings();");
  console.log("✓ Real browser CORS failure, explicit proxy routing, streamed chat, MCP credentials, status invalidation and configuration portability");
  await evaluate(`(()=>{
    state=structuredClone(DEFAULT_STATE);
    const a=createDefaultAgent('Personal'),b=createDefaultAgent('Work');a.id='personal';b.id='work';
    a.config.providers=[{id:'test-provider',type:'openai',name:'Test AI',base:location.origin+'/v1',key:'test-key',models:'test-model | Friendly name\\nanother-model',headers:{Authorization:'Bearer test-header'}},{id:'second-provider',type:'openai',name:'Second connection',base:location.origin+'/v1',key:'another-key',models:'test-model | Second model'}];
    a.config.mcpServers=[{id:'fixture-mcp',name:'Fixture tools',url:location.origin+'/mcp',apiKey:'fixture-key',enabled:true,headers:{'X-Token':'fixture-token'}}];
    a.welcomePrompts=[{label:'A | B',desc:'Unicode à',text:'Line one\\nLine two | intact'}];
    a.chats=[{id:'chat-personal',title:'Personal chat',model:'test-provider::test-model',systemPrompt:'Personal instructions',messages:[],createdAt:Date.now()}];
    b.systemPrompt='Work instructions';b.chats=[];b.config.agent=normalizeAgentSettings({enabled:true,maxTurns:4,builtInTools:{calculator:false,notepad:true}});
    state.agents=[a,b];state.activeAgentId=a.id;state.activeChatId='chat-personal';defineStateAccessors(state);saveState();
    _settingsCurrentAgentId=null;
    renderAgentBar();populateModelSelect();renderChatList();renderMessages();openSettings();
  })()`);
  assert.deepEqual(await evaluate(`({panel:_settingsCurrentSubtab,rows:document.querySelectorAll('.settings-overview-row').length,agents:document.querySelectorAll('#settingsNavAgentList button').length,shareGlobal:!!document.querySelector('[data-app-tab="share"]'),technicalVisible:document.getElementById('agent_cfg_temp').checkVisibility()})`),{panel:"overview",rows:4,agents:2,shareGlobal:false,technicalVisible:false});
  console.log("✓ Overview, sidebar scope and collapsed advanced controls");
  assert.equal(await evaluate("DEFAULT_STATE.theme"),"system");
  assert.equal(await evaluate("!!document.getElementById('themeBtn') || !!document.getElementById('settingsThemeBtn')"),false);
  await command("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"dark"}]});
  await evaluate("applyTheme();");
  assert.equal(await evaluate("document.documentElement.dataset.theme"),"dark");
  await command("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"light"}]});
  for(let attempt=0;attempt<40;attempt++){
    if(await evaluate("document.documentElement.dataset.theme") === "light") break;
    await pause(50);
  }
  assert.equal(await evaluate("document.documentElement.dataset.theme"),"light");
  assert.equal(await evaluate("document.querySelector('#sidebarChatContent .logo').tagName"),"BUTTON");
  assert.equal(await evaluate("!!(document.getElementById('notepadBtn').compareDocumentPosition(document.querySelector('.sidebar-agent-wrap')) & Node.DOCUMENT_POSITION_FOLLOWING)"),true);
  console.log("✓ System appearance follows OS changes; notes navigation precedes agents");


  assert.equal(await evaluate("!!document.querySelector('#settingsAgentShareBtn svg path')"),true);
  assert.equal(await evaluate("!!document.getElementById('saveSettings') || !!document.getElementById('cancelSettings')"),false);
  await evaluate(`document.querySelector('.settings-actions-menu').open=true;document.getElementById('settingsMainTitle').click();`);
  assert.equal(await evaluate("document.querySelector('.settings-actions-menu').open"),false);
  await evaluate(`activateSubtab('instructions');window.settingsWrites=0;window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===LS_KEY)settingsWrites++;return originalSetItem.call(this,key,value);};
    const input=document.getElementById('agent_cfg_system');input.focus();
    for(const text of ['P','Personal','Personal draft']){input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  assert.equal(await evaluate("window.settingsWrites"),0);
  await pause(250);
  await evaluate(`document.getElementById('agent_cfg_system').dispatchEvent(new Event('input',{bubbles:true}));`);
  await pause(250);
  assert.equal(await evaluate("window.settingsWrites"),0);
  await pause(500);
  assert.equal(await evaluate("window.settingsWrites"),1);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents[0].systemPrompt"),"Personal draft");
  await evaluate(`selectAgentInSettings('work');activateSubtab('instructions');document.getElementById('agent_cfg_system').value='Work updated';settingsDraftChanged();selectAgentInSettings('personal');`);
  assert.equal(await evaluate("document.getElementById('agent_cfg_system').value"),"Personal draft");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents[1].systemPrompt"),"Work updated");
  await evaluate(`document.getElementById('agent_cfg_author').value='Claudio';document.getElementById('agent_cfg_description').value='Configuration description';settingsDraftChanged();window.beforeLogoUrl=location.href;document.querySelector('#sidebarSettingsContent .logo').click();`);
  assert.equal(await evaluate("isSettingsOpen()"),false);
  assert.equal(await evaluate("location.href"),await evaluate("beforeLogoUrl"));
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents[0].description"),"Configuration description");
  await evaluate("Storage.prototype.setItem=window.originalSetItem;openSettings();");
  await evaluate(`document.getElementById('settingsAgentRenameBtn').click();document.getElementById('agentModalAuthorInput').value='Changed author';document.getElementById('agentModalAuthorInput').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('closeAgentModalBtn').click();`);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents[0].author"),"Changed author");
  assert.equal(await evaluate("document.getElementById('agent_cfg_author').value"),"Changed author");
  await evaluate(`document.getElementById('agent_cfg_author').value='Claudio';settingsDraftChanged();flushSettingsAutosave();`);

  console.log("✓ Debounced autosave, independent agents, metadata and logo navigation");

  await evaluate("activateSubtab('welcome');");
  assert.deepEqual(await evaluate("readWelcomePromptEditor()[0]"),{label:"A | B",desc:"Unicode à",text:"Line one\nLine two | intact"});
  await evaluate(`const message=document.querySelector('.wp-text');message.value='New line\\nWith | pipes';message.dispatchEvent(new Event('input',{bubbles:true}));settingsDraftChanged();flushSettingsAutosave();`);
  await evaluate(`activateSubtab('overview');document.getElementById('agent_cfg_temp').value='0';settingsDraftChanged();flushSettingsAutosave();`);
  assert.equal(await evaluate("llmTemp()"),0);
  await evaluate(`activateSubtab('mcp');document.getElementById('tool_notepad_check').click();document.getElementById('cfg_agent_max_turns').value='17';settingsDraftChanged();flushSettingsAutosave();selectAgentInSettings('work','mcp');`);
  assert.equal(await evaluate("document.getElementById('tool_notepad_check').checked"),true);
  assert.equal(await evaluate("document.getElementById('cfg_agent_max_turns').value"),"4");
  await evaluate("selectAgentInSettings('personal','mcp');");
  assert.equal(await evaluate("document.getElementById('tool_notepad_check').checked"),false);
  await evaluate(`document.getElementById('cfg_agent_max_turns').value='18';document.getElementById('cfg_agent_max_turns').dispatchEvent(new Event('input',{bubbles:true}));window.__leavingTestPage=true;`);await command("Page.reload");await ready();await evaluate("openSettings('mcp');");
  assert.equal(await evaluate("state.toolSettings.maxTurns"),18);
  assert.equal(await evaluate("state.toolSettings.builtInTools.notepad"),false);
  assert.equal(await evaluate("getCurrentAgent().welcomePrompts[0].text"),"New line\nWith | pipes");
  console.log("✓ Structured suggestions, zero temperature and per-agent tools survive reload");
  assert.equal(await evaluate("llmTemp()"),0);
  await evaluate("activateSubtab('overview');document.getElementById('agent_cfg_temp').value='';settingsDraftChanged();flushSettingsAutosave();");
  assert.equal(await evaluate("getCurrentAgent().temperature"),null);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents.find(agent=>agent.id==='personal').temperature"),null);
  await evaluate("window.__leavingTestPage=true;");await command("Page.reload");await ready();await evaluate("openSettings('overview');");
  assert.equal(await evaluate("llmTemp()"),null);
  assert.equal(await evaluate("document.getElementById('agent_cfg_temp').value"),'');
  assert.match(await evaluate("document.getElementById('agent_cfg_temp').placeholder"),/Auto/);
  console.log("✓ Temperature Auto stays empty through autosave and reload");

  await evaluate(`selectAppSectionInSettings('general');document.getElementById('cfg_top_p').value='0.8';document.getElementById('cfg_num_ctx').value='8192';document.getElementById('cfg_theme').value='dark';document.getElementById('cfg_user_name').value='Global user';settingsDraftChanged();selectAgentInSettings('personal','providers');`);
  assert.equal(await evaluate("state.general.topP"),"0.8");assert.equal(await evaluate("state.general.numCtx"),"8192");assert.equal(await evaluate("state.theme"),"dark");assert.equal(await evaluate("state.general.userName"),"Global user");
  assert.equal(await evaluate("document.querySelectorAll('#configuredProvidersList .provider-block:not(.collapsed)').length"),0);
  assert.equal(await evaluate("document.getElementById('addProviderBtn').checkVisibility()"),true);
  assert.equal(await evaluate("!!document.getElementById('newProviderTypeSelect')"),false);
  await evaluate("document.getElementById('addProviderBtn').click();");
  assert.equal(await evaluate("document.getElementById('pm_type').checkVisibility()"),true);
  assert.equal(await evaluate("document.getElementById('providerModalFields').checkVisibility()"),false);
  await screenshot("settings-connect");
  await evaluate("closeProviderModal();");
  assert.equal(await evaluate("getCurrentAgent().config.providers.length"),2);
  await evaluate(`document.getElementById('addProviderBtn').click();document.getElementById('pm_type').value='openai';document.getElementById('pm_type').dispatchEvent(new Event('change',{bubbles:true}));`);
  assert.equal(await evaluate("document.getElementById('providerConnectionAdvanced').open"),false);
  await evaluate(`document.getElementById('pm_name').value='Third AI';document.getElementById('pm_base').value=location.origin+'/v1';document.getElementById('pm_key').value='third-key';document.getElementById('pm_headers').value='X-Project: fixture';settingsDraftChanged();closeProviderModal();`);
  assert.equal(await evaluate("getCurrentAgent().config.providers.length"),3);
  assert.equal(await evaluate("document.querySelectorAll('#configuredProvidersList .provider-block:not(.collapsed)').length"),0);
  assert.ok((await evaluate("getCurrentAgent().config.providers[0].models")).includes("Friendly name"));
  await evaluate(`openEditProviderModal('test-provider');document.getElementById('pm_key').value='edited-key';document.getElementById('pm_key').dispatchEvent(new Event('input',{bubbles:true}));`);
  await pause(700);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents[0].config.providers[0].key"),"edited-key");
  await evaluate(`document.getElementById('pm_name').value='Test AI edited';document.getElementById('pm_name').dispatchEvent(new Event('input',{bubbles:true}));closeProviderModal();activateSubtab('instructions');document.getElementById('agent_cfg_system').dispatchEvent(new Event('input',{bubbles:true}));activateSubtab('providers');`);
  assert.equal(await evaluate("getCurrentAgent().config.providers[0].key"),"edited-key");

  await evaluate(`document.querySelector('#configuredProvidersList .provider-header-left').click();const key=document.querySelector('#configuredProvidersList .pb-key-input');window.idleBorder=getComputedStyle(key).borderColor;key.focus();`);
  assert.equal(await evaluate("getComputedStyle(document.activeElement).borderColor"),await evaluate("idleBorder"));
  assert.equal(await evaluate("getComputedStyle(document.activeElement).boxShadow"),"none");
  await evaluate(`document.querySelector('#configuredProvidersList .provider-block .ump-row:last-child .ump-remove-btn').click();activateSubtab('mcp');`);
  assert.ok(!(await evaluate("getCurrentAgent().config.providers[0].models")).includes('another-model'));
  assert.equal(await evaluate("document.querySelectorAll('#mcpServersList .provider-block:not(.collapsed)').length"),0);
  await evaluate(`document.getElementById('addMcpServerBtn').click();const input=document.querySelector('#mcpServersList .provider-block:last-child .mcp-name-input');input.value='Temporary tool';input.dispatchEvent(new Event('input',{bubbles:true}));activateSubtab('overview');`);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents[0].config.mcpServers.at(-1).name"),"Temporary tool");
  await evaluate(`activateSubtab('mcp');document.querySelector('#mcpServersList .provider-block:last-child .mcp-delete-btn').click();activateSubtab('overview');`);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents[0].config.mcpServers.length"),1);

  const fetched=await evaluate("fetchModelsForType('openai',location.origin+'/v1','fixture',{})");assert.ok(fetched.includes("test-model"));
  await evaluate("activateSubtab('mcp');");
  assert.deepEqual(await evaluate("toolRegistry.refreshTools().then(result=>({errors:result.errors,count:toolRegistry.getAllTools().filter(t=>t.name==='fixture_lookup').length}))"),{errors:[],count:1});
  console.log("✓ General controls, multiple connections, model aliases and MCP discovery");

  await evaluate("activateSubtab('overview');document.getElementById('settingsAgentShareBtn').click();");
  assert.equal(await evaluate("_settingsCurrentMode"),"agent");assert.equal(await evaluate("_settingsCurrentSubtab"),"share");
  assert.equal(await evaluate("!!document.getElementById('shareScopeAll')"),false);
  await evaluate("handleGenerateShareLink()");
  const shared=await evaluate("JSON.parse(base64UrlDecode(new URL(document.getElementById('shareResultInput').value).hash.slice(8)))");
  assert.equal(shared.agents.length,1);assert.equal(shared.agents[0].name,"Personal");
  assert.equal(shared.agents[0].author,"Claudio");assert.equal(shared.agents[0].description,"Configuration description");
  assert.equal(shared.agents[0].config.providers[0].key,"");assert.equal(shared.agents[0].config.providers[0].headers,undefined);
  assert.equal(shared.agents[0].config.mcpServers[0].headers,undefined);
  assert.equal(shared.agents[0].config.agent.builtInTools.notepad,false);
  await evaluate(`document.getElementById('shareIncludeKeys').checked=true;document.getElementById('shareProtectPassword').checked=true;document.getElementById('sharePasswordInput').value='fixture-password';`);
  await evaluate("handleGenerateShareLink()");
  const encrypted=await evaluate("decryptConfig(new URL(document.getElementById('shareResultInput').value).hash.slice(5),'fixture-password').then(JSON.parse)");
  assert.equal(encrypted.agents[0].config.providers[0].headers.Authorization,"Bearer test-header");
  await evaluate(`const copy=JSON.parse(base64UrlDecode('${Buffer.from(JSON.stringify(shared)).toString("base64url")}'));copy.agents[0].name='Imported agent';copy.activeAgent='Imported agent';importConfigBundle(copy);`);
  assert.equal(await evaluate("getCurrentAgent().description"),"Configuration description");
  assert.equal(await evaluate("getCurrentAgent().name"),"Imported agent");assert.equal(await evaluate("state.toolSettings.builtInTools.notepad"),false);
  console.log("✓ Single-agent sharing, credential exclusion, encryption and config import");

  await evaluate("openSettings();document.getElementById('settingsNavNewAgentBtn').click();document.getElementById('agentModalNameInput').value='New agent';saveAgentModal();");
  assert.equal(await evaluate("_settingsCurrentSubtab"),"overview");assert.equal(await evaluate("getCurrentAgent().name"),"New agent");
  assert.equal(await evaluate("state.toolSettings.builtInTools.notepad"),true);
  await evaluate("selectAgentInSettings('personal');document.getElementById('settingsAgentDuplicateBtn').click();");
  assert.equal(await evaluate("getCurrentAgent().name"),"Personal (copy)");assert.equal(await evaluate("(state.notes || []).filter(note => note.agentId === getCurrentAgent().id).length"),0);
  assert.equal(await evaluate("getCurrentAgent().config.providers.length"),3);
  await evaluate("selectAgentInSettings('work');document.getElementById('settingsAgentDuplicateBtn').click();document.getElementById('settingsAgentDeleteBtn').click();");
  assert.equal(await evaluate("getCurrentAgent().name"),"Personal");
  assert.equal(await evaluate("getCurrentAgent().systemPrompt"),"Personal draft");
  await evaluate(`const tab=createDefaultAgent('Backup import');tab.id='backup-import';tab.config.agent=normalizeAgentSettings({maxTurns:7,builtInTools:{calculator:false}});importData(new File([JSON.stringify({schemaVersion:1,agents:[tab],notes:[{id:'backup-note',agentId:tab.id,title:'Imported note',body:'Preserved',time:1}]})],'backup.json',{type:'application/json'}));`);
  for(let i=0;i<30;i++){if(await evaluate("getCurrentAgent().id==='backup-import'"))break;await pause(20);}
  assert.equal(await evaluate("state.notes.find(note => note.id === 'backup-note').body"),"Preserved");
  assert.equal(await evaluate("state.toolSettings.maxTurns"),7);
  assert.equal(await evaluate("_settingsCurrentAgentId"),"backup-import");
  assert.equal(await evaluate("typeof document.getElementById('storageExportBtn').onclick"),"function");
  assert.equal(await evaluate("typeof document.getElementById('storageImportBtn').onclick"),"function");

  const mergedNotes = await evaluate(`(()=>{ const archive={agents:[{id:'a'},{id:'b'}],notes:[]};const notes=[{id:'same',title:'A',body:'One',agentId:'a'},{id:'same',title:'B',body:'Two',agentId:'b'},{id:'general',title:'General',body:'Three',agentId:null}];mergeNoteArchive(archive,notes);mergeNoteArchive(archive,notes);normalizeNoteArchive(archive);return {count:archive.notes.length,ids:new Set(archive.notes.map(n=>n.id)).size,links:archive.notes.map(n=>n.agentId)};})()`);
  assert.deepEqual(mergedNotes,{count:3,ids:3,links:['a','b',null]});
  await evaluate(`selectAgentInSettings('personal');window.generalNote=addNote({title:'General note',body:'For every agent'});window.linkedNote=addNote({title:'Personal note',body:'Only personal',agentId:'personal'});window.otherNote=addNote({title:'Work note',body:'Only work',agentId:'work'});openNotepad();`);
  assert.ok((await evaluate("notesForAgent('personal').map(n=>n.title)")).includes("General note"));
  assert.ok(!(await evaluate("notesForAgent('personal').map(n=>n.title)")).includes("Work note"));
  await evaluate(`openWorkspaceSearch();document.querySelector('[data-search-scope=notes]').click();document.getElementById('workspaceSearchInput').value='Personal note';renderWorkspaceSearch();`);
  assert.equal(await evaluate("document.querySelectorAll('.workspace-search-result').length"),1);
  await evaluate(`document.querySelector('.workspace-search-result').click();document.getElementById('npFilter').value='agent';renderNotes();`);
  assert.equal(await evaluate("document.querySelectorAll('#npNoteList .note-nav-item').length"),1);
  assert.equal(await evaluate("activeNote().id"),await evaluate("linkedNote.id"));
  await evaluate(`document.getElementById('npFilter').value='all';renderNotes();selectNote(linkedNote.id);`);
  await screenshot("notes-archive");
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate("document.getElementById('notepadOverlay').scrollWidth>innerWidth"),false);
  await screenshot("notes-mobile");
  await command("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`closeNotepad();deleteAgent('work');`);
  assert.equal(await evaluate("state.notes.find(n=>n.id===otherNote.id).agentId"),null);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).notes.find(n=>n.id===otherNote.id).body"),"Only work");
  await evaluate(`window.notesBackup=cloneStateForStorage();importData(new File([JSON.stringify(notesBackup)],'new-backup.json',{type:'application/json'}));`);
  await pause(100);
  assert.equal(await evaluate("state.notes.filter(n=>n.id===generalNote.id).length"),1);
  await evaluate(`selectAgentInSettings('personal');activateSubtab('overview');const a={role:'assistant',content:'The configuration is ready. You can start a conversation.',time:Date.now(),rawCall:{request:{url:location.origin+'/v1/chat/completions',method:'POST',headers:{'Content-Type':'application/json'},body:{model:'test-model',messages:[{role:'user',content:'Help me get started'}]}},response:{status:200,statusText:'OK',durationMs:1230,tokens:32,content:'The configuration is ready. You can start a conversation.'},meta:{provider:'Test AI',model:'test-model'}}};currentChat().messages.push(a);renderMessages();closeSettings();document.querySelector('.inspect').click();`);
  assert.equal(await evaluate("document.getElementById('rawCallDrawer').checkVisibility()"),true);
  assert.equal(await evaluate("document.getElementById('rawCallTabOutput').checkVisibility()"),true);
  await screenshot("response-inspection");
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate("document.getElementById('rawCallDrawer').getBoundingClientRect().right>innerWidth+1"),false);
  await screenshot("inspection-mobile");
  await command("Emulation.setDeviceMetricsOverride",{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`closeRawCallDrawer();openSettings();document.getElementById('agent_cfg_inspection').click();closeSettings();`);
  assert.equal(await evaluate("document.querySelectorAll('.inspect').length"),0);
  await evaluate("openRawCallDrawer(currentChat().messages.at(-1),currentChat().messages.length-1);");
  assert.equal(await evaluate("document.getElementById('rawCallDrawer').checkVisibility()"),false);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents.find(tab=>tab.id==='personal').config.inspectionEnabled"),false);
  await evaluate(`openSettings('share');document.getElementById('shareProtectPassword').checked=false;handleGenerateShareLink();`);
  assert.equal(await evaluate("JSON.parse(base64UrlDecode(new URL(document.getElementById('shareResultInput').value).hash.slice(8))).agents[0].config.inspectionEnabled"),false);
  assert.equal(await evaluate(`(()=>{const original=structuredClone(getCurrentAgent());original.id='probe';original.config.inspectionEnabled=true;original.signature=computeAgentSignature(original);state.agents.push(original);const incoming={name:original.name,author:original.author,description:original.description,version:original.version,systemPrompt:original.systemPrompt,config:{...original.config,inspectionEnabled:false}};const result=importBundleToAgent({v:1,agents:[incoming]});return result.config.inspectionEnabled;})()`),false);
  await evaluate(`selectAppSectionInSettings('storage');`);
  assert.equal(await evaluate("document.getElementById('storageUsageText').checkVisibility()"),true);
  await screenshot("storage-details");
  await evaluate("selectAppSectionInSettings('about');");
  assert.equal(await evaluate("document.querySelector('[data-panel=about] .about-shortcuts').open"),false);
  assert.equal(await evaluate("document.querySelector('[data-panel=about]').textContent.includes('Ctrl/⌘+K')"),false);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('[data-panel=about] a')).every(a=>a.target==='_blank' && a.relList.contains('noopener') && a.relList.contains('noreferrer'))"),true);
  await screenshot("about");
  console.log("✓ Shared notes, filters, agent deletion, backup round trip and optional inspection");
  await evaluate(`closeSettings();openNotepad(generalNote.id);document.getElementById('npNoteBody').value='General note updated';document.getElementById('npNoteBody').dispatchEvent(new Event('input'));selectNote(linkedNote.id);`);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).notes.find(n=>n.id===generalNote.id).body"),"General note updated");
  assert.equal(await evaluate("document.getElementById('npNoteBody').value"),"Only personal");
  assert.equal(await evaluate("document.getElementById('sidebarNotesContent').checkVisibility()"),true);
  assert.equal(await evaluate("document.getElementById('chatList').checkVisibility()"),false);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.sidebar-footer')).borderTopWidth"),"0px");
  await evaluate(`document.getElementById('chatModeBtn').click();`);
  assert.equal(await evaluate("isNotepadOpen()"),false);
  assert.equal(await evaluate("document.getElementById('chatList').checkVisibility()"),true);
  await evaluate(`openWorkspaceSearch();document.querySelector('[data-search-scope=all]').click();document.getElementById('workspaceSearchInput').value='configuration is ready';renderWorkspaceSearch();`);
  assert.ok((await evaluate("[...document.querySelectorAll('.workspace-search-result')].map(el=>el.dataset.kind)")).includes("chat"));
  await screenshot("workspace-search");
  await evaluate(`document.querySelector('.workspace-search-result[data-kind=chat]').click();`);
  assert.equal(await evaluate("document.getElementById('workspaceSearchModal').classList.contains('hide')"),true);
  await evaluate(`(()=>{window.referenceNote=addNote({title:'Reference brief',body:'REFERENCE_BODY_INCLUDED',agentId:null});const input=document.getElementById('input');input.value='Summarize @Reference';input.focus();input.setSelectionRange(input.value.length,input.value.length);input.dispatchEvent(new Event('input'));})()`);
  assert.equal(await evaluate("document.getElementById('noteMentionPicker').checkVisibility()"),true);
  await screenshot("note-mention-picker");
  await evaluate(`document.getElementById('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));`);
  assert.equal(await evaluate("pendingAttachments[0].noteId"),await evaluate("referenceNote.id"));
  assert.equal(await evaluate("document.getElementById('input').value"),"Summarize ");
  assert.equal(await evaluate("document.getElementById('noteMentionPicker').checkVisibility()"),false);
  await evaluate(`referenceNote.body='CHANGED_AFTER_SELECTION';state.toolSettings.enabled=false;sendMessage();`);
  assert.ok(lastChatRequest,await evaluate("JSON.stringify({tab:state.activeAgentId,model:document.getElementById('modelSelect').value,configured:hasConfiguredLLM(),settings:isSettingsOpen(),last:currentChat()?.messages?.at(-1)?.content,errors:document.getElementById('statusHint').textContent})"));
  assert.ok(JSON.stringify(lastChatRequest.messages).includes("REFERENCE_BODY_INCLUDED"));
  assert.ok(!JSON.stringify(lastChatRequest.messages).includes("CHANGED_AFTER_SELECTION"));
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).agents.find(tab=>tab.id===state.activeAgentId).chats.find(chat=>chat.id===state.activeChatId).messages.findLast(message=>message.role==='user').attachments[0].source"),"note");
  await evaluate(`openNotepad();document.getElementById('newNoteBtn').click();window.createdNoteId=activeNote().id;document.getElementById('npNoteTitle').value='New editable note';document.getElementById('npNoteTitle').dispatchEvent(new Event('input'));document.getElementById('npNoteBody').value='Make bold';document.getElementById('npNoteBody').setSelectionRange(0,4);document.querySelector('#noteEditor .md-b').click();selectNote(generalNote.id);`);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem(LS_KEY)).notes.find(note=>note.id===createdNoteId).body"),"**Make** bold");
  await evaluate(`selectNote(createdNoteId);document.getElementById('noteDeleteBtn').click();closeNotepad();`);
  assert.equal(await evaluate("state.notes.some(note=>note.id===createdNoteId)"),false);
  console.log("✓ Notes detail workspace, autosave, cross-mode search and @ note context in the model request");

  await evaluate("openSettings();selectAgentInSettings('personal');activateSubtab('overview');");
  await screenshot("settings-overview");
  await evaluate("activateSubtab('providers');"); await screenshot("settings-ai");
  await evaluate("activateSubtab('mcp');"); assert.equal(await evaluate("document.getElementById('settingsSectionBackBtn').checkVisibility()"),true); await screenshot("settings-tools");
  await evaluate("activateSubtab('welcome');"); await screenshot("settings-welcome");
  await evaluate("activateSubtab('share');"); assert.equal(await evaluate("document.getElementById('settingsSectionBackBtn').checkVisibility()"),true); await screenshot("settings-share");
  await evaluate("activateSubtab('overview');");
  for(const width of [768,390,320]){
    await command("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:false});await pause(80);
    assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false,`Overflow at ${width}`);
    if(width===390)await screenshot("settings-mobile");
  }
  assert.equal(exceptions.length,0,exceptions.join("\n"));
  await evaluate("closeSettings();document.querySelector('.chat-options-menu').open=true;");
  assert.equal(await evaluate("document.getElementById('memoryBtn').checkVisibility()"),true);
  await screenshot("chat-options");
  await evaluate("window.__leavingTestPage=true");await command("Page.navigate",{url:`${origin}/portable/index.html`});await ready();
  await evaluate("openSettings();");assert.equal(await evaluate("_settingsCurrentSubtab"),"overview");
  await evaluate(`(()=>{
    const agent=createDefaultAgent('Writer',{providers:[{id:'agent-vars-provider',type:'openai',name:'Fixture provider',base:location.origin+'/v1',key:'fixture-key',models:'test-model',enabled:true}],mcpServers:[],agent:normalizeAgentSettings({enabled:false})},'You are {{agent.name}}. User {{user.name}}. Organization {{vars.company}}.',{userName:'Customer',variables:{company:'Acme'}});
    state.agents.push(agent);state.general.userName='';switchAgent(agent.id);openSettings();
    document.getElementById('agentUserNameInput').value='Guest';settingsDraftChanged();activateSubtab('instructions');
    document.getElementById('agentVariablesInput').value=JSON.stringify({company:'Example organization'});settingsDraftChanged();flushSettingsAutosave();
    document.querySelector('#agentPromptPreview').closest('details').open=true;
  })()`);
  assert.equal(await evaluate("document.getElementById('agentPromptPreview').textContent.includes('User Guest. Organization Example organization.')"),true);
  await screenshot('agent-prompt-preview');
  await evaluate("(async()=>{closeSettings();document.getElementById('input').value='Identity probe';await sendMessage();})()");
  assert.ok(lastChatRequest.messages.some(message=>message.role==='system' && message.content.includes('User Guest. Organization Example organization.')));
  assert.equal(await evaluate("document.querySelector('.msg.user').textContent.includes('Guest')"),true);
  assert.equal(await evaluate("document.querySelector('.msg.assistant').textContent.includes('Writer')"),true);
  await evaluate("(async()=>{openSettings('general');document.getElementById('cfg_user_name').value='Claudio';settingsDraftChanged();closeSettings();document.getElementById('input').value='Global identity';await sendMessage();})()");
  assert.ok(lastChatRequest.messages.some(message=>message.role==='system' && message.content.includes('User Claudio.')));
  await evaluate("openSettings('instructions');document.getElementById('agent_cfg_system').value='Updated {{user.name}}';settingsDraftChanged();closeSettings();openChatPromptModal();document.getElementById('chatInheritPromptCheck').checked=false;document.getElementById('chatInheritPromptCheck').dispatchEvent(new Event('change'));document.getElementById('chatCustomPrompt').value='Personal {{user.name}}';document.getElementById('saveChatPromptBtn').click();getCurrentAgent().systemPrompt='Latest agent instructions';");
  assert.equal(await evaluate("currentChat().promptMode"),'override');
  assert.equal(await evaluate("effectiveSystemPrompt(currentChat()).includes('Personal Claudio')"),true);
  await evaluate("openChatPromptModal();document.getElementById('chatInheritPromptCheck').checked=true;document.getElementById('saveChatPromptBtn').click();");
  assert.equal(await evaluate("effectiveSystemPrompt(currentChat()).includes('Latest agent instructions')"),true);
  await evaluate("(async()=>{openSettings('instructions');document.getElementById('agent_cfg_system').value='{{provider.key}}';settingsDraftChanged();closeSettings();window.messageCountBeforeInvalidPrompt=currentChat().messages.length;document.getElementById('input').value='Keep my question';await sendMessage();})()");
  assert.equal(await evaluate("currentChat().messages.length===messageCountBeforeInvalidPrompt"),true);
  assert.equal(await evaluate("document.getElementById('input').value"),'Keep my question');
  assert.equal(await evaluate("document.getElementById('agentPromptError').checkVisibility()"),true);
  await evaluate("document.getElementById('agent_cfg_system').value='Safe {{user.name}}';document.getElementById('agentVariablesInput').value='{';settingsDraftChanged();closeSettings();");
  assert.equal(await evaluate("isSettingsOpen()"),true);
  assert.equal(await evaluate("document.getElementById('agentVariablesInput').validity.valid"),false);
  await evaluate("document.getElementById('agentVariablesInput').value=JSON.stringify({company:'Saved'});settingsDraftChanged();closeSettings();");
  assert.equal(await evaluate("isSettingsOpen()"),false);
  assert.equal(await evaluate("getCurrentAgent().variables.company"),'Saved');
  await evaluate("document.getElementById('modelSelect').dispatchEvent(new Event('change'));saveMessageToNotepad(currentChat().messages.find(message=>message.role==='assistant'));");
  assert.equal(await evaluate("getCurrentAgent().name"),'Writer');
  assert.equal(await evaluate("state.notes.some(note=>note.src?.includes('Writer'))"),true);
  console.log('✓ Agent/global identity in real messages and API payloads, resolved preview, live inheritance, explicit overrides, unknown-variable blocking and invalid JSON recovery');

  console.log("✓ Agent management, backup actions, responsive layout and standalone startup");
  assert.equal(exceptions.length,0,exceptions.join("\n"));
  console.log("All settings UI checks passed.");
} finally {
  if(ws)ws.close();
  for(const item of pending.values())clearTimeout(item.timer);
  if(chrome){chrome.kill();await pause(150);}
  if(server)await new Promise(resolve=>server.close(resolve));
  await fs.rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
