/**
 * Tool Registry & Converter for tabs.chat
 * Discovers tools across configured MCP servers and built-in native tools,
 * converting them into OpenAI, Claude, and Gemini native schemas.
 */

const BUILT_IN_TOOLS = [
  {
    id: "datetime",
    tool: {
      name: "get_current_datetime",
      description: "Get the current real-world date, time, day of the week, and local timezone.",
      inputSchema: { type: "object", properties: {} }
    },
    handler: async () => {
      const d = new Date();
      return JSON.stringify({
        iso: d.toISOString(),
        local: d.toLocaleString(),
        date: d.toLocaleDateString(),
        time: d.toLocaleTimeString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dayOfWeek: d.toLocaleDateString(undefined, { weekday: "long" })
      }, null, 2);
    }
  },
  {
    id: "web_fetch",
    tool: {
      name: "web_fetch",
      description: "Fetch and read the extracted text and markdown content of any public web page URL.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full HTTP or HTTPS URL to read" }
        },
        required: ["url"]
      }
    },
    handler: async (args) => {
      const rawUrl = (args && args.url ? String(args.url).trim() : "");
      if(!rawUrl || !/^https?:\/\//i.test(rawUrl)){
        throw new Error("Invalid URL: must start with http:// or https://");
      }
      const readerUrl = `https://r.jina.ai/${encodeURI(rawUrl)}`;
      const res = await fetch(readerUrl, {
        headers: { "Accept": "text/plain" }
      });
      if(!res.ok){
        throw new Error(`Failed to fetch web page: HTTP ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      return text.slice(0, 15000) + (text.length > 15000 ? "\n\n...(content truncated to 15,000 characters)" : "");
    }
  },
  {
    id: "calculator",
    tool: {
      name: "calculator",
      description: "Safely evaluate mathematical calculations, arithmetic expressions, powers, square roots, and basic stats.",
      inputSchema: {
        type: "object",
        properties: {
          expression: { type: "string", description: "The mathematical expression to evaluate, e.g. '(1250 * 1.22) + sqrt(144)' or '2^12'" }
        },
        required: ["expression"]
      }
    },
    handler: async (args) => {
      const raw = (args && args.expression ? String(args.expression) : "").trim();
      if(!raw) throw new Error("Missing mathematical expression.");
      const safe = raw
        .replace(/\^/g, "**")
        .replace(/\bsqrt\b/gi, "Math.sqrt")
        .replace(/\babs\b/gi, "Math.abs")
        .replace(/\bround\b/gi, "Math.round")
        .replace(/\bfloor\b/gi, "Math.floor")
        .replace(/\bceil\b/gi, "Math.ceil")
        .replace(/\blog\b/gi, "Math.log10")
        .replace(/\bln\b/gi, "Math.log")
        .replace(/\bsin\b/gi, "Math.sin")
        .replace(/\bcos\b/gi, "Math.cos")
        .replace(/\btan\b/gi, "Math.tan")
        .replace(/\bpi\b/gi, "Math.PI")
        .replace(/\be\b/gi, "Math.E");
      if(!/^[0-9+\-*/().,%\sMath.PIEa-z]+$/.test(safe) || /window|document|fetch|eval|Function|import|require|process/i.test(safe)){
        throw new Error("Expression contains unsupported or unsafe characters.");
      }
      try {
        const fn = new Function(`"use strict"; return (${safe});`);
        const result = fn();
        return JSON.stringify({ expression: raw, result });
      } catch(err) {
        throw new Error(`Calculation error: ${err.message}`);
      }
    }
  },
  {
    id: "notepad",
    tool: {
      name: "tab_notes",
      description: "Read general notes and notes linked to the active agent. New notes are linked to the active agent.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list_notes", "read_note", "add_note", "search_notes"],
            description: "The action to perform: 'list_notes' (overview of all notes), 'read_note' (fetch full content of a note by id or title), 'add_note' (save a new note into this agent), 'search_notes' (filter notes by keyword)"
          },
          note_id: { type: "string", description: "ID of the note to read (for read_note)" },
          title: { type: "string", description: "Title of the note (for add_note or read_note)" },
          content: { type: "string", description: "Content body of the note (for add_note)" },
          query: { type: "string", description: "Search query or keyword (for search_notes)" }
        },
        required: ["action"]
      }
    },
    handler: async (args) => {
      const act = args?.action;
      const agent = (typeof getCurrentAgent === "function") ? getCurrentAgent() : null;
      const notes = notesForAgent(agent?.id);

      if(act === "list_notes"){
        return JSON.stringify(notes.map(n => ({
          id: n.id,
          title: n.title || "(Untitled)",
          time: n.time,
          preview: (n.body || "").slice(0, 100)
        })), null, 2);
      }
      if(act === "read_note"){
        const id = args.note_id;
        const title = (args.title || "").trim().toLowerCase();
        const found = notes.find(n => (id && n.id === id) || (title && (n.title || "").toLowerCase() === title));
        if(!found) throw new Error(`Note not found (id: "${id || ''}", title: "${args.title || ''}")`);
        return JSON.stringify(found, null, 2);
      }
      if(act === "search_notes"){
        const q = (args.query || "").trim().toLowerCase();
        if(!q) return JSON.stringify(notes, null, 2);
        const matches = notes.filter(n =>
          (n.title || "").toLowerCase().includes(q) || (n.body || "").toLowerCase().includes(q)
        );
        return JSON.stringify(matches, null, 2);
      }
      if(act === "add_note"){
        const title = (args.title || "Note").trim();
        const body = (args.content || "").trim();
        const note = addNote({ title, body, src: "Agent", agentId: agent?.id || null });
        return `Successfully added note "${title}" (ID: ${note.id}) to the agent knowledge base.`;
      }
      throw new Error(`Unknown notes action: ${act}`);
    }
  }
];

const toolRegistry = {
  // In-memory cache of discovered tools: Map<string, { tool, client }>
  toolsMap: new Map(),

  /**
   * Returns active built-in tools based on state.toolSettings.builtInTools
   */
  getActiveBuiltInTools() {
    const cfg = state.toolSettings?.builtInTools || {};
    return BUILT_IN_TOOLS.filter(b => cfg[b.id] !== false);
  },

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
    return { count: this.getAllTools().length, errors };
  },

  /**
   * Get all loaded tools (built-in + MCP)
   */
  getAllTools() {
    const builtIn = this.getActiveBuiltInTools().map(b => b.tool);
    const mcp = Array.from(this.toolsMap.values()).map(x => x.tool);
    return [...builtIn, ...mcp];
  },

  /**
   * Check if any tools are registered
   */
  hasTools() {
    return this.getAllTools().length > 0;
  },

  /**
   * Execute a tool by name with arguments
   */
  async executeTool(name, args, signal = null) {
    // Check built-in tools first
    const builtIn = BUILT_IN_TOOLS.find(b => b.tool.name === name);
    if (builtIn) {
      return await builtIn.handler(args);
    }

    // Check MCP tools
    const entry = this.toolsMap.get(name);
    if (!entry) {
      throw new Error(`Tool "${name}" is not registered in built-in tools or any configured MCP server.`);
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
      functionDeclarations: tools.map(t => {
        const schema = t.inputSchema;
        const noParameters = !schema || (schema.type === "object" && !Object.keys(schema.properties || {}).length && !schema.required?.length && Object.keys(schema).every(key => ["type", "properties", "required"].includes(key)));
        return {
          name: t.name,
          description: t.description || "",
          ...(!noParameters ? { parameters: schema } : {})
        };
      })
    }];
  }
};
