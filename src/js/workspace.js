/* Search and explicit note context for the conversation composer. */
let _workspaceSearchScope = "all";
let _workspaceSearchTimer = null;
let _workspaceSearchReturnFocus = null;
let _mentionSelection = 0;
let _mentionNoteIds = [];

function searchSnippet(text, query){
  const plain = String(text || "").replace(/\s+/g, " ").trim();
  const first = query.trim().toLocaleLowerCase().split(/\s+/)[0];
  const at = first ? plain.toLocaleLowerCase().indexOf(first) : 0;
  const start = Math.max(0, at - 40);
  return (start ? "…" : "") + plain.slice(start, start + 150) + (plain.length > start + 150 ? "…" : "");
}

function workspaceSearchResults(query, scope = _workspaceSearchScope){
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = text => words.every(word => text.toLocaleLowerCase().includes(word));
  const results = [];
  if(scope !== "chats") for(const note of npNotes()){
    if(!matches(`${note.title || ""} ${note.body || ""}`)) continue;
    results.push({ kind:"note", id:note.id, title:noteTitle(note), context:state.agents.find(agent => agent.id === note.agentId)?.name || "No agent", snippet:searchSnippet(note.body, query), time:note.updatedAt || note.time || 0 });
  }
  if(scope !== "notes") for(const agent of state.agents) for(const chat of agent.chats || []){
    const content = (chat.messages || []).map(message => String(message.content || "")).join(" ");
    if(!matches(`${chat.title || ""} ${content}`)) continue;
    results.push({ kind:"chat", id:chat.id, agentId:agent.id, title:chat.title || "Untitled chat", context:agent.name, snippet:searchSnippet(content, query), time:chat.messages?.at(-1)?.time || chat.createdAt || 0 });
  }
  return results.sort((a,b) => b.time - a.time).slice(0, 60);
}

function renderWorkspaceSearch(){
  clearTimeout(_workspaceSearchTimer);
  const list = document.getElementById("workspaceSearchResults");
  const query = document.getElementById("workspaceSearchInput").value;
  const results = workspaceSearchResults(query);
  list.replaceChildren();
  for(const result of results){
    const button = document.createElement("button"); button.type = "button"; button.className = "workspace-search-result";
    button.dataset.kind = result.kind; button.dataset.resultId = result.id;
    const title = document.createElement("strong"); title.textContent = result.title;
    const context = document.createElement("small"); context.textContent = `${result.kind === "note" ? "Note" : "Chat"} · ${result.context}`;
    const snippet = document.createElement("span"); snippet.textContent = result.snippet;
    button.append(title, context, snippet);
    button.onclick = () => {
      closeWorkspaceSearch();
      if(result.kind === "note") openNotepad(result.id);
      else { closeNotepad(); if(isSettingsOpen()) closeSettings(); switchAgent(result.agentId); switchChat(result.id); }
    };
    list.append(button);
  }
  if(!results.length){ const empty = document.createElement("p"); empty.className = "workspace-search-empty"; empty.textContent = "No chats or notes found."; list.append(empty); }
}

function openWorkspaceSearch(){
  _workspaceSearchReturnFocus = document.activeElement;
  document.getElementById("workspaceSearchModal").classList.remove("hide");
  renderWorkspaceSearch();
  const input = document.getElementById("workspaceSearchInput"); input.focus(); input.select();
}

function closeWorkspaceSearch(){
  clearTimeout(_workspaceSearchTimer);
  document.getElementById("workspaceSearchModal").classList.add("hide");
  if(_workspaceSearchReturnFocus?.isConnected) _workspaceSearchReturnFocus.focus();
  _workspaceSearchReturnFocus = null;
}

function mentionQuery(){
  const input = document.getElementById("input");
  if(input.selectionStart !== input.selectionEnd) return null;
  const before = input.value.slice(0, input.selectionStart);
  const match = before.match(/(?:^|\s)@([^\n@]{0,80})$/);
  return match ? { start:before.length - match[1].length - 1, end:input.selectionStart, query:match[1].trim().toLocaleLowerCase() } : null;
}

function closeNoteMentions(){
  document.getElementById("noteMentionPicker").classList.add("hide");
  const input = document.getElementById("input"); input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
  _mentionNoteIds = []; _mentionSelection = 0;
}

function highlightNoteMention(){
  document.querySelectorAll(".note-mention-option").forEach((item,index) => {
    item.classList.toggle("active", index === _mentionSelection);
    item.setAttribute("aria-selected", String(index === _mentionSelection));
  });
  const selected = document.querySelectorAll(".note-mention-option")[_mentionSelection];
  if(selected){ document.getElementById("input").setAttribute("aria-activedescendant", selected.id); selected.scrollIntoView({ block:"nearest" }); }
}

function renderNoteMentions(){
  const mention = mentionQuery();
  if(!mention){ closeNoteMentions(); return; }
  const words = mention.query.split(/\s+/).filter(Boolean);
  const notes = npNotes().filter(note => (note.title || note.body) && words.every(word => `${note.title || ""} ${note.body || ""}`.toLocaleLowerCase().includes(word)))
    .sort((a,b) => (b.updatedAt || b.time) - (a.updatedAt || a.time)).slice(0, 8);
  const picker = document.getElementById("noteMentionPicker"); picker.replaceChildren();
  const heading = document.createElement("div"); heading.className = "note-mention-heading"; heading.textContent = "Add a note to this message"; picker.append(heading);
  _mentionNoteIds = notes.map(note => note.id); _mentionSelection = 0;
  for(const [index,note] of notes.entries()){
    const item = document.createElement("button"); item.type = "button"; item.className = "note-mention-option"; item.id = `note-mention-${index}`;
    item.setAttribute("role", "option"); item.dataset.noteId = note.id;
    const title = document.createElement("span"); title.textContent = noteTitle(note);
    const context = document.createElement("small"); context.textContent = state.agents.find(agent => agent.id === note.agentId)?.name || "No agent";
    item.append(title, context); item.onmousedown = event => event.preventDefault(); item.onclick = () => selectNoteMention(note.id); picker.append(item);
  }
  if(!notes.length){ const empty = document.createElement("p"); empty.className = "note-mention-heading"; empty.textContent = "No matching notes."; picker.append(empty); }
  picker.classList.remove("hide"); document.getElementById("input").setAttribute("aria-expanded", "true"); highlightNoteMention();
}

