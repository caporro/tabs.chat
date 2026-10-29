/* Shared note archive and single-note workspace. */
let _activeNoteId = null;

function npNotes(){ return state.notes || []; }
function activeNote(){ return npNotes().find(note => note.id === _activeNoteId) || null; }
function noteTitle(note){ return note?.title?.trim() || "Untitled note"; }

function noteAgentOptions(select, selected = null){
  select.replaceChildren();
  const none = document.createElement("option"); none.value = ""; none.textContent = "No agent"; select.append(none);
  for(const agent of state.agents){
    const option = document.createElement("option"); option.value = agent.id; option.textContent = agent.name; select.append(option);
  }
  select.value = selected || "";
}

function npFmtTime(ts){
  try{ return new Date(ts).toLocaleString(undefined, {month:"short", day:"numeric"}); }
  catch{ return ""; }
}

function updateWorkspaceMode(){
  const notes = isNotepadOpen();
  document.getElementById("chatModeBtn").classList.toggle("active", !notes);
  document.getElementById("chatModeBtn").setAttribute("aria-pressed", String(!notes));
  document.getElementById("notepadBtn").classList.toggle("active", notes);
  document.getElementById("notepadBtn").setAttribute("aria-pressed", String(notes));
  document.querySelector(".sidebar-agent-wrap").classList.toggle("hide", notes);
  document.getElementById("chatList").classList.toggle("hide", notes);
  document.getElementById("sidebarNotesContent").classList.toggle("hide", !notes);
}

function openNotepad(noteId){
  if(isSettingsOpen()) closeSettings();
  if(isSettingsOpen()) return;
  document.body.classList.add("notes-mode");
  document.getElementById("notepadOverlay").classList.remove("hide");
  document.getElementById("chatView").classList.add("hide");
  updateWorkspaceMode();
  if(noteId){ document.getElementById("npFilter").value = "all"; _activeNoteId = noteId; }
  renderNotes();
  loadNoteEditor();
  closeMobileSidebar();
}

function closeNotepad(){
  if(!flushSettingsAutosave()) return;
  document.getElementById("notepadOverlay").classList.add("hide");
  document.body.classList.remove("notes-mode");
  if(!isSettingsOpen()) document.getElementById("chatView").classList.remove("hide");
  updateWorkspaceMode();
}

function isNotepadOpen(){ const view = document.getElementById("notepadOverlay"); return !!view && !view.classList.contains("hide"); }

function addNote({title, body, src, agentId = null}){
  body = (body||"").trim();
  if(!body && !(title||"").trim()) return null;
  const note = { id:uid(), title:(title||"").trim(), body, src:src||"", time:Date.now(), agentId:state.agents.some(agent => agent.id === agentId) ? agentId : null };
  if(!Array.isArray(state.notes)) state.notes = [];
  state.notes.unshift(note);
  saveState(); renderNotes();
  return note;
}

function createNote(){
  flushSettingsAutosave();
  const note = { id:uid(), title:"", body:"", agentId:document.getElementById("npFilter").value === "agent" ? state.activeAgentId : null, time:Date.now() };
  if(!Array.isArray(state.notes)) state.notes = [];
  state.notes.unshift(note); saveState();
  openNotepad(note.id);
  document.getElementById("npNoteTitle").focus();
  return note;
}

function deleteNote(id){
  flushSettingsAutosave();
  state.notes = npNotes().filter(note => note.id !== id);
  if(_activeNoteId === id) _activeNoteId = null;
  saveState(); renderNotes();
}

function updateNote(id, title, body, agentId){
  const note = npNotes().find(item => item.id === id);
  if(!note) return;
  note.title = (title || "").trim(); note.body = body || "";
  if(agentId !== undefined) note.agentId = state.agents.some(agent => agent.id === agentId) ? agentId : null;
  note.updatedAt = Date.now();
  saveState(); renderNotes();
  if(note.id === _activeNoteId) loadNoteEditor();
}

