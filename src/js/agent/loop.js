/**
 * Agent Execution Loop for tabs.chat
 * Orchestrates multi-turn ReAct loops:
 * 1. Calls provider with available MCP tools
 * 2. If model emits tool_calls, executes each tool via toolRegistry
 * 3. Appends tool results and repeats up to maxTurns
 */

async function runAgentLoop(chat, initialAiMsg, modelId) {
  const maxTurns = Math.max(1, Math.min(30, Number(state.toolSettings?.maxTurns) || 10));
  let turn = 0;
  let currentAiMsg = initialAiMsg;

  // Refresh tools registry if servers configured
  if (state.toolSettings?.enabled && (state.config.mcpServers || []).some(s => s.enabled !== false && s.url)) {
    try {
      await toolRegistry.refreshTools();
    } catch (e) {
      console.warn("[Agent] Tool refresh error:", e);
    }
  }

  while (turn < maxTurns) {
    turn++;
    const res = await streamResponse(chat, currentAiMsg, modelId);
    
    // If aborted, errored, or no tool calls were requested, we are done
    if (!res || res.aborted || res.error || !res.toolCalls || !res.toolCalls.length) {
      break;
    }

    // Model called tools
    const toolCalls = res.toolCalls;
    streamPhase(chat.id, `⚙️ Executing tools (${toolCalls.length})...`);

    // Execute each tool call
    for (const tc of toolCalls) {
      const toolName = tc.function?.name || "unknown";
      let args = {};
      try {
        args = typeof tc.function?.arguments === "string" 
          ? JSON.parse(tc.function.arguments) 
          : (tc.function?.arguments || {});
      } catch (err) {
        console.warn(`[Agent] Failed to parse args for ${toolName}:`, err);
      }

      let toolOutput = "";
      try {
        const result = await toolRegistry.executeTool(toolName, args);
        // MCP results are typically { content: [{type:"text", text:"..."}] }
        if (result && Array.isArray(result.content)) {
          toolOutput = result.content.map(c => c.text || JSON.stringify(c)).join("\n");
        } else if (result) {
          toolOutput = typeof result === "string" ? result : JSON.stringify(result);
        } else {
          toolOutput = "(Success, empty response)";
        }
      } catch (err) {
        toolOutput = `Error executing tool "${toolName}": ${err.message}`;
      }

      // Append tool result message
      chat.messages.push({
        role: "tool",
        name: toolName,
        tool_call_id: tc.id,
        content: toolOutput,
        time: Date.now()
      });
      renderMessages();
    }

    // Create next assistant message placeholder for the model's follow-up turn
    currentAiMsg = {
      role: "assistant",
      content: "",
      reasoning: "",
      reasoningMs: 0,
      thought: false,
      time: Date.now()
    };
    chat.messages.push(currentAiMsg);
    saveState();
    renderMessages();
  }

  saveState();
  renderMessages();
}