function selectNoteMention(id){
  const note = npNotes().find(item => item.id === id);
  const mention = mentionQuery();
  if(!note || !mention) return;
  if(!pendingAttachments.some(attachment => attachment.source === "note" && attachment.noteId === id)){
    pendingAttachments.push({ kind:"file", source:"note", noteId:id, name:`${noteTitle(note)}.md`, mime:"text/markdown", text:`# ${noteTitle(note)}\n\n${note.body || ""}` });
  }
  const input = document.getElementById("input");
  input.value = input.value.slice(0, mention.start) + input.value.slice(mention.end);
  input.setSelectionRange(mention.start, mention.start); closeNoteMentions(); renderAttachStrip(); autoresize(input); input.focus();
}

function handleNoteMentionKeydown(event){
  if(document.getElementById("noteMentionPicker").classList.contains("hide") || event.isComposing) return false;
  if(event.key === "Escape"){ event.preventDefault(); event.stopPropagation(); closeNoteMentions(); return true; }
  if(!_mentionNoteIds.length) return false;
  if(event.key === "ArrowDown" || event.key === "ArrowUp"){
    event.preventDefault(); _mentionSelection = (_mentionSelection + (event.key === "ArrowDown" ? 1 : -1) + _mentionNoteIds.length) % _mentionNoteIds.length;
    highlightNoteMention(); return true;
  }
  if(event.key === "Enter" && !event.shiftKey){ event.preventDefault(); selectNoteMention(_mentionNoteIds[_mentionSelection]); return true; }
  return false;
}

function setupWorkspace(){
  injectIcons(document.getElementById("sidebarChatContent"));
  injectIcons(document.getElementById("notepadOverlay"));
  injectIcons(document.getElementById("workspaceSearchModal"));
  document.getElementById("chatModeBtn").onclick = () => { closeNotepad(); closeMobileSidebar(); };
  document.getElementById("newNoteBtn").onclick = createNote;
  document.getElementById("createFirstNoteBtn").onclick = createNote;
  document.getElementById("notesSidebarOpenBtn").onclick = openMobileSidebar;
  document.getElementById("noteCopyBtn").onclick = () => { const note = activeNote(); if(note) navigator.clipboard.writeText(note.body || ""); };
  document.getElementById("noteDeleteBtn").onclick = () => { const note = activeNote(); if(note && confirm("Delete this note?")) deleteNote(note.id); };
  for(const id of ["npNoteTitle", "npNoteBody", "npNoteAgent"]){
    document.getElementById(id).addEventListener(id === "npNoteAgent" ? "change" : "input", noteEditorChanged);
  }
  document.querySelectorAll(".workspace-search-btn").forEach(button => button.onclick = openWorkspaceSearch);
  document.getElementById("workspaceSearchClose").onclick = closeWorkspaceSearch;
  const mask = document.getElementById("workspaceSearchModal");
  mask.onclick = event => { if(event.target === mask) closeWorkspaceSearch(); };
  mask.onkeydown = event => {
    if(event.key === "Escape"){ event.stopPropagation(); closeWorkspaceSearch(); return; }
    const items = [...mask.querySelectorAll("button, input")].filter(item => item.checkVisibility());
    if(event.key === "Tab" && document.activeElement === (event.shiftKey ? items[0] : items.at(-1))){ event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0]).focus(); }
    const results = [...mask.querySelectorAll(".workspace-search-result")];
    if(event.target.dataset.searchScope && ["ArrowLeft", "ArrowRight"].includes(event.key)){
      event.preventDefault();
      const scopes = [...mask.querySelectorAll("[data-search-scope]")];
      const next = scopes[(scopes.indexOf(event.target) + (event.key === "ArrowRight" ? 1 : -1) + scopes.length) % scopes.length];
      next.click(); next.focus(); return;
    }
    if(["ArrowDown", "ArrowUp"].includes(event.key) && results.length){ event.preventDefault(); const index = results.indexOf(document.activeElement); results[(index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length].focus(); }
    if(event.key === "Enter" && event.target.id === "workspaceSearchInput") results[0]?.click();
  };
  document.getElementById("workspaceSearchInput").oninput = () => { clearTimeout(_workspaceSearchTimer); _workspaceSearchTimer = setTimeout(renderWorkspaceSearch, 120); };
  document.querySelectorAll("[data-search-scope]").forEach(button => button.onclick = () => {
    _workspaceSearchScope = button.dataset.searchScope;
    document.querySelectorAll("[data-search-scope]").forEach(item => item.setAttribute("aria-selected", String(item === button)));
    renderWorkspaceSearch();
  });
  const input = document.getElementById("input"); input.setAttribute("aria-controls", "noteMentionPicker"); input.setAttribute("aria-expanded", "false");
  input.addEventListener("input", renderNoteMentions); input.addEventListener("click", renderNoteMentions);
  input.addEventListener("keyup", event => { if(["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) renderNoteMentions(); });
  document.addEventListener("click", event => { if(!event.target.closest(".composer")) closeNoteMentions(); });
  updateWorkspaceMode();
}
