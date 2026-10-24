/* ------------------------- Notepad ------------------------- */
function npData(){
  if(!state.notepad) state.notepad = { notes:[], todos:[] };
  if(!Array.isArray(state.notepad.notes)) state.notepad.notes = [];
  if(!Array.isArray(state.notepad.todos)) state.notepad.todos = [];
  return state.notepad;
}
function npFmtTime(ts){
  try{
    return new Date(ts).toLocaleString("en-US",
      {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"});
  }catch{ return ""; }
}
function openNotepad(tab){
  document.getElementById("notepadOverlay").classList.remove("hide");
  setNotepadTab(tab || "notes");
  renderNotes(); renderTodos();
}
function closeNotepad(){
  document.getElementById("notepadOverlay").classList.add("hide");
}
function isNotepadOpen(){
  const el = document.getElementById("notepadOverlay");
  return el && !el.classList.contains("hide");
}
function setNotepadTab(tab){
  document.querySelectorAll(".np-tab").forEach(b=>b.classList.toggle("active", b.dataset.nptab===tab));
  document.querySelectorAll(".np-panel").forEach(p=>p.classList.toggle("hide", p.dataset.nppanel!==tab));
}

/* --- Knowledge notes --- */
function addNote({title, body, src}){
  body = (body||"").trim();
  if(!body && !(title||"").trim()) return null;
  const note = { id:uid(), title:(title||"").trim(), body, src:src||"", time:Date.now() };
  npData().notes.push(note);
  saveState();
  return note;
}
function deleteNote(id){
  const d = npData();
  d.notes = d.notes.filter(n=>n.id!==id);
  saveState(); renderNotes();
}
function updateNote(id, title, body){
  const n = npData().notes.find(x=>x.id===id);
  if(!n) return;
  n.title = (title||"").trim();
  n.body = (body||"").trim();
  saveState(); renderNotes();
}
function renderNotes(){
  const list = document.getElementById("npNoteList");
  if(!list) return;
  // 时间倒序；同一毫秒内按插入顺序，后加入的更新 → 排在前面
  const notes = npData().notes.map((n,i)=>[n,i]).sort((a,b)=>(b[0].time-a[0].time)||(b[1]-a[1])).map(x=>x[0]);
  list.innerHTML = "";
  if(!notes.length){
    const e = document.createElement("div"); e.className="np-empty"; e.textContent = t("notepad.notes.empty");
    list.appendChild(e); return;
  }
  for(const n of notes){
    const card = document.createElement("div"); card.className="np-note";
    const head = document.createElement("div"); head.className="np-note-head";
    if(n.title){
      const ti = document.createElement("div"); ti.className="np-note-title"; ti.textContent = n.title; head.appendChild(ti);
    }else{
      const sp = document.createElement("div"); sp.className="np-note-title"; sp.style.flex="1"; head.appendChild(sp);
    }
    const tm = document.createElement("div"); tm.className="np-note-time"; tm.textContent = npFmtTime(n.time); head.appendChild(tm);
    card.appendChild(head);
    const bd = document.createElement("div"); bd.className="np-note-body np-md";
    bd.innerHTML = renderMarkdown(n.body||""); enhanceCodeBlocks(bd);
    card.appendChild(bd);
    if(n.src){
      const s = document.createElement("span"); s.className="np-note-src"; s.textContent = n.src; card.appendChild(s);
    }
    const acts = document.createElement("div"); acts.className="np-note-actions";
    const edit = document.createElement("span"); edit.textContent = t("notepad.action.edit");
    const copy = document.createElement("span"); copy.textContent = t("notepad.action.copy");
    const del = document.createElement("span"); del.className="np-del"; del.textContent = t("notepad.action.delete");
    edit.addEventListener("click", ()=>startEditNote(card, n));
    copy.addEventListener("click", ()=>{ navigator.clipboard.writeText(n.body); copy.textContent=t("notepad.action.copied"); setTimeout(()=>copy.textContent=t("notepad.action.copy"),1200); });
    del.addEventListener("click", ()=>{ if(confirm(t("notepad.note.delete.confirm"))) deleteNote(n.id); });
    acts.appendChild(edit); acts.appendChild(copy); acts.appendChild(del);
    card.appendChild(acts);
    list.appendChild(card);
  }
}
function startEditNote(card, n){
  const bd = card.querySelector(".np-note-body");
  const acts = card.querySelector(".np-note-actions");
  const ed = makeMdEditor(n.body);
  bd.replaceWith(ed.wrap); ed.ta.focus();
  acts.innerHTML = "";
  const save = document.createElement("span"); save.textContent = t("notepad.action.save");
  const cancel = document.createElement("span"); cancel.textContent = t("notepad.action.cancel");
  save.addEventListener("click", ()=>updateNote(n.id, n.title, ed.ta.value));
  cancel.addEventListener("click", renderNotes);
  acts.appendChild(save); acts.appendChild(cancel);
}

/* --- lightweight markdown editing helpers --- */
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
// Build a toolbar bound to a textarea; optional live-preview host toggles view.
function buildMdBar(ta, preview){
  const bar=document.createElement("div"); bar.className="np-md-bar";
  const mk=(label,cls,title,fn)=>{
    const b=document.createElement("button"); b.type="button";
    b.className="np-md-btn"+(cls?(" "+cls):""); b.textContent=label; b.title=title;
    b.addEventListener("mousedown",e=>e.preventDefault()); // keep textarea selection
    b.addEventListener("click",()=>{ if(bar._preview) return; fn(); });
    return b;
  };
  bar.appendChild(mk("B","md-b",t("notepad.md.bold"),()=>mdSurround(ta,"**","**")));
  bar.appendChild(mk("I","md-i",t("notepad.md.italic"),()=>mdSurround(ta,"*","*")));
  bar.appendChild(mk("H","",t("notepad.md.heading"),()=>mdPrefixLines(ta,"## ")));
  bar.appendChild(mk("•","",t("notepad.md.list"),()=>mdPrefixLines(ta,"- ")));
  bar.appendChild(mk("</>","",t("notepad.md.code"),()=>mdSurround(ta,"`","`")));
  bar.appendChild(mk("🔗","",t("notepad.md.link"),()=>mdSurround(ta,"[","](url)")));
  if(preview){
    const spacer=document.createElement("span"); spacer.style.flex="1"; bar.appendChild(spacer);
    const pv=document.createElement("button"); pv.type="button"; pv.className="np-md-btn";
    pv.textContent="👁"; pv.title=t("notepad.md.preview");
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
// Force the composer back to edit view (used after a note is added).
function resetComposerPreview(){
  const bar=npNoteComposerBar, preview=npNoteComposerPreview, bd=document.getElementById("npNoteBody");
  if(!bar||!bar._preview) return;
  bar._preview=false;
  const pv=bar.querySelector(".np-md-btn.active"); if(pv) pv.classList.remove("active");
  if(preview) preview.classList.add("hide");
  if(bd) bd.classList.remove("hide");
}
// A textarea + toolbar + preview bundle. Returns { wrap, ta }.
function makeMdEditor(value){
  const wrap=document.createElement("div"); wrap.className="np-md-editor";
  const ta=document.createElement("textarea"); ta.className="np-edit"; ta.value=value||"";
  const preview=document.createElement("div"); preview.className="np-note-body np-md np-md-preview hide";
  wrap.appendChild(buildMdBar(ta, preview));
  wrap.appendChild(ta);
  wrap.appendChild(preview);
  return { wrap, ta };
}

/* --- To-dos --- */
const NP_DUE_SOON_MS = 24*60*60*1000; // 24h 内视为“临近”
// datetime-local 值(YYYY-MM-DDTHH:MM) ↔ 时间戳
function npDueToTs(v){ if(!v) return null; const t=new Date(v).getTime(); return isNaN(t)?null:t; }
function npTsToDueInput(ts){
  if(!ts) return "";
  const d=new Date(ts-new Date().getTimezoneOffset()*60000);
  return d.toISOString().slice(0,16);
}
function npDueState(ts, done){
  if(!ts || done) return "";           // 无期限或已完成 → 不高亮
  const diff = ts - Date.now();
  if(diff < 0) return "overdue";
  if(diff <= NP_DUE_SOON_MS) return "soon";
  return "";
}
function addTodo(text, due){
  text = (text||"").trim();
  if(!text) return;
  npData().todos.push({ id:uid(), text, done:false, time:Date.now(), due:npDueToTs(due) });
  saveState(); renderTodos();
}
function setTodoDue(id, ts){
  const td = npData().todos.find(x=>x.id===id);
  if(!td) return;
  td.due = ts || null;
  saveState(); renderTodos();
}
function toggleTodo(id){
  const td = npData().todos.find(x=>x.id===id);
  if(!td) return;
  td.done = !td.done;
  saveState(); renderTodos();
}
function updateTodo(id, text){
  const td = npData().todos.find(x=>x.id===id);
  if(!td) return;
  text = (text||"").trim();
  if(!text){ deleteTodo(id); return; }
  td.text = text; saveState(); renderTodos();
}
function deleteTodo(id){
  const d = npData();
  d.todos = d.todos.filter(x=>x.id!==id);
  saveState(); renderTodos();
}
function renderTodos(){
  const list = document.getElementById("npTodoList");
  if(!list) return;
  // 未完成在上，已完成沉底；各组内按加入时间正序
  const todos = npData().todos.slice().sort((a,b)=>(a.done-b.done) || (a.time-b.time));
  list.innerHTML = "";
  if(!todos.length){
    const e = document.createElement("div"); e.className="np-empty"; e.textContent = t("notepad.todos.empty");
    list.appendChild(e); return;
  }
  for(const td of todos){
    const row = document.createElement("div"); row.className="np-todo"+(td.done?" done":"");
    const cb = document.createElement("input"); cb.type="checkbox"; cb.checked = td.done;
    cb.addEventListener("change", ()=>toggleTodo(td.id));
    const main = document.createElement("div"); main.className="np-todo-main";
    const txt = document.createElement("div"); txt.className="np-todo-text"; txt.textContent = td.text;
    txt.title = t("notepad.todo.edit.title");
    txt.addEventListener("dblclick", ()=>startEditTodo(row, td));
    main.appendChild(txt);
    // meta: 创建时间（低调） + 预计完成时间徽章
    const meta = document.createElement("div"); meta.className="np-todo-meta";
    const time = document.createElement("span"); time.className="np-todo-time";
    time.textContent = t("notepad.created", npFmtTime(td.time));
    meta.appendChild(time);
    if(td.due){
      const due = document.createElement("span");
      due.className = "np-todo-due" + (()=>{ const s=npDueState(td.due, td.done); return s?" "+s:""; })();
      due.textContent = "⏰ " + npFmtTime(td.due);
      due.title = t("notepad.todo.due.edit.title");
      due.addEventListener("click", ()=>startEditDue(meta, td, due));
      meta.appendChild(due);
    }else{
      const add = document.createElement("span"); add.className="np-todo-due-add";
      add.textContent = t("notepad.todo.due.add");
      add.addEventListener("click", ()=>startEditDue(meta, td, add));
      meta.appendChild(add);
    }
    main.appendChild(meta);
    const del = document.createElement("span"); del.className="np-del"; del.textContent = "×"; del.title = t("notepad.action.delete");
    del.addEventListener("click", ()=>deleteTodo(td.id));
    row.appendChild(cb); row.appendChild(main); row.appendChild(del);
    list.appendChild(row);
  }
}
function startEditDue(meta, td, anchorEl){
  const inp = document.createElement("input");
  inp.type = "datetime-local"; inp.className = "np-todo-due-edit";
  inp.value = npTsToDueInput(td.due);
  anchorEl.replaceWith(inp); inp.focus();
  try{ inp.showPicker && inp.showPicker(); }catch{}
  let committed = false;
  const commit = ()=>{ if(committed) return; committed = true; setTodoDue(td.id, npDueToTs(inp.value)); };
  inp.addEventListener("change", commit);
  inp.addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){ e.preventDefault(); commit(); }
    else if(e.key==="Escape"){ committed = true; renderTodos(); }
  });
  inp.addEventListener("blur", commit);
}
function startEditTodo(row, td){
  const txt = row.querySelector(".np-todo-text");
  const inp = document.createElement("input"); inp.type="text"; inp.value = td.text;
  inp.className="np-todo-text"; inp.style.cssText="border:1px solid var(--accent);border-radius:6px;background:var(--bg);padding:4px 8px";
  txt.replaceWith(inp); inp.focus(); inp.select();
  const commit = ()=>updateTodo(td.id, inp.value);
  inp.addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); commit(); } else if(e.key==="Escape"){ renderTodos(); } });
  inp.addEventListener("blur", commit);
}

/* --- Save a chat message into notepad (knowledge) --- */
function saveMessageToNotepad(m, btnEl){
  const text = m.i18nKey ? t(m.i18nKey) : (m.content||"");
  if(!(text||"").trim()) return;
  const srcName = m.role==="user"
    ? (state.general.userName || t("userName.default"))
    : (state.general.aiName || t("aiName.default"));
  addNote({ title:"", body:text, src:t("notepad.src.fromChat", srcName) });
  if(isNotepadOpen()) renderNotes();
  if(btnEl){
    const orig = btnEl.textContent;
    btnEl.textContent = t("notepad.saved");
    setTimeout(()=>{ btnEl.textContent = orig; }, 1200);
  }
}

