/**
 * AChat Lightweight MCP Client (Browser-compatible)
 * Implements JSON-RPC 2.0 communication over HTTP / SSE endpoints.
 */

class McpClient {
  constructor(serverConfig) {
    this.id = serverConfig.id;
    this.name = serverConfig.name || "MCP Server";
    this.url = (serverConfig.url || "").trim().replace(/\/+$/, "");
    this.apiKey = (serverConfig.apiKey || "").trim();
    this.headers = serverConfig.headers || {};
    this.requestId = 1;
  }

  getHeaders() {
    const h = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream"
    };
    if (this.apiKey) {
      h["Authorization"] = this.apiKey.toLowerCase().startsWith("bearer ")
        ? this.apiKey
        : `Bearer ${this.apiKey}`;
    }
    if (typeof this.headers === "object") {
      Object.assign(h, this.headers);
    }
    return h;
  }

  /**
   * Parse a single SSE block (separated by double newlines)
   */
  parseSseBlock(block, reqId) {
    if (!block || !block.trim()) return null;
    const lines = block.split(/\r?\n/);
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (!dataLines.length) return null;
    const payload = dataLines.join("\n");
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === "object") {
        if (reqId === undefined || parsed.id === reqId || parsed.result !== undefined || parsed.error !== undefined) {
          return parsed;
        }
      }
    } catch {}
    return null;
  }

  /**
   * Parse raw text as JSON or SSE frames
   */
  parseRawOrSse(rawText, reqId) {
    const trimmed = rawText.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        return JSON.parse(trimmed);
      } catch {}
    }

    const blocks = rawText.split(/\r?\n\r?\n/);
    for (const b of blocks) {
      const parsed = this.parseSseBlock(b, reqId);
      if (parsed) return parsed;
    }

    // Fallback: search for first valid JSON object containing result or error
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }

    throw new Error(`Unable to parse MCP response: ${rawText.slice(0, 120)}...`);
  }

  /**
   * Parse HTTP response supporting direct JSON and Streamable HTTP / SSE
   */
  async parseResponse(res, reqId) {
    const contentType = (res.headers.get("content-type") || "").toLowerCase();

    // 1. Direct JSON response
    if (contentType.includes("application/json")) {
      try {
        return await res.json();
      } catch (e) {
        // Fall back to text if body had unexpected format
      }
    }

    // 2. Streamable HTTP / SSE with ReadableStream reader
    if (contentType.includes("text/event-stream") && res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (value) {
            buffer += decoder.decode(value, { stream: !done });
          }

          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || "";

          for (const block of blocks) {
            const parsed = this.parseSseBlock(block, reqId);
            if (parsed) {
              try { await reader.cancel(); } catch {}
              return parsed;
            }
          }

          if (done) break;
        }

        if (buffer.trim()) {
          const parsed = this.parseSseBlock(buffer, reqId);
          if (parsed) return parsed;
        }
      } catch (err) {
        console.warn("[MCP] Stream reader error, falling back to full text:", err);
      }
    }

    // 3. Fallback: read full response text and parse
    const rawText = await res.text();
    return this.parseRawOrSse(rawText, reqId);
  }

  /**
   * Send a JSON-RPC 2.0 request via HTTP POST
   */
  async jsonRpc(method, params = {}, signal = null) {
    if (!this.url) throw new Error(`MCP Server [${this.name}] has no endpoint URL configured.`);
    
    const reqId = this.requestId++;
    const payload = {
      jsonrpc: "2.0",
      id: reqId,
      method,
      params
    };

    const res = await fetch(this.url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      let errText = "";
      try { errText = await res.text(); } catch {}
      throw new Error(`MCP Error ${res.status} (${res.statusText}): ${errText}`);
    }

    const data = await this.parseResponse(res, reqId);
    if (data.error) {
      const msg = data.error.message || JSON.stringify(data.error);
      throw new Error(`MCP Server error: ${msg}`);
    }

    return data.result;
  }

  /**
   * Handshake: initialize
   */
  async initialize(signal = null) {
    return await this.jsonRpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "AChat",
        version: "1.0.0"
      }
    }, signal);
  }

  /**
   * List available tools: tools/list
   */
  async listTools(signal = null) {
    const res = await this.jsonRpc("tools/list", {}, signal);
    const tools = (res && res.tools) || [];
    return tools.map(tool => ({
      ...tool,
      _serverId: this.id,
      _serverName: this.name
    }));
  }

  /**
   * Call tool: tools/call
   */
  async callTool(name, args = {}, signal = null) {
    const res = await this.jsonRpc("tools/call", {
      name,
      arguments: args
    }, signal);
    return res;
  }
}
