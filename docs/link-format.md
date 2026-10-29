# tabs.chat link format

Reference for AI agents generating links. Applies to both Normal and Lite editions.

## Choose a format

| URL | Use |
| --- | --- |
| `https://tabs.chat/#config=PAYLOAD` | Recommended: one or more agents, providers, MCP servers and prompts. |
| `https://tabs.chat/#provider=TYPE&…` | Short form: one provider and optionally one MCP server. |
| `https://tabs.chat/#enc=PAYLOAD` | Password-encrypted configuration. |

Replace `https://tabs.chat/` with the actual hosted app URL or the absolute URL of a standalone HTML file. Keep its pathname. Use one format per link and put configuration after `#`.

## Full configuration: `#config=`

`PAYLOAD = Base64URL(UTF8(JSON.stringify(bundle)))`, without `=` padding. No compression, double encoding or URL encoding of the JSON before Base64URL.

Minimal example; the recipient supplies their API key in Settings:

```json
{
  "v": 1,
  "agents": [
    {
      "name": "Writing assistant",
      "version": "1.0.0",
      "userName": "Customer",
      "variables": { "company": "Acme" },
      "systemPrompt": "You are {{agent.name}}. Help {{user.name}} write clear, concise text for {{vars.company}}.",
      "config": {
        "providers": [
          {
            "type": "openai",
            "base": "https://api.openai.com/v1",
            "models": "gpt-4o"
          }
        ]
      }
    }
  ]
}
```

Use this self-contained JavaScript function in a browser console or Node.js 22+ (`.mjs`). It returns the complete URL. `password` is optional; omitting it generates an unencrypted `#config=` link. `bundle` is the configuration object above.

```js
async function createAgentLink(bundle, { appUrl = "https://tabs.chat/", password } = {}) {
  if (!bundle || bundle.v !== 1 || !Array.isArray(bundle.agents) || !bundle.agents.length) {
    throw new TypeError("bundle must have v:1 and a nonempty agents array");
  }
  const utf8 = text => new TextEncoder().encode(text);
  const base64 = bytes => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const base64url = text => base64(utf8(text))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  let payload = JSON.stringify(bundle);
  let format = "config";

  if (password !== undefined) {
    if (typeof password !== "string" || !password || password !== password.trim()) {
      throw new TypeError("password must be nonempty, without leading/trailing whitespace");
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey(
      "raw", utf8(password), "PBKDF2", false, ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
    );
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 }, key, utf8(payload)
    );
    payload = JSON.stringify({
      v: 1, s: base64(salt), iv: base64(iv), ct: base64(new Uint8Array(ct))
    });
    format = "enc";
  }

  const app = new URL(appUrl);
  app.search = "";
  app.hash = format + "=" + base64url(payload);
  return app.href;
}
```

Example usage; replace the example password with a unique passphrase and send it separately:

```js
console.log(await createAgentLink(bundle, {
  appUrl: "https://tabs.chat/", // Set this to your deployment or standalone HTML URL.
  password: "replace-with-a-unique-passphrase"
})); // #enc=...
```

Bundle fields:

| Field | Type / behavior |
| --- | --- |
| `v` | Number `1`; configuration format marker. |
| `agents` | Nonempty array of agent objects, including when sharing a single agent. |
| `activeAgent` | Optional agent name to activate; defaults to the first imported agent. Use unique names. |

Agent fields are optional. Set `name` and configure a provider with explicit model IDs for a usable chat:

