/* Browser access observations stay in memory: they are not portable configuration. */
const connectionAccessObservations = new WeakMap();
const connectionRecordedTargets = new WeakMap();

function normalizeConnectionProxy(proxy){
  return { enabled: proxy?.enabled === true, url: typeof proxy?.url === "string" ? proxy.url.trim() : "" };
}

function connectionAccessFingerprint(connection){
  connection = connection || {};
  return JSON.stringify([
    connection.type || "mcp", connection.base || connection.url || "",
    connection.key || connection.apiKey || "", parseCustomHeaders(connection.headers),
    normalizeConnectionProxy(connection.proxy)
  ]);
}

function connectionRequestUrl(connection, target){
  const proxy = normalizeConnectionProxy(connection?.proxy);
  if(!proxy.enabled) return target;
  const fail = message => { const error = new Error(message); error.name = "ConnectionConfigurationError"; throw error; };
  if(!proxy.url) return fail("Enter a proxy URL in Advanced connection settings, or turn off Use CORS proxy.");
  const wrapped = proxy.url.includes("{url}") || proxy.url.includes("{encodedUrl}")
    ? proxy.url.replaceAll("{encodedUrl}", encodeURIComponent(target)).replaceAll("{url}", target)
    : proxy.url + target;
  let url;
  try { url = new URL(wrapped); } catch { return fail("The proxy URL is not a valid HTTP or HTTPS address."); }
  if(!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash){
    return fail("Use an HTTP or HTTPS proxy URL without embedded credentials or a fragment.");
  }
  return url.href;
}

async function connectionFetch(connection, target, options = {}, rawCall = null){
  if(!connection) return fetch(target, options);
  const fingerprint = connectionAccessFingerprint(connection);
  const proxy = normalizeConnectionProxy(connection.proxy);
  const observe = result => {
    // Do not let a request for an old configuration verify the edited connection.
    if(connectionAccessFingerprint(connection) !== fingerprint) return;
    connectionAccessObservations.set(connection, { ...result, fingerprint, viaProxy: proxy.enabled });
    refreshConnectionAccessIndicators();
  };
  try {
    const url = connectionRequestUrl(connection, target);
    if(proxy.enabled && rawCall?.request?.url){
      if(!connectionRecordedTargets.has(rawCall)) connectionRecordedTargets.set(rawCall, rawCall.request.url);
      rawCall.request.url = connectionRequestUrl(connection, connectionRecordedTargets.get(rawCall));
    }
    // A failed proxy request never retries directly or switches to another proxy.
    const response = await fetch(url, proxy.enabled
      ? { ...options, credentials: "omit", redirect: "error" }
      : options);
    if(response.type === "opaque" || response.type === "opaqueredirect") throw new TypeError("The response cannot be read by this browser.");
    observe({ reachable: true, status: response.status });
    return response;
  } catch(error){
    if(error.name !== "AbortError" && !options.signal?.aborted){
      observe({ reachable: false, configurationError: error.name === "ConnectionConfigurationError" });
    }
    throw error;
  }
}

function connectionAccessInfo(connection, kind = "provider"){
  connection = connection || {};
  const proxy = normalizeConnectionProxy(connection?.proxy);
  const observed = connection && connectionAccessObservations.get(connection);
  if(observed?.fingerprint === connectionAccessFingerprint(connection)){
    if(observed.reachable){
      let hint = "Verified by a response from this endpoint.";
      if(observed.status === 401) hint = "Browser access works. Authentication failed (HTTP 401); check the access key.";
      else if(observed.status === 403) hint = "Browser access works. The service denied access (HTTP 403); check credentials and permissions.";
      else if(observed.status >= 400) hint = `Browser access works. The service returned HTTP ${observed.status}.`;
      return { state: "verified", label: observed.viaProxy ? "Proxy access verified" : "Direct access verified", hint, issue: observed.status >= 400 };
    }
    if(observed.configurationError) return { state: "attention", label: "Check proxy settings", hint: "Enter a valid proxy URL, or turn off Use CORS proxy. No direct fallback is used." };
    return { state: "attention", label: "Access needs checking", hint: "The browser could not read a response. Possible causes include CORS, network, certificate or proxy problems." };
  }
  if(proxy.enabled) return { state: "unknown", label: "Proxy access not verified", hint: "Load models or discover tools to check the configured proxy connection." };
  let url;
  try { url = new URL(connection?.base || connection?.url || ""); } catch {}
  if(kind === "provider"){
    const local = isLocalProviderType(connection?.type) || (url && /^(localhost|127\.|0\.0\.0\.0$|\[::1\]$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname));
    if(local){
      const hints = {
        ollama: "Allow this site's origin with OLLAMA_ORIGINS on your Ollama server.",
        lmstudio: "Enable CORS in LM Studio server settings, or start it with lms server start --cors.",
        llamacpp: "Allow this site's origin using llama.cpp server CORS settings (--cors-origins)."
      };
      return { state: "configurable", label: "Server CORS configurable", hint: hints[connection?.type] || "Allow this site's origin in your server or gateway CORS settings." };
    }
    const supported = ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "api.groq.com", "openrouter.ai", "api.deepseek.com", "api.mistral.ai", "api.together.ai", "api.fireworks.ai", "api.moonshot.ai"];
    if(url?.protocol === "https:" && supported.includes(url.hostname) && !url.port){
      return { state: "expected", label: "Browser access expected", hint: "This provider's public API supports browser access. Load models to verify this connection." };
    }
  }
  return { state: "unknown", label: "Access not verified", hint: kind === "mcp" ? "Discover tools to check browser access to this server." : "Load models to check browser access to this endpoint." };
}

