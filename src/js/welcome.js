/* ------------------------- Welcome & Onboarding ------------------------- */
function hasConfiguredLLM(){
  const providers = getProviders();
  if(!providers || !providers.length) return false;
  return providers.some(p => p.enabled !== false && ((p.key||"").trim() || isLocalProviderType(p.type)));
}

function updateComposerPlaceholder(){
  const ta = document.getElementById("input");
  if(!ta) return;
  if(!hasConfiguredLLM()){
    ta.placeholder = t("onboarding.inputPlaceholder");
  } else {
    ta.placeholder = t("composer.input.placeholder");
  }
}

function createWelcomeChat(){
  const id = uid();
  const chat = {
    id,
    title: t("welcome.title"),
    model: state.lastModel || "",
    systemPrompt: state.general.systemPrompt,
    messages: [],
    isWelcome: true,
    createdAt: Date.now()
  };
  state.chats.unshift(chat);
  state.activeChatId = id;
  saveState();
}

function renderOnboardingHero(container){
  const esc = (s) => (s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const brandHtml = '<span class="brand-text"><span class="brand-name">tabs</span><span class="brand-accent">.chat</span></span>';

  container.innerHTML = `
    <div class="onboarding-container">
      <div class="onboarding-header">
        <h1 class="onboarding-title">${t("onboarding.title", brandHtml)}</h1>
        <p class="onboarding-desc">${esc(t("onboarding.desc"))}</p>
      </div>

      <div class="onboarding-cards">
        <div class="onboarding-privacy-badge">
          ${icon("lock")}
          <span>${esc(t("onboarding.privacy"))}</span>
        </div>

        <!-- Cloud and local providers -->
        <div class="onboarding-providers">
          <div class="onboarding-provider-section">
            <div class="onboarding-card-body">
              <div class="onboarding-card-header">
                <h3>${esc(t("onboarding.cloud.title"))}</h3>
                <span class="onboarding-tag cloud">${esc(t("onboarding.cloud.tag"))}</span>
              </div>
              <p class="onboarding-card-text">${esc(t("onboarding.cloud.desc"))}</p>
              <div class="onboarding-provider-buttons">
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="openai">OpenAI</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="claude">Claude</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="gemini">Gemini</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="deepseek">DeepSeek</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="openrouter">OpenRouter</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="groq">Groq</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="mistral">Mistral AI</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="xai">xAI</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="">${esc(t("onboarding.cloud.other"))}</button>
              </div>
            </div>
          </div>

          <hr class="onboarding-provider-divider" />

          <div class="onboarding-provider-section">
            <div class="onboarding-card-body">
              <div class="onboarding-card-header">
                <h3>${esc(t("onboarding.local.title"))}</h3>
                <span class="onboarding-tag local">${esc(t("onboarding.local.tag"))}</span>
              </div>
              <p class="onboarding-card-text">${esc(t("onboarding.local.desc"))}</p>
              <div class="onboarding-provider-buttons">
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="ollama">Ollama</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="llamacpp">llama.cpp</button>
                <button type="button" class="btn ghost btn-sm" data-onboarding-provider="lmstudio">LM Studio</button>
              </div>
            </div>
          </div>
        </div>

        <hr class="onboarding-provider-divider" />

        <!-- Restore Backup -->
        <div class="onboarding-card onboarding-backup-card">
          <div class="onboarding-card-header onboarding-backup-title">
            <h3>${esc(t("onboarding.backup.title"))}</h3>
          </div>
          <div class="onboarding-backup-divider" aria-hidden="true"></div>
          <p class="onboarding-card-text">${esc(t("onboarding.backup.desc"))}</p>
          <button type="button" class="btn ghost onboarding-action-btn" id="obBackupBtn">
            <span>${esc(t("onboarding.backup.btn"))}</span>
            ${icon("download")}
          </button>
        </div>
      </div>

    </div>
  `;

  // Attach button event listeners
  container.querySelectorAll("[data-onboarding-provider]").forEach(btn => {
    btn.onclick = () => {
      const type = btn.dataset.onboardingProvider;
      openSettings("providers");
      openAddProviderModal(type);
      document.getElementById(!type ? "pm_type" : isLocalProviderType(type) ? "pm_base" : "pm_key")?.focus();
    };
  });

  const backupBtn = container.querySelector("#obBackupBtn");
  if(backupBtn){
    backupBtn.onclick = () => {
      const fileInput = document.getElementById("importFileInput");
      if(fileInput) fileInput.click();
    };
  }
}