| Field | Type / behavior |
| --- | --- |
| `name` | String; agent name, used in messages and `{{agent.name}}`. |
| `userName` | String; default user name. A nonempty global user profile overrides it. The recipient’s profile is resolved locally. |
| `variables` | Object of named text/number/boolean values; e.g. `{"company":"Acme"}` supplies `{{vars.company}}`. Values are shared with the agent. |
| `version` | String; defaults to `"1.0.0"`. Increment when changing a previously shared configuration. |
| `author`, `description` | Strings; agent metadata. |
| `ephemeral` | Boolean, default `false`. `true` excludes this agent and its chats from normal localStorage saves; it does not set an expiry. |
| `systemPrompt` | String; when omitted, the app uses its default assistant prompt. An empty string provides no agent instructions. |
| `temperature` | Number or `null`. Omitted, `null` or empty means Auto (server default); explicit `0` is preserved. |
| `welcomeTitle`, `welcomeDesc` | Strings; welcome screen heading and description. |
| `welcomePrompts` | Array of `{ "label": "…", "desc": "…", "text": "…" }`. `desc` is optional; clicking a button fills the composer without sending. |
| `chatTitle` | String; title of the first chat. |
| `initialPrompt` | String; added as the first user message in a newly created agent. **Does not call the model.** It hides the empty-chat welcome screen. |
| `config.providers` | Array of provider objects, described below. Defaults to `[]`. |
| `config.mcpServers` | Array of MCP server objects, described below. Defaults to `[]`. |
| `config.agent` | Optional object: `enabled` (boolean, default `true`), `maxTurns` (integer `1`–`30`, default `10`), `builtInTools` (booleans `datetime`, `web_fetch`, `calculator`, `notepad`, each default `true`). MCP tools require an LLM with tool calling enabled. |
| `config.inspectionEnabled` | Boolean, default `true`; request inspector availability. |

Keep settings inside each agent. Do not include internal IDs, signatures or conversation history. Omit fields you do not need.

Provider objects in `config.providers`:

| Field | Type / behavior |
| --- | --- |
| `type` | `openai`, `claude`, `gemini`, `ollama`, `groq`, `openrouter`, `deepseek`, `mistral`, `xai`, `lmstudio` or `llamacpp`. Use `openai` for a custom OpenAI-compatible API; Anthropic's type is `claude`. |
| `base` | String; API base URL, e.g. `https://api.openai.com/v1`. Do not append `/chat/completions`. Ollama's native base is `http://localhost:11434`. Omission uses the app's default for the type. |
| `models` | **String, not an array.** Newline-separated model IDs; optionally `id\|Display name` per line. Put the desired initial model first in the first provider. Use the endpoint's actual model IDs. Omitted or empty means no models configured. |
| `name` | Optional display name. |
| `key` | Optional API key string. Omit when the recipient must supply it. |
| `headers` | Optional object of string header names and values. |
| `enabled` | Boolean, default `true`. |
| `protocol` | Local providers only: `auto` (default), `ollama` or `openai`. |
| `proxy` | Optional proxy object, below. |

MCP server objects in `config.mcpServers`:

| Field | Type / behavior |
| --- | --- |
| `url` | Required HTTP(S) MCP endpoint; no `stdio` command. |
| `name` | Optional display name, default `"Custom MCP"`. |
| `apiKey` | Optional bearer token string. Use `apiKey` here, not provider field `key`. |
| `headers` | Optional object for custom headers, e.g. `{"x-owner-id":"…"}`. |
| `enabled` | Boolean, default `true`. |
| `proxy` | Optional object: `{"enabled":true,"url":"https://proxy.example/?url={encodedUrl}"}`. Same shape for providers. `{encodedUrl}` substitutes the percent-encoded target; `{url}` substitutes the raw target. With neither placeholder, the target is appended. |

A link configures browser connections; it cannot grant CORS permission or guarantee MCP server compatibility. Only include a proxy explicitly chosen by the user: it receives the forwarded headers and request body, including credentials.

## Short form: `#provider=`

```text
https://tabs.chat/#provider=openai&agent=Writing%20assistant&model=gpt-4o&system=Help%20me%20write%20clearly.
```

Build the fragment with `new URLSearchParams(values).toString()` or percent-encode each value. Literal `+`, `&`, `#`, `=` and newlines must be encoded; spaces may use `%20` or `+`. Do not encode the whole fragment as one value.