function connectionAccessMarkup(connection, kind = "provider"){
  return `<div class="connection-access" role="status" aria-live="polite" data-connection-access="${kind}" data-connection-id="${escapeHtml(connection?.id || "")}"></div>`;
}

function refreshConnectionAccessIndicators(){
  if(typeof document === "undefined" || typeof state === "undefined") return;
  document.querySelectorAll("[data-connection-access]").forEach(element => {
    const kind = element.dataset.connectionAccess;
    const id = element.hasAttribute("data-connection-modal") ? document.getElementById("pm_id")?.value : element.dataset.connectionId;
    const agent = (state.agents || []).find(item => item.id === state.activeAgentId);
    const list = kind === "mcp" ? agent?.config?.mcpServers || [] : agent?.config?.providers || [];
    const connection = list.find(item => item.id === id);
    if(!connection){ element.textContent = ""; return; }
    const info = connectionAccessInfo(connection, kind);
    element.classList.toggle("has-issue", !!info.issue || info.state === "attention");
    const badge = document.createElement("span");
    badge.className = "connection-access-badge " + info.state;
    badge.textContent = info.label;
    const hint = document.createElement("span");
    hint.className = "hint connection-access-hint";
    hint.textContent = info.hint;
    element.replaceChildren(badge, hint);
  });
}

function connectionProxyMarkup(connection){
  const proxy = normalizeConnectionProxy(connection?.proxy);
  return `<div class="form-row connection-proxy">
    <label class="connection-proxy-toggle"><input type="checkbox" class="connection-proxy-enabled"${proxy.enabled ? " checked" : ""}> Use CORS proxy</label>
    <div class="connection-proxy-fields${proxy.enabled ? "" : " hide"}">
      <label>Proxy URL <input type="text" class="connection-proxy-url" value="${escapeHtml(proxy.url)}" placeholder="https://proxy.example.com/{encodedUrl}" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <span class="hint">Use {url} for the full endpoint, or {encodedUrl} for a URL-encoded endpoint. A plain prefix also works.</span>
      <span class="hint connection-proxy-recipient"></span>
    </div>
  </div>`;
}

function readConnectionProxy(container){
  return normalizeConnectionProxy({ enabled: container?.querySelector(".connection-proxy-enabled")?.checked, url: container?.querySelector(".connection-proxy-url")?.value });
}

function setConnectionProxy(connection, proxy){
  const normalized = normalizeConnectionProxy(proxy);
  if(normalized.enabled || normalized.url) connection.proxy = normalized;
  else delete connection.proxy;
}

function exportConnectionProxy(connection, includeCredentials = false){
  if(!connection.proxy) return {};
  const proxy = normalizeConnectionProxy(connection.proxy);
  if(!includeCredentials){
    // Common proxy services put their access key in a query parameter.
    proxy.url = proxy.url.replace(/([?&](?:key|api[_-]?key|access[_-]?token|token|secret|signature)=)[^&#]*/gi, "$1YOUR_PROXY_KEY");
  }
  return { proxy };
}

function connectionProxyImportHint(connection){
  const proxy = normalizeConnectionProxy(connection.proxy);
  if(!proxy.enabled) return "";
  let host = "a configured proxy";
  try { host = new URL(proxy.url).host; } catch {}
  return `<div class="hint import-proxy-note">Uses ${escapeHtml(host)} as a CORS proxy. Requests, including access credentials, pass through this service.</div>`;
}

function syncConnectionProxyControls(container){
  const row = container?.matches?.(".connection-proxy") ? container : container?.querySelector(".connection-proxy");
  if(!row) return;
  const proxy = readConnectionProxy(row);
  row.querySelector(".connection-proxy-fields").classList.toggle("hide", !proxy.enabled);
  let recipient = "the configured proxy";
  try { recipient = new URL(proxy.url).host; } catch {}
  row.querySelector(".connection-proxy-recipient").textContent = `Requests, including access credentials, will pass through ${recipient}.`;
}
