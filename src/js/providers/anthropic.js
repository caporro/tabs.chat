/* -------- Anthropic Claude -------- */
async function callClaude({cfg, model, chat, signal, onContent, onReasoning, onToolCall, tools, rawCall}){
  const url = cfg.base.replace(/\/+$/,"") + "/messages";
  const messages = [];
  const msgs = lastN(chat.messages, chat);
  const allowAttachC = computeAttachmentAllowSet(msgs);
  for(const m of msgs){
    if(m.role==="tool"){
      messages.push({
        role:"user",
        content:[{
          type:"tool_result",
          tool_use_id: m.tool_call_id || "toolu_1",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
        }]
      });
      continue;
    }
    if(m.role==="assistant"){
      const blocks = [];
      const content = assistantRequestContent(m);
      if(content) blocks.push({type:"text", text:content});
      if(m.tool_calls && m.tool_calls.length){
        for(const tc of m.tool_calls){
          let inputObj = {};
          try { inputObj = typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {}; } catch {}
          blocks.push({
            type:"tool_use",
            id: tc.id,
            name: tc.function?.name,
            input: inputObj
          });
        }
      }
      if(blocks.length) messages.push({role:"assistant", content:blocks});
      continue;
    }
    const blocks = [];
    let txt = m.content||"";
    const attachmentsC = allowAttachC.has(m) ? (m.attachments||[]) : [];
    const fileTexts = attachmentsC.filter(a=>a.kind==="file" && a.text);
    if(fileTexts.length){ txt += "\n\n" + fileTexts.map(f=>`${t("attach.label", f.name)}\n${f.text}`).join("\n\n"); }
    if(txt) blocks.push({type:"text", text:txt});
    for(const img of attachmentsC.filter(a=>a.kind==="image" && a.dataUrl)){
      const [meta, b64] = img.dataUrl.split(",");
      const media_type = (meta.match(/data:(.*?);/)||[])[1] || "image/png";
      blocks.push({type:"image", source:{type:"base64", media_type, data:b64}});
    }
    messages.push({role:"user", content:blocks});
  }
  const body = {
    model,
    // 丢弃错误轮次后可能留下连续 user 消息，Anthropic 要求角色交替
    messages: mergeAdjacentRoles(messages, (a,b)=>{ a.content = [...a.content, ...b.content]; }),
    stream:true,
    max_tokens: outputTokenLimit(4096),
    ...temperatureParams(),
  };
  if(tools && tools.length) body.tools = tools;
  const sysC = effectiveSystemPrompt(chat);
  if(sysC) body.system = sysC;
  const headers = {
    "Content-Type":"application/json",
    "x-api-key": cfg.key,
    "anthropic-version":"2023-06-01",
    "anthropic-dangerous-direct-browser-access":"true"
  };
  if(cfg.headers){
    Object.assign(headers, parseCustomHeaders(cfg.headers));
  }
  if(rawCall){
    rawCall.request.url = url;
    rawCall.request.method = "POST";
    const recordedHeaders = Object.assign({}, headers);
    if(cfg.key && recordedHeaders["x-api-key"]) recordedHeaders["x-api-key"] = maskApiKey(cfg.key);
    rawCall.request.headers = recordedHeaders;
    rawCall.request.body = sanitizeBodyForRecord(body);
  }
  const r = await connectionFetch(cfg,url,{method:"POST",headers,body:JSON.stringify(body),signal},rawCall);
  if(rawCall){
    rawCall.response.status = r.status;
    rawCall.response.statusText = r.statusText || (r.status===200?"OK":"");
  }
  if(!r.ok) throw await httpError(r);
  let streamErr = null, stopReason = "";
  const toolCallsAcc = [];
  let currentBlock = null;
  await readSSE(r,(json)=>{
    // Anthropic 会在流里发 event: error（data 为 {type:"error",error:{...}}）
    if(json.type==="error"){ streamErr = new Error(streamErrMessage(json.error)); return; }
    if(json.type==="content_block_start"){
      const b = json.content_block;
      if(b && b.type==="tool_use"){
        currentBlock = { id: b.id, name: b.name, argumentsJson: "" };
      }
    }
    if(json.type==="content_block_delta"){
      if(json.delta?.type==="text_delta") onContent(json.delta.text);
      else if(json.delta?.type==="thinking_delta") onReasoning(json.delta.thinking||"");
      else if(json.delta?.type==="input_json_delta" && currentBlock){
        currentBlock.argumentsJson += json.delta.partial_json || "";
      }
    }
    if(json.type==="content_block_stop"){
      if(currentBlock){
        toolCallsAcc.push({
          id: currentBlock.id,
          type: "function",
          function: { name: currentBlock.name, arguments: currentBlock.argumentsJson }
        });
        currentBlock = null;
      }
    }
    if(json.type==="message_delta"){
      if(json.delta?.stop_reason){ stopReason = json.delta.stop_reason; if(rawCall) rawCall.response.finishReason = stopReason; }
      if(json.usage?.output_tokens && rawCall){
        rawCall.response.tokens = json.usage.output_tokens;
        rawCall.response.usage = json.usage;
      }
    }
  });
  if(toolCallsAcc.length && onToolCall){
    onToolCall(toolCallsAcc);
  }
  if(streamErr) throw streamErr;
  if(stopReason === "max_tokens") onContent("\n\n> ⚠️ "+t("msg.truncated"));
}

