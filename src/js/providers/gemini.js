/* -------- Google Gemini -------- */
async function callGemini({cfg, model, chat, signal, onContent, onReasoning, onToolCall, tools, rawCall}){
  const url = `${cfg.base.replace(/\/+$/,"")}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.key)}`;
  const contents = [];
  const msgs = lastN(chat.messages, chat);
  const allowAttachG = computeAttachmentAllowSet(msgs);
  for(const m of msgs){
    if(m.role==="tool"){
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: m.name || "tool",
            response: typeof m.content === "object" ? m.content : { result: m.content }
          }
        }]
      });
      continue;
    }
    if(m.role==="assistant"){
      const parts = [];
      const content = assistantRequestContent(m);
      if(content) parts.push({text:content});
      if(m.tool_calls && m.tool_calls.length){
        for(const tc of m.tool_calls){
          let args = {};
          try { args = typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {}; } catch {}
          parts.push({
            functionCall: {
              name: tc.function?.name,
              args
            }
          });
        }
      }
      if(parts.length) contents.push({role:"model", parts});
      continue;
    }
    const parts = [];
    let txt = m.content||"";
    const attachmentsG = allowAttachG.has(m) ? (m.attachments||[]) : [];
    const fileTexts = attachmentsG.filter(a=>a.kind==="file" && a.text);
    if(fileTexts.length){ txt += "\n\n" + fileTexts.map(f=>`${t("attach.label", f.name)}\n${f.text}`).join("\n\n"); }
    if(txt) parts.push({text:txt});
    for(const img of attachmentsG.filter(a=>a.kind==="image" && a.dataUrl)){
      const [meta, b64] = img.dataUrl.split(",");
      const mime = (meta.match(/data:(.*?);/)||[])[1] || "image/png";
      // Gemini REST 要 camelCase
      parts.push({inlineData:{mimeType:mime, data:b64}});
    }
    contents.push({role:"user", parts});
  }
  const genCfg = {
    temperature: llmTemp(),
    maxOutputTokens: Number(state.general.maxTokens)||undefined
  };
  // 思考模式优先；auto 时沿用旧行为（跟随"显示思考"开关）
  const thinkG = thinkMode();
  const wantThinkG = thinkG === "auto" ? !!state.general.showThinking : thinkG === "on";
  genCfg.thinkingConfig = wantThinkG ? { includeThoughts: true } : { thinkingBudget: 0 };
  const body = {
    contents: mergeAdjacentRoles(contents, (a,b)=>{ a.parts = [...(a.parts||[]), ...(b.parts||[])]; }),
    generationConfig: genCfg
  };
  if(tools && tools.length) body.tools = tools;
  const sysG = effectiveSystemPrompt(chat);
  if(sysG) body.systemInstruction = {parts:[{text:sysG}]};
  const headers = {"Content-Type":"application/json"};
  if(rawCall){
    rawCall.request.url = url.replace(/key=[^&]+/, "key=" + maskApiKey(cfg.key));
    rawCall.request.method = "POST";
    rawCall.request.headers = headers;
    rawCall.request.body = sanitizeBodyForRecord(body);
  }
  const r = await fetch(url,{method:"POST",headers,body:JSON.stringify(body),signal});
  if(rawCall){
    rawCall.response.status = r.status;
    rawCall.response.statusText = r.statusText || (r.status===200?"OK":"");
  }
  if(!r.ok) throw await httpError(r);
  let streamErr = null, finish = "";
  const toolCallsAcc = [];
  await readSSE(r,(json)=>{
    if(json.error){ streamErr = new Error(streamErrMessage(json.error)); return; }
    // 提示词被安全策略拦截：没有 candidates，只有 promptFeedback.blockReason
    const block = json.promptFeedback?.blockReason;
    if(block){ streamErr = new Error(t("msg.blocked")+" ("+block+")"); return; }
    const cand = json.candidates?.[0];
    if(cand?.finishReason && cand.finishReason!=="STOP"){ finish = cand.finishReason; if(rawCall) rawCall.response.finishReason = finish; }
    const parts = cand?.content?.parts;
    if(!parts) return;
    for(const p of parts){
      if(p.thought) onReasoning(p.thought);
      if(p.text) onContent(p.text);
      if(p.functionCall){
        toolCallsAcc.push({
          id: `call_${Date.now()}_${toolCallsAcc.length}`,
          type: "function",
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args || {})
          }
        });
      }
    }
    if(json.usageMetadata?.candidatesTokenCount && rawCall){
      rawCall.response.tokens = json.usageMetadata.candidatesTokenCount;
      rawCall.response.usage = json.usageMetadata;
    }
  });
  if(toolCallsAcc.length && onToolCall){
    onToolCall(toolCallsAcc);
  }
  if(streamErr) throw streamErr;
  if(finish === "MAX_TOKENS") onContent("\n\n> ⚠️ "+t("msg.truncated"));
  else if(finish === "SAFETY" || finish === "RECITATION") onContent("\n\n> ⚠️ "+t("msg.blocked")+" ("+finish+")");
}

