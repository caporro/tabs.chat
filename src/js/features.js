/* Build capabilities belong to the executable, never to saved/shared agent settings. */
const APP_BUILD = Object.freeze((/* __BUILD_PROFILE__ */ null) || { edition: 'normal', diagrams: true, math: true, pdf: true, docx: true });
function appHasFeature(name) { return APP_BUILD[name] === true; }
function appEditionName() { return APP_BUILD.edition === 'lite' ? 'Lite' : 'Normal'; }
function attachmentAccept() {
  return APP_BUILD.edition === 'lite'
    ? 'image/*,text/*,.txt,.md,.markdown,.csv,.json,.jsonl,.xml,.yaml,.yml,.toml,.ini,.conf,.log,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.c,.cpp,.h,.cs,.php,.rb,.sh,.sql,.html,.css,.scss,.vue,.svelte,.env,.gitignore,.dockerignore'
    : '';
}
function applyEditionUI() {
  document.documentElement.dataset.edition = APP_BUILD.edition;
  const lite = APP_BUILD.edition === 'lite';
  document.title = t('app.title') + (lite ? ' · Lite' : '');
  const badge = document.getElementById('aboutEditionBadge');
  if (badge) badge.textContent = appEditionName();
  const version = document.getElementById('aboutVersionBadge');
  if (version) version.textContent = 'v' + getAppVersion();
  const logo = document.querySelector('.sidebar .logo-mark');
  const aboutLogo = document.getElementById('aboutLogo');
  if (aboutLogo && logo) aboutLogo.src = logo.src;
  const summary = document.getElementById('aboutEditionDescription');
  if (summary) summary.textContent = lite
    ? 'Diagrams and formulas remain text. PDF/DOCX import is available in Normal.'
    : 'Also includes Mermaid diagrams, mathematical formulas and PDF/DOCX text extraction.';
  const picker = document.getElementById('fileInput');
  if (picker) picker.accept = attachmentAccept();
  const attach = document.getElementById('attachBtn');
  if (attach) {
    const title = lite ? 'Attach images or text files' : t('attach.btn.title');
    attach.title = title; attach.setAttribute('aria-label', title);
  }
}
