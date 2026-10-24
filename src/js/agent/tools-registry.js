/**
 * Tool Registry & Converter for AChat
 * Discovers tools across configured MCP servers and converts them into
 * OpenAI, Claude, and Gemini native schemas.
 */

const toolRegistry = {
  // In-memory cache of discovered tools: Map<string, { tool, client }>
  toolsMap: new Map(),

  /**
   * Refreshes tool definitions from all enabled MCP servers in state
   */
  async refreshTools(signal = null) {
    this.toolsMap.clear();
    const servers = (state.config && state.config.mcpServers) || [];
    const enabledServers = servers.filter(s => s.enabled !== false && s.url);

    const errors = [];
    for (const s of enabledServers) {
      try {
        const client = new McpClient(s);
        // Best-effort initialization handshake
        try { await client.initialize(signal); } catch (e) { /* ignore handshake reject if server is stateless POST */ }
        const tools = await client.listTools(signal);
        for (const t of tools) {
          this.toolsMap.set(t.name, { tool: t, client });
        }
      } catch (err) {
        console.warn(`[MCP] Failed to fetch tools from ${s.name || s.url}:`, err);
        errors.push({ server: s.name || s.url, error: err.message });
      }
    }
    return { count: this.toolsMap.size, errors };
  },

  /**
   * Get all loaded tools
   */
  getAllTools() {
    return Array.from(this.toolsMap.values()).map(x => x.tool);
  },

  /**
   * Check if any MCP tools are registered
   */
  hasTools() {
    return this.toolsMap.size > 0;
  },

  /**
   * Execute a tool by name with arguments
   */
  async executeTool(name, args, signal = null) {
    const entry = this.toolsMap.get(name);
    if (!entry) {
      throw new Error(`Tool "${name}" is not registered in any configured MCP server.`);
    }
    const result = await entry.client.callTool(name, args, signal);
    return result;
  },

  /**
   * Clean JSON schema recursively to be safe for LLM backends (Ollama/llama.cpp/OpenAI)
   */
  cleanSchema(schema) {
    if (!schema || typeof schema !== "object") {
      return { type: "object", properties: {} };
    }
    const clean = Array.isArray(schema) ? schema.map(item => this.cleanSchema(item)) : { ...schema };
    if (!Array.isArray(clean)) {
      delete clean["$schema"];
      delete clean["$id"];
      delete clean["title"];
      if (!clean.type && clean.properties) clean.type = "object";
      if (clean.type === "object" && !clean.properties) {
        clean.properties = {};
      }
      if (clean.properties && typeof clean.properties === "object") {
        const cleanProps = {};
        for (const [k, v] of Object.entries(clean.properties)) {
          cleanProps[k] = this.cleanSchema(v);
        }
        clean.properties = cleanProps;
      }
    }
    return clean;
  },

  /**
   * Format tools for OpenAI compatible and Ollama endpoints
   */
  formatForOpenAI() {
    const tools = this.getAllTools();
    if (!tools.length) return null;
    return tools.map(t => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: this.cleanSchema(t.inputSchema)
      }
    }));
  },

  /**
   * Format tools for Anthropic Claude endpoint
   */
  formatForClaude() {
    const tools = this.getAllTools();
    if (!tools.length) return null;
    return tools.map(t => ({
      name: t.name,
      description: t.description || "",
      input_schema: t.inputSchema || { type: "object", properties: {} }
    }));
  },

  /**
   * Format tools for Google Gemini endpoint
   */
  formatForGemini() {
    const tools = this.getAllTools();
    if (!tools.length) return null;
    return [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description || "",
        parameters: t.inputSchema || { type: "object", properties: {} }
      }))
    }];
  }
};