function selectNote(id){
  flushSettingsAutosave();
  _activeNoteId = id;
  renderNotes(); loadNoteEditor(); closeMobileSidebar();
}

function loadNoteEditor(){
  const note = activeNote();
  document.getElementById("noteEditorEmpty").classList.toggle("hide", !!note);
  document.getElementById("noteEditor").classList.toggle("hide", !note);
  document.getElementById("noteCopyBtn").disabled = !note;
  document.getElementById("noteDeleteBtn").disabled = !note;
  if(!note) return;
  document.getElementById("npNoteTitle").value = note.title || "";
  document.getElementById("npNoteBody").value = note.body || "";
  noteAgentOptions(document.getElementById("npNoteAgent"), note.agentId);
  resetComposerPreview();
}

function noteEditorChanged(){
  const note = activeNote();
  if(!note) return;
  note.title = document.getElementById("npNoteTitle").value;
  note.body = document.getElementById("npNoteBody").value;
  const link = document.getElementById("npNoteAgent").value;
  note.agentId = state.agents.some(agent => agent.id === link) ? link : null;
  note.updatedAt = Date.now();
  queueSettingsAutosave();
  renderNotes(true);
}

function renderNotes(keepSelection = false){
  keepSelection = keepSelection === true;
  const list = document.getElementById("npNoteList");
  if(!list) return;
  const filter = document.getElementById("npFilter").value;
  const notes = npNotes().filter(note => filter === "all" || (filter === "agent" ? note.agentId === state.activeAgentId : !note.agentId))
    .sort((a,b)=>(b.updatedAt || b.time)-(a.updatedAt || a.time));
  const previous = _activeNoteId;
  if(!keepSelection && !notes.some(note => note.id === _activeNoteId)) _activeNoteId = notes[0]?.id || null;
  list.replaceChildren();
  for(const note of notes){
    const item = document.createElement("button"); item.type = "button"; item.className = "note-nav-item" + (note.id === _activeNoteId ? " active" : "");
    item.dataset.noteId = note.id; item.setAttribute("aria-current", note.id === _activeNoteId ? "true" : "false");
    const title = document.createElement("span"); title.className = "note-nav-title"; title.textContent = noteTitle(note);
    const context = document.createElement("small"); context.textContent = state.agents.find(agent => agent.id === note.agentId)?.name || "No agent";
    item.append(title, context); item.onclick = () => selectNote(note.id); list.append(item);
  }
  if(!notes.length){ const empty = document.createElement("p"); empty.className = "notes-nav-empty"; empty.textContent = "No notes in this view."; list.append(empty); }
  if(previous !== _activeNoteId && isNotepadOpen()) loadNoteEditor();
}

function renderNotepad(){ renderNotes(); }

/* --- Lightweight markdown editing helpers --- */
function mdSurround(ta, before, after){
  const s=ta.selectionStart, e=ta.selectionEnd, v=ta.value;
  const sel=v.slice(s,e);
  ta.value=v.slice(0,s)+before+sel+after+v.slice(e);
  const ns=s+before.length;
  ta.selectionStart=ns; ta.selectionEnd=ns+sel.length;
  ta.focus();
}

function mdPrefixLines(ta, prefix){
  const s=ta.selectionStart, e=ta.selectionEnd, v=ta.value;
  const ls=v.lastIndexOf("\n",s-1)+1;
  let le=v.indexOf("\n",e); if(le<0) le=v.length;
  const block=v.slice(ls,le).split("\n").map(l=>prefix+l).join("\n");
  ta.value=v.slice(0,ls)+block+v.slice(le);
  ta.selectionStart=ls; ta.selectionEnd=ls+block.length;
  ta.focus();
}

