import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { brotliDecompressSync } from 'node:zlib';
const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'tabs-resources-'));
const hosted = path.join(scratch, 'hosted'), portable = path.join(scratch, 'portable');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
let server, chrome, ws, nextId = 0;
const pending = new Map(), exceptions = [], missing = [], external = [];
let normalBackup;
const mime = { '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript', '.css':'text/css', '.png':'image/png', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf' };
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (result.exceptionDetails) throw new Error((result.exceptionDetails.exception?.description || result.exceptionDetails.text) + '\nBrowser exceptions: ' + exceptions.join('\n'));
  return result.result.value;
}
async function reloadApplication(){
  await evaluate('window.__awaitingReload=true');
  await command('Page.reload',{ignoreCache:true});
  for(let i=0;i<150;i++){
    try { if(await evaluate("!window.__awaitingReload && document.readyState==='complete' && typeof state!=='undefined' && !!document.getElementById('settingsBtn')?.onclick"))return; } catch {}
    await pause(100);
  }
  throw new Error('Application did not initialize after reloading saved data');
}

function makePdf(cjk = false, fontName = 'Helvetica') {
  const text = cjk ? '<65E5672C8A9E>' : fontName === 'Symbol' ? '(abc)' : fontName === 'ZapfDingbats' ? '(4)' : '(Offline PDF works)';
  const content = `BT /F1 18 Tf 40 100 Td ${text} Tj ET`;
  const font = cjk ? '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UTF16-H /DescendantFonts [6 0 R] >>' : `<< /Type /Font /Subtype /Type1 /BaseFont /${fontName}${fontName === 'ZapfDingbats' ? ' /ToUnicode 6 0 R' : ''} >>`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', font, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  if (cjk) objects.push('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> /DW 1000 >>');
  if (fontName === 'ZapfDingbats') {
    const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <34> <2714> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
    objects.push(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  }
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf).toString('base64');
}
const zip = new JSZip();
zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Offline DOCX works</w:t></w:r></w:p></w:body></w:document>');
const docx = await zip.generateAsync({ type:'base64' });

