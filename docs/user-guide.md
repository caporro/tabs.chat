# Using tabs.chat

[Project overview](../README.md) · [Link format](link-format.md) · [Browser access and CORS](browser-access.md)

## Agents and settings

Open **Settings** from the sidebar and select an agent. Each agent has its own providers, models, instructions, tools, welcome content and conversations.

New provider connections start with an empty model list. Use **Fetch model list** to load the models available from your provider, or **Add model** to enter a model ID manually.

| Section | What you configure |
| --- | --- |
| **AI services** | Provider connections, API keys and the models available in this agent. |
| **Instructions** | How the assistant should respond. |
| **Tools** | Built-in tools and external MCP servers. Compatible models can execute tools over multiple turns. |
| **Welcome screen** | A heading, description and suggested prompts for empty conversations. Clicking a suggestion fills the composer without sending it. |
| **Advanced** | Agent metadata, response inspection and additional controls. |

Changes save after a short pause and when leaving settings. The default user name, custom variables, author, description and configuration version travel with shared agents. Response inspection is enabled by default; disabling it removes the inspector button from that agent's messages.

Application-wide preferences and JSON backups are in the settings sidebar. **General** controls System, Light or Dark appearance. Advanced controls expose connection addresses, custom headers, local protocols, generation parameters, tool step limits and memory settings where applicable. The chat's **⋯** menu opens conversation instructions, memory, reasoning display and loaded tools.

**Thinking mode → Auto** leaves reasoning generation to the model/server without sending thinking controls. **On** and **Off** request an override where supported. **Show reasoning** in the conversation menu only shows or hides reasoning returned by the model; it does not change API requests, generation time or token usage. Hidden reasoning remains saved with the conversation and can be shown again.

**Temperature** is Auto when empty: no temperature is sent. Numeric values, including `0`, override the server default where supported. Existing saved numbers remain explicit; clear the field to select Auto. This choice survives backups and configuration links.

**Max output tokens** uses the provider's request field: `max_completion_tokens` for the official OpenAI endpoint, `max_tokens` for compatible endpoints and Claude, `maxOutputTokens` for Gemini, and `num_predict` for native Ollama. Compatible endpoints that explicitly reject one token-limit field get one retry with the alternative name, preserving the limit. An empty limit uses server defaults, except Claude's required `max_tokens`, which defaults to `4096`.

## Names and prompt variables

Set the agent name and **User name** in the agent’s overview. The name in **General → Your name** has priority when nonempty; otherwise the agent’s user name is used. Whitespace-only names count as empty. The same resolved names appear in messages and prompt variables.

Instructions can use `{{agent.name}}`, `{{user.name}}`, current date/time, model information and custom variables. Use **Insert variable** and **Resolved prompt preview** in Instructions. Custom variables are edited as JSON under **Custom variables**. Unknown placeholders are reported and block sending; invalid custom-variable JSON must be corrected before saving or leaving the editor. See [prompt variables](prompt-variables.md).

Conversations inherit the latest agent instructions. In **Instructions for this chat**, turn off **Use agent instructions** to create an explicit override. Re-enable the option to resume inheritance.

## Share a configuration

In Settings, use **Share** beside the agent name. Choose which providers, tools, instructions and welcome content to include, and optionally protect the link with a password.

Sharing exports configuration, not conversations or notes. API keys and custom headers are excluded unless credentials are explicitly included. Send a protected link's password separately. Without password protection, the encoded configuration is readable by anyone holding the link.

Opening an unencrypted link imports automatically; an encrypted link asks for its password first. Existing agents are retained. Reopening a matching configuration activates the existing agent rather than replacing it; increment its configuration version when sharing revisions. The link import removes the configuration parameters from the address bar when possible, but the original link still contains them.

The Share interface exports the selected agent. Links can also import multiple agents; use the [link format reference](link-format.md) to generate these configurations, including from an AI agent. Use JSON backups for a full application archive.

## Chat, notes and search

**Chat** and **Notepad** are workspace modes. In Notepad, select a note from the sidebar and edit it on the right; edits save automatically.

Notes form one shared archive, with optional links to agents. Filter the sidebar to all notes, the current agent or unlinked notes. Deleting an agent keeps its notes and removes their agent association. AI note tools can access general notes and notes linked to the active agent.

Type **@** in the composer to attach a note's Markdown to a message. The attachment is a snapshot: later note edits do not change previous messages.

The magnifying glass beside the logo searches chat titles/messages and note titles/content across agents, with All, Chats and Notes filters.

## Attachments and rendering

Both editions accept images and text/code files by upload, drag-and-drop or clipboard paste. Image quality controls can downscale images to reduce vision input tokens; the selected model must support images.

Normal also renders Mermaid diagrams and KaTeX formulas and extracts text from PDF/DOCX files. PDF extraction does not perform OCR on scanned images. Lite displays diagrams/formulas as text and skips PDF/DOCX and binary files with a message. Previously extracted attachment text in saved conversations remains usable in Lite.

## Memory, tools and inspection

Conversation instructions and automatic memory summarization help carry context through longer chats. Review the current memory from the conversation menu. AI requests, including summarization, use your configured provider.

With tools enabled, compatible models can call built-in tools or connected MCP servers and continue for multiple turns. Requested tools execute automatically; the `autoApprove` configuration field does not enforce an approval prompt. See [MCP compatibility](browser-access.md#mcp-compatibility) before relying on a particular server.

If a model explicitly rejects tool support before producing output, the app retries that reply once without tools and displays a notice. The agent's tool settings stay enabled. Invalid tool schemas remain errors. Conversations that already contain tool calls require a model with tool support or a new chat; their tool history is never silently removed.

The call inspector shows request/response details, token usage and timing for a response. Its availability is controlled per agent under Advanced.

## Storage and backups

The app saves settings, keys, chats and notes in browser localStorage. Saved keys are not encrypted. Storage belongs to the current browser profile and origin; switching host, port or browser does not transfer it. Use JSON export/import to move or back up your data. Backups containing credentials must be treated as credentials.

An ephemeral agent is excluded, along with its chats, from ordinary localStorage saves. It has no expiry or access-control mechanism. The shared note archive is saved independently.

Both editions use the same configuration, link and backup formats. Keep the HTML file to run the application and export JSON to preserve your own data; copying the HTML alone does not copy browser storage.