function buildMdBar(ta, preview){
  const bar=document.createElement("div"); bar.className="np-md-bar";
  const mk=(label,cls,title,fn)=>{
    const b=document.createElement("button"); b.type="button";
    b.className="np-md-btn"+(cls?(" "+cls):"");
    if(typeof label === "string" && label.startsWith("<svg")){
      b.innerHTML = label;
    }else{
      b.textContent = label;
    }
    b.title=title;
    b.addEventListener("mousedown",e=>e.preventDefault());
    b.addEventListener("click",()=>{ if(bar._preview) return; fn(); ta.dispatchEvent(new Event("input", { bubbles:true })); });
    return b;
  };
  bar.appendChild(mk("B","md-b",t("notepad.md.bold"),()=>mdSurround(ta,"**","**")));
  bar.appendChild(mk("I","md-i",t("notepad.md.italic"),()=>mdSurround(ta,"*","*")));
  bar.appendChild(mk("H","",t("notepad.md.heading"),()=>mdPrefixLines(ta,"## ")));
  bar.appendChild(mk("•","",t("notepad.md.list"),()=>mdPrefixLines(ta,"- ")));
  bar.appendChild(mk("</>","",t("notepad.md.code"),()=>mdSurround(ta,"`","`")));
  bar.appendChild(mk(typeof icon === "function" ? icon("link", { size: 13 }) : "🔗","",t("notepad.md.link"),()=>mdSurround(ta,"[","](url)")));
  if(preview){
    const spacer=document.createElement("span"); spacer.style.flex="1"; bar.appendChild(spacer);
    const pv=document.createElement("button"); pv.type="button"; pv.className="np-md-btn";
    pv.innerHTML=typeof icon === "function" ? icon("eye", { size: 14 }) : "👁"; pv.title=t("notepad.md.preview");
    pv.addEventListener("click",()=>{
      bar._preview=!bar._preview;
      pv.classList.toggle("active", bar._preview);
      if(bar._preview){
        preview.innerHTML=renderMarkdown(ta.value||""); enhanceCodeBlocks(preview);
        preview.classList.remove("hide"); ta.classList.add("hide");
      }else{
        preview.classList.add("hide"); ta.classList.remove("hide"); ta.focus();
      }
    });
    bar.appendChild(pv);
  }
  return bar;
}

let npNoteComposerBar=null, npNoteComposerPreview=null;

function resetComposerPreview(){
  const bar=npNoteComposerBar, preview=npNoteComposerPreview, bd=document.getElementById("npNoteBody");
  if(!bar||!bar._preview) return;
  bar._preview=false;
  const pv=bar.querySelector(".np-md-btn.active"); if(pv) pv.classList.remove("active");
  if(preview) preview.classList.add("hide");
  if(bd) bd.classList.remove("hide");
}

function makeMdEditor(value){
  const wrap=document.createElement("div"); wrap.className="np-md-editor";
  const ta=document.createElement("textarea"); ta.className="np-edit"; ta.value=value||"";
  const preview=document.createElement("div"); preview.className="np-note-body np-md np-md-preview hide";
  wrap.appendChild(buildMdBar(ta, preview));
  wrap.appendChild(ta);
  wrap.appendChild(preview);
  return { wrap, ta };
}

/* --- Save a chat message into notepad knowledge --- */
function saveMessageToNotepad(m, btnEl){
  const text = m.i18nKey ? t(m.i18nKey) : (m.content||"");
  if(!(text||"").trim()) return;
  const identity = resolvedIdentity(getAgentForChat(currentChat()));
  const srcName = m.role==="user" ? (identity.userName || t("userName.default")) : identity.agentName;
  addNote({ title:"", body:text, src:t("notepad.src.fromChat", srcName), agentId: state.activeAgentId });
  if(isNotepadOpen()) renderNotes();
  if(btnEl){
    const orig = btnEl.textContent;
    btnEl.textContent = t("notepad.saved");
    setTimeout(()=>{ btnEl.textContent = orig; }, 1200);
  }
}
