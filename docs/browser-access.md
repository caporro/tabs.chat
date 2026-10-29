# Browser access, CORS and MCP

[Project overview](../README.md) · [User guide](user-guide.md) · [Link format](link-format.md)

## Direct connections

Provider and MCP requests originate in the browser. Whether a response is readable depends on the endpoint, request headers, origin, certificates and network conditions. Serving tabs.chat yourself does not grant permission to read another server's responses.

Each provider and MCP server shows an access status in Settings. Loading models, discovering tools or receiving a chat response records an observation:

| Status | Meaning |
| --- | --- |
| Browser access expected | A known provider endpoint; this connection has not yet been verified. |
| Server CORS configurable | A local service whose allowed origins may need configuration. |
| Access not verified | No current observation for this connection. |
| Direct/proxy access verified | The browser could read a response. HTTP authentication errors are reported separately. |
| Access needs checking | A request failed; possible causes include CORS, network, certificate or proxy problems. |
| Check proxy settings | The proxy configuration is invalid; no direct fallback is attempted. |

A readable HTTP 401 or 403 verifies browser access, not successful authentication or a working model/tool call. Observations stay in memory, are invalidated when connection settings change, and are excluded from saved/shared configurations.

For local Ollama with the app served at `http://localhost:3000`, allow that origin when starting the server:

```sh
OLLAMA_ORIGINS="http://localhost:3000" ollama serve
```

Use the actual app origin in your server's allowlist; add `https://tabs.chat` when connecting from that deployment. LM Studio, llama.cpp and custom gateways have their own server-side CORS settings. Local HTTP preview instructions are in [development](development.md#local-preview).

## Optional proxy

Under a connection's **Advanced connection settings**, enable **Use CORS proxy** and enter a proxy URL. This applies only to that provider or MCP server. It is off by default, and a failed proxy request never retries directly or switches to another relay.

| Template | Substitution |
| --- | --- |
| `https://your-relay.example/?url={encodedUrl}` | Percent-encoded destination URL. |
| `https://your-relay.example/{url}` | Raw destination URL. |
| A URL prefix with neither placeholder | Destination appended to the prefix. |

Use an HTTP(S) URL without embedded username/password or a fragment. The proxy receives the forwarded request headers and body, including credentials and conversation content. It must permit browser access and preserve response streaming and headers required by the target protocol. tabs.chat does not include or deploy a public relay.

Proxy settings travel with shared configurations. Unless credentials are explicitly included, common proxy-key query parameters are replaced with a placeholder. This is a limited redaction rule; check custom URLs before sharing them.

## MCP compatibility

The current client sends JSON-RPC requests by HTTP POST and reads JSON or SSE responses. Configure a reachable HTTP(S) endpoint under Tools. `apiKey` supplies a bearer token; custom headers support additional server-specific requirements. A local `stdio` command cannot be run from the browser.

MCP servers supply tools to the selected LLM; this is not a direct remote-agent chat mode. The model must support tool calling, and tools must be enabled for the agent.

Current protocol limits:

- MCP session IDs and initialized notifications are not fully handled.
- Tool-list pagination is not implemented.
- Direct remote-agent chat is not implemented.

A successful browser access check does not establish full MCP compatibility. A CORS proxy changes transport routing; it does not implement missing client protocol behavior.

## Privacy boundaries

There is no tabs.chat application backend or tracking. Configured providers, MCP servers and optional proxies receive the requests directed to them. Browser localStorage saves keys without application-level encryption; password-protected links encrypt only their own payload.

Use the [link reference](link-format.md) for credential inclusion and encryption, and the [user guide](user-guide.md#storage-and-backups) for local data and backups.