| Parameter | Equivalent in full configuration |
| --- | --- |
| `provider` | Optional provider `type`; include it when defining a provider. |
| `agent`, `author`, `ver` | Agent `name`, `author`, `version`. |
| `user` | Agent’s default `userName`, not the global profile. |
| `name`, `base`, `key` | Provider `name`, `base`, `key`. |
| `model` or `models` | Provider `models` string; same newline / `id\|Label` format. |
| `system` | Agent `systemPrompt`. |
| `temp` | Agent `temperature`, converted to a number; an empty value selects Auto. |
| `title`, `desc` | Agent `welcomeTitle`, `welcomeDesc`. |
| `prompts` | Welcome buttons: newline-separated `Label\|Text` or `Label\|Description\|Text`. A JSON-encoded button array is also accepted. |
| `q` | Agent `initialPrompt`; no automatic model request. |
| `ephemeral` | `1` or `true` enables ephemeral mode. |
| `mcp`, `mcp_name`, `mcp_key` | One MCP server's `url`, `name`, `apiKey`. |

Use `#config=` for custom headers, proxies, agent settings, MCP-only configurations or multiple providers/agents. Include `provider` or `agent` in this fragment form. A fragment containing only `#system=…` or `#mcp=…` is ignored. Do not mix short-form parameters with `config` or `enc`: only that payload is used.

## Password encryption: `#enc=`

Use `createAgentLink(bundle, { password: "…" })` above. The app asks for the password, then imports automatically. Send the password separately. Passwords must be nonempty with no leading/trailing whitespace, because the app trims it. Browser encryption and decryption require Web Crypto.

<details>
<summary>Encryption format for other implementations</summary>

Encrypt the **same UTF-8 bundle JSON** as follows:

1. Generate a fresh 16-byte random salt and 12-byte random IV for every link.
2. Derive a 256-bit key with PBKDF2-HMAC-SHA-256, 100,000 iterations, UTF-8 password bytes and that salt.
3. Encrypt using AES-256-GCM, the IV, no additional authenticated data, and a 128-bit authentication tag. `ct` is ciphertext followed by the 16-byte tag.
4. Create `{"v":1,"s":"BASE64_SALT","iv":"BASE64_IV","ct":"BASE64_CIPHERTEXT_AND_TAG"}`. These three byte fields use **standard Base64**, including padding.
5. Base64URL-encode the UTF-8 envelope JSON, without padding; append as `#enc=PAYLOAD`.

</details>

## Import behavior and generation rules

- Plain links import automatically on startup. The app attempts to remove the fragment and query from the address bar; this does not revoke the original link. Existing agents are retained.
- Reopening a link may activate an existing matching agent instead of creating or updating it. Matching excludes some settings, including welcome content, temperature, agent settings and custom headers. **Increment `version` for configuration revisions.** `initialPrompt` is not added again to a reused agent.
- Use the fragment, not `?config=`. Query-string imports are accepted as a fallback but reach the hosting server. When the fragment contains `provider`, `agent`, `config` or `enc`, query parameters are ignored. Precedence within the selected parameters is `enc` → `config` → short form.
- Base64URL is readable encoding. Anyone holding an unencrypted link can read keys and headers inside it. Include credentials only when the user explicitly wants to share them; otherwise omit them. Never invent keys, endpoints or model IDs.
- Use the exact documented names and JSON types. `autoApprove` is not an enforced tool-approval setting.
- Validate by decoding the generated payload and comparing it with the intended JSON. Keep links small; there is no universal URL-length limit across browsers and sharing channels.

Configuration links use `v:1`, `agents` and `activeAgent`. Full application backups use `schemaVersion:1`, `agents` and `activeAgentId`; note associations use `agentId`. Backups include conversations, notes and the local profile; configuration links do not.

Prompt templates support the allowlisted variables in [prompt variables and environment](prompt-variables.md). Keep placeholders in shared JSON; the app resolves them at request time.

Implementation reference: [config-share.js](../src/js/config-share.js), [state.js](../src/js/state.js), [provider-helpers.js](../src/js/provider-helpers.js), [persistence.js](../src/js/persistence.js).