try {
  for (const [target,out] of [['hosted',hosted],['standalone',portable]]) execFileSync(process.execPath, ['build.js',`--target=${target}`,`--out=${out}`,`--edition=${target === 'standalone' ? 'all' : 'normal'}`], { cwd:root, stdio:'pipe' });
  const html = await fs.readFile(path.join(portable,'index.html'),'utf8');
  const payload = brotliDecompressSync(Buffer.from(html.match(/<script id="tabs-payload" type="application\/octet-stream">([^<]+)<\/script>/)[1], 'base64'));
  const headerLength = payload.readUInt32LE(0);
  const embedded = JSON.parse(payload.subarray(4, 4 + headerLength));
  const [noticeOffset, noticeLength] = embedded['vendor/THIRD_PARTY_NOTICES.txt'];
  assert.match(payload.subarray(4 + headerLength + noticeOffset, 4 + headerLength + noticeOffset + noticeLength).toString(), /Apache License/);
  assert.ok(Buffer.byteLength(html) < 4_000_000, 'The complete standalone HTML must stay below 4 MB');
  assert.equal(html, await fs.readFile(path.join(portable,'tabs-chat.html'),'utf8'));
  const liteHtml = await fs.readFile(path.join(portable,'tabs-chat-lite.html'),'utf8');
  assert.ok(Buffer.byteLength(liteHtml) < 750_000, 'Lite must stay below 750 KB');
  const liteData = brotliDecompressSync(Buffer.from(liteHtml.match(/<script id="tabs-payload" type="application\/octet-stream">([^<]+)<\/script>/)[1], 'base64'));
  const liteHeader = liteData.readUInt32LE(0), liteIndex = JSON.parse(liteData.subarray(4,4+liteHeader));
  assert.ok(!Object.keys(liteIndex).some(name=>/^vendor\/(?:katex|auto-render|mammoth|mermaid|pdf|fonts\/)/.test(name)), 'Lite must not contain optional libraries, fonts, PDF workers or character maps');
  for(const name of ['vendor/marked.min.js','vendor/purify.min.js','vendor/highlight.min.js','js/agent/mcp-client.js','js/agent/loop.js','js/notepad.js']) assert.ok(liteIndex[name], 'Lite must retain ' + name);
  const [liteOffset,liteLength] = liteIndex['vendor/THIRD_PARTY_NOTICES.txt'];
  const liteNotices = liteData.subarray(4+liteHeader+liteOffset,4+liteHeader+liteOffset+liteLength).toString();
  for(const name of ['marked','dompurify','highlight.js','brotli','base64-js']) assert.ok(liteNotices.includes(name+'@'));
  assert.doesNotMatch(liteNotices,/mermaid@|mammoth@|pdfjs-dist@|katex@|elkjs@/);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["'](?:vendor|js|css|assets)\//i);
  assert.equal(await fs.readFile(path.join(hosted,'THIRD_PARTY_NOTICES.txt'),'utf8'), await fs.readFile(path.join(root,'THIRD_PARTY_NOTICES.txt'),'utf8'));
  // Reproduce an incomplete vendor checkout in an isolated copy: build must stop.
  const broken = path.join(scratch, 'broken');
  await fs.mkdir(broken);
  for (const name of ['build.js','package.json','package-lock.json','LICENSE']) await fs.copyFile(path.join(root,name),path.join(broken,name));
  await fs.cp(path.join(root,'src'),path.join(broken,'src'),{recursive:true});
  await fs.unlink(path.join(broken,'src/vendor/fonts/KaTeX_Main-Regular.woff2'));
  assert.throws(() => execFileSync(process.execPath,['build.js','--target=hosted'],{cwd:broken,stdio:'pipe'}), /Missing or modified vendor file/);
  console.log('✓ Both distributions carry notices; missing vendor resources fail the build');
  server = http.createServer(async (req,res) => {
    const filename = path.join(hosted, new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));
    if (!filename.startsWith(hosted+path.sep)) { res.writeHead(403);res.end();return; }
    try { const data=await fs.readFile(filename);res.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');res.end(data); }
    catch { missing.push(req.url);res.writeHead(404);res.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${path.join(scratch,'profile')}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{stdio:'ignore'});
  let port;
  for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(scratch,'profile/DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(100);}}
  assert.ok(port,'Chrome did not start');
  const page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page=>page.type==='page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage = event => {
    const message=JSON.parse(event.data);
    if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
    if(message.method==='Network.requestWillBeSent' && /^https?:/.test(message.params.request.url) && !message.params.request.url.startsWith(origin+'/')) external.push(message.params.request.url);
  };
  await command('Runtime.enable');await command('Page.enable');await command('Network.enable');
  await command('Emulation.setDeviceMetricsOverride',{width:1200,height:1100,deviceScaleFactor:1,mobile:false});
  for (const [target,url] of [['hosted',origin+'/'],['standalone',pathToFileURL(path.join(portable,'index.html')).href],['lite',pathToFileURL(path.join(portable,'tabs-chat-lite.html')).href]]) {
    if(target!=='hosted') await command('Network.setBlockedURLs',{urls:['http://*','https://*']});
    await command('Page.navigate',{url});
    for(let i=0;i<150;i++){try{if(await evaluate("document.readyState==='complete' && typeof loadMermaid==='function' && !!document.getElementById('settingsBtn')?.onclick"))break;}catch{}await pause(100);}
    await evaluate(`localStorage.setItem(LS_KEY,JSON.stringify({schemaVersion:1,agents:[{id:'reload-agent',name:'Reloaded agent',userName:'Customer',systemPrompt:'Hello {{user.name}}',config:{providers:[],mcpServers:[]},chats:[{id:'reload-chat',promptMode:'inherit',systemPrompt:'Hello {{user.name}}',messages:[{role:'user',content:'Keep this conversation'}]}]}],activeAgentId:'reload-agent',general:{userName:''}}))`);
    await reloadApplication();
    assert.deepEqual(await evaluate("({name:getCurrentAgent().name,user:resolvedIdentity().userName,message:getCurrentAgent().chats[0].messages[0].content,mode:getCurrentAgent().chats[0].promptMode})"),{name:'Reloaded agent',user:'Customer',message:'Keep this conversation',mode:'inherit'});
    await evaluate("state.general.userName='Profile';getCurrentAgent().variables={company:'Saved company'};saveState()");
    await reloadApplication();
    assert.deepEqual(await evaluate("({schema:JSON.parse(localStorage.getItem(LS_KEY)).schemaVersion,name:getCurrentAgent().name,user:resolvedIdentity().userName,company:getCurrentAgent().variables.company,message:getCurrentAgent().chats[0].messages[0].content})"),{schema:1,name:'Reloaded agent',user:'Profile',company:'Saved company',message:'Keep this conversation'});
    console.log(`✓ ${target}: agent settings and conversations survive an actual browser reload`);
    if(target === 'lite') {
      const restored = await evaluate(`(()=>{
        localStorage.setItem(LS_KEY,${JSON.stringify(normalBackup)});state=loadState();
        const tab=getCurrentAgent();const chat=tab.chats.find(chat=>chat.id==='edition-history');
        return {provider:tab.config.providers[0].id,mcp:tab.config.mcpServers[0].id,note:state.notes.find(note=>note.id==='edition-note').content,attachment:chat.messages[0].attachments[0].text,edition:APP_BUILD.edition,pdf:appHasFeature('pdf')};
      })()`);
      assert.deepEqual(restored,{provider:'shared-provider',mcp:'shared-mcp',note:'Shared across editions',attachment:'Previously extracted PDF text',edition:'lite',pdf:false});
      const lite = await evaluate(`(async()=>{
        const panel=document.createElement('main');panel.id='lite-resource-check';
        panel.style.cssText='position:fixed;inset:0;z-index:99999;background:white;color:#222;padding:28px;overflow:auto';
        panel.innerHTML=renderMarkdown('# Lite rendering\\n\\n| Feature | Available |\\n|---|---|\\n| Markdown | Yes |\\n\\n'+ '\x60\x60\x60mermaid\\ngraph TD\\n A[Text] --> B[Copy]\\n\x60\x60\x60\\n\\n\x60\x60\x60javascript\\nconst answer = 42;\\n\x60\x60\x60\\n\\nFormula: $$\\\\frac{a}{b}$$');
        document.body.appendChild(panel);renderMathIn(panel);enhanceCodeBlocks(panel);await enhanceMermaid(panel);
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__fixtureCopied=text}}});
        panel.querySelector('pre .copy-code').click();
        const picker=document.getElementById('fileInput');picker.click=()=>{window.__fixtureAccept=picker.accept};document.getElementById('attachBtn').click();
        const notices=new TextDecoder().decode(await vendorBytes('THIRD_PARTY_NOTICES.txt'));
        return {edition:APP_BUILD.edition,frozen:Object.isFrozen(APP_BUILD),flags:['diagrams','math','pdf','docx'].map(appHasFeature),libraries:[typeof katex,typeof mammoth,typeof window.__mermaid],table:!!panel.querySelector('table'),diagram:!!panel.querySelector('svg'),math:!!panel.querySelector('.katex'),formula:panel.textContent.includes('\\\\frac{a}{b}'),code:!!panel.querySelector('.hljs-keyword'),copies:panel.querySelectorAll('.copy-code').length,copied:window.__fixtureCopied,accept:window.__fixtureAccept,badge:document.getElementById('aboutEditionBadge').textContent,capabilities:document.getElementById('aboutCapabilities').textContent,licenses:notices.includes('DOMPurify'),bootMs:window.__tabsBootMs};
      })()`);
      assert.equal(lite.edition,'lite');assert.equal(lite.frozen,true);assert.deepEqual(lite.flags,[false,false,false,false]);assert.deepEqual(lite.libraries,['undefined','undefined','undefined']);
      assert.equal(lite.table,true);assert.equal(lite.diagram,false);assert.equal(lite.math,false);assert.equal(lite.formula,true);assert.equal(lite.code,true);assert.equal(lite.copies,2);assert.match(lite.copied,/graph TD/);
      assert.match(lite.accept,/image\/\*/);assert.match(lite.accept,/text\/\*/);assert.doesNotMatch(lite.accept,/pdf|docx/);assert.equal(lite.badge,'Lite');assert.doesNotMatch(lite.capabilities,/PDF|DOCX|KaTeX|Mermaid/);assert.equal(lite.licenses,true);
      const attachments=await evaluate(`(async()=>{
        const pdf=new File(['blocked'],'blocked.PDF',{type:'application/octet-stream'});
        const word=new File(['blocked'],'Word document',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
        const canvas=Object.assign(document.createElement('canvas'),{width:2,height:2});canvas.getContext('2d').fillRect(0,0,2,2);
        const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        pendingAttachments=[];
        await handleFiles([pdf,new File(['Text attachment'],'notes.txt',{type:'text/plain'}),word,new File(['const fixture = true;'],'fixture.js',{type:'text/javascript'}),new File([image],'image.png',{type:'image/png'}),new File([new Uint8Array([80,75,0,0])],'archive.zip',{type:'application/zip'})]);
        const accepted=pendingAttachments.map(file=>({name:file.name,kind:file.kind,text:file.text}));
        const message=document.getElementById('attachmentNotice').textContent;
        const transfer=new DataTransfer();transfer.items.add(pdf);
        document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
        const dropped=document.getElementById('attachmentNotice').textContent;
        await handleFiles([new File(['After rejection'],'after.txt',{type:'text/plain'})]);
        return {accepted,message,dropped,cleared:document.getElementById('attachmentNotice').classList.contains('hide')};
      })()`);
      assert.deepEqual(attachments.accepted.map(file=>file.name),['notes.txt','fixture.js','image.png']);assert.equal(attachments.accepted[2].kind,'image');assert.equal(attachments.accepted[0].text,'Text attachment');assert.match(attachments.message,/Normal.*blocked.PDF.*Word document/);assert.match(attachments.message,/Skipped binary files: archive.zip/);assert.match(attachments.dropped,/Normal.*blocked.PDF/);assert.equal(attachments.cleared,true);
      await evaluate("document.getElementById('lite-resource-check').remove()");
      await command('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
      await evaluate("handleFiles([new File(['blocked'],'a'.repeat(180)+'.pdf',{type:'application/pdf'})])");
      assert.equal(await evaluate("document.getElementById('attachmentNotice').scrollWidth>document.getElementById('attachmentNotice').clientWidth"),false,'Long rejected filenames must fit the mobile composer');
      if(process.env.UI_ARTIFACT_DIR){const shot=await command('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.UI_ARTIFACT_DIR,'lite-mobile-attachments.png'),Buffer.from(shot.data,'base64'));}
      await command('Emulation.setDeviceMetricsOverride',{width:1200,height:1100,deviceScaleFactor:1,mobile:false});
      const chat=await evaluate(`(async()=>{
        window.__fixtureRequests=[];
        window.fetch=async(url,options={})=>{
          const rpc=options.body?JSON.parse(options.body):null;window.__fixtureRequests.push({url:String(url),rpc});
          if(String(url).endsWith('/mcp')){
            const result=rpc.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}}}:rpc.method==='tools/list'?{tools:[{name:'echo',description:'Fixture',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'Lite MCP works'}]};
            return new Response(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result}),{headers:{'content-type':'application/json'}});
          }
          if(String(url).endsWith('/chat/completions')) return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Lite chat works'},finish_reason:null}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});
          throw new Error('Unexpected request: '+url);
        };
        const client=new McpClient({id:'lite-mcp',name:'Fixture',url:'https://fixture.invalid/mcp'});await client.initialize();const tools=await client.listTools();const result=await client.callTool('echo',{});
        const tab=getCurrentAgent();tab.config.providers=[{id:'lite-provider',type:'openai',name:'Fixture',base:'https://fixture.invalid/v1',key:'fixture-key',models:'lite-model'}];tab.config.mcpServers=[];tab.chats=[];state.activeChatId=null;state.toolSettings.enabled=false;
        populateModelSelect();newChat();pendingAttachments=[];
        document.getElementById('input').value='Test Lite';await sendMessage();
        openSettings('about');
        return {tools:tools.map(tool=>tool.name),mcp:result.content[0].text,answer:currentChat().messages.at(-1).content,requests:window.__fixtureRequests.length,edition:APP_BUILD.edition,editionSaved:JSON.stringify(state).includes('"edition":')};
      })()`);
      assert.deepEqual(chat.tools,['echo']);assert.equal(chat.mcp,'Lite MCP works');assert.equal(chat.answer,'Lite chat works');assert.equal(chat.edition,'lite');assert.equal(chat.editionSaved,false);
      if(process.env.UI_ARTIFACT_DIR){const shot=await command('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.UI_ARTIFACT_DIR,'resources-lite.png'),Buffer.from(shot.data,'base64'));}
      assert.deepEqual(external,[]);
      console.log(`✓ Lite: ${Buffer.byteLength(liteHtml)} bytes, no optional libraries/network, Markdown/code/copy, text/image attachments, rejected PDF/DOCX/drop, chat and MCP (bootstrap ${Math.round(lite.bootMs)} ms)`);
      continue;
    }
    const rendering = await evaluate(`(async()=>{
      window.__xssExecuted=false;
      document.documentElement.dataset.theme='light';
      const panel=document.createElement('main');panel.id='resource-check';
      panel.style.cssText='position:fixed;inset:0;z-index:99999;background:white;color:#222;padding:32px;overflow:auto';
      panel.innerHTML='<h1>Rendering & offline attachments</h1><p id="math-check">$$\\\\mathbb{R} \\\\ni x = \\\\frac{-b \\\\pm \\\\sqrt{b^2-4ac}}{2a}$$</p><div id="diagram-check"></div><pre id="attachment-results"></pre>';
      document.body.appendChild(panel);renderMathIn(panel);
      const fonts=await document.fonts.load('18px KaTeX_Main');await document.fonts.ready;
      const diagram=document.getElementById('diagram-check');
      const mermaid=await loadMermaid();
      for(const [index,source] of ['graph TD\\n A[Local file] --> B[Diagram works]','sequenceDiagram\\n Alice->>Bob: Offline','pie title Local data\\n "A": 60\\n "B": 40'].entries()){
        const {svg}=await mermaid.render('fixture_'+index,source);const el=document.createElement('div');el.innerHTML=svg;diagram.appendChild(el);
      }
      const hostile=['<img src="data:," onerror="window.__xssExecuted=true">','<a href="javascript:window.__xssExecuted=true">link</a>','<svg><g onload="window.__xssExecuted=true"></g></svg>'];
      const sanitized=hostile.map(text=>renderMarkdown(text));
      const test=document.createElement('div');test.innerHTML=sanitized.join('');
      test.querySelectorAll('*').forEach(el=>{el.dispatchEvent(new Event('error'));el.dispatchEvent(new Event('load'));});
      const code=hljs.highlight('const answer = 42;', {language:'javascript'}).value;
      const notices=new TextDecoder().decode(await vendorBytes('THIRD_PARTY_NOTICES.txt'));
      return {diagrams:diagram.querySelectorAll('svg').length,math:!!panel.querySelector('.katex-mathml'),fonts:fonts.length,fontStatus:fonts.map(font=>font.status),sanitized,xss:window.__xssExecuted,highlighted:code.includes('hljs-keyword'),purifier:DOMPurify.version,notices:notices.includes('Apache License'),bootMs:window.__tabsBootMs||0};
    })()`);
    assert.equal(rendering.diagrams,3);assert.equal(rendering.math,true);assert.ok(rendering.fonts>0);assert.ok(rendering.fontStatus.every(status=>status==='loaded'));
    assert.equal(rendering.highlighted,true);assert.equal(rendering.xss,false);assert.ok(rendering.sanitized.every(html=>!/onerror|onload|javascript:/i.test(html)));
    assert.equal(rendering.notices,true);
    const attachmentResult=await evaluate(`(async()=>{
      const original=vendorBytes;window.__vendorReads=[];vendorBytes=async name=>{window.__vendorReads.push(name);return original(name)};
      const file=(name,type,data)=>new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],name,{type});
      pendingAttachments=[];
      await handleFiles([file('latin.pdf','application/pdf',${JSON.stringify(makePdf())}),file('japanese.pdf','application/pdf',${JSON.stringify(makePdf(true))}),file('symbol.pdf','application/pdf',${JSON.stringify(makePdf(false, 'Symbol'))}),file('dingbats.pdf','application/pdf',${JSON.stringify(makePdf(false, 'ZapfDingbats'))}),file('fixture.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',${JSON.stringify(docx)})]);
      const text=pendingAttachments.map(a=>a.text);document.getElementById('attachment-results').textContent=text.join('\\n');
      return {text,reads:window.__vendorReads};
    })()`);
    assert.match(attachmentResult.text[0],/Offline PDF works/);assert.match(attachmentResult.text[1],/日本語/);assert.match(attachmentResult.text[2],/αβχ/);assert.match(attachmentResult.text[3],/✔/);assert.match(attachmentResult.text[4],/Offline DOCX works/);
    assert.ok(attachmentResult.reads.some(name=>name.startsWith('pdf/cmaps/')),'CJK fixture must exercise CMap resources');
    assert.ok(attachmentResult.reads.includes('pdf/standard_fonts/FoxitSymbol.pfb'));
    assert.ok(attachmentResult.reads.includes('pdf/standard_fonts/FoxitDingbats.pfb'));
    assert.deepEqual(external,[],'Rendering and attachment parsing must not contact external hosts');
    assert.deepEqual(missing.filter(url=>!['/manifest.webmanifest','/sw.js','/favicon.ico'].includes(url)),[]);
    if(process.env.UI_ARTIFACT_DIR){await fs.mkdir(process.env.UI_ARTIFACT_DIR,{recursive:true});const shot=await command('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.UI_ARTIFACT_DIR,`resources-${target}.png`),Buffer.from(shot.data,'base64'));}
    if(target === 'standalone') normalBackup = await evaluate(`(()=>{
      const tab=getCurrentAgent();tab.config.providers=[{id:'shared-provider',type:'openai',base:'https://fixture.invalid/v1',models:'fixture-model',key:''}];
      tab.config.mcpServers=[{id:'shared-mcp',url:'https://fixture.invalid/mcp',enabled:false}];
      tab.chats.push({id:'edition-history',title:'Saved PDF conversation',model:'',messages:[{role:'user',content:'Saved document',attachments:[{kind:'file',name:'saved.pdf',mime:'application/pdf',text:'Previously extracted PDF text'}]}]});
      state.notes.push({id:'edition-note',title:'Shared note',content:'Shared across editions',agentId:tab.id,createdAt:Date.now(),updatedAt:Date.now()});
      return JSON.stringify(cloneStateForStorage(state));
    })()`);
    console.log(`✓ ${target}: diagrams, loaded math fonts, syntax highlighting, HTML sanitization, PDF/CJK/DOCX parsing${target==='standalone'?` from file:// with HTTP(S) blocked (bootstrap ${Math.round(rendering.bootMs)} ms)`:''}`);
  }
  assert.deepEqual(exceptions,[]);
  console.log('All build resource checks passed.');
} finally {
  if(ws)ws.close();for(const item of pending.values())clearTimeout(item.timer);
  if(chrome){chrome.kill();await pause(150);}
  if(server)await new Promise(resolve=>server.close(resolve));
  await fs.rm(scratch,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
