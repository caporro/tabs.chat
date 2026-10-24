/* ------------------------- Attachments ------------------------- */
function renderAttachStrip(){
  const s = document.getElementById("attachStrip");
  s.innerHTML = "";
  pendingAttachments.forEach((a,i)=>{
    const chip = document.createElement("div"); chip.className="attach-chip";
    if(a.kind==="image"){
      const img = document.createElement("img"); img.src=a.dataUrl; chip.appendChild(img);
    }else{
      const ico = document.createElement("span"); ico.textContent="📎"; chip.appendChild(ico);
    }
    const name = document.createElement("span"); name.className="name"; name.textContent=a.name||"file"; chip.appendChild(name);
    const x = document.createElement("span"); x.className="x"; x.textContent="×"; x.addEventListener("click",()=>{ pendingAttachments.splice(i,1); renderAttachStrip(); });
    chip.appendChild(x);
    s.appendChild(chip);
  });
}

/* Vision input tokens scale with image RESOLUTION (pixel count), not file size.
   These presets trade resolution → tokens. JPEG quality only affects upload bytes. */
const IMAGE_PRESETS = {
  high:     { maxSide:1568, maxPixels:1568*1568, quality:0.85, detail:"high" },   // max detail
  standard: { maxSide:1024, maxPixels:1024*1024, quality:0.82, detail:"high" },   // near-lossless, fewer tokens
  low:      { maxSide:640,  maxPixels:640*640,   quality:0.8,  detail:"low" }     // OpenAI low = flat 85 tokens
};
function imagePreset(){
  return IMAGE_PRESETS[state.general.imageDetail] || IMAGE_PRESETS.standard;
}

async function compressImage(file, preset){
  preset = preset || imagePreset();
  const { maxSide, maxPixels, quality } = preset;
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((res, rej)=>{
      const im = new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=url;
    });
    let {naturalWidth:w, naturalHeight:h} = img;
    // Compute a single downscale factor honoring both the long-edge and total-pixel caps.
    // Never upscale (factor capped at 1).
    let scale = 1;
    if(Math.max(w,h) > maxSide) scale = maxSide / Math.max(w,h);
    if(w*h*scale*scale > maxPixels) scale = Math.min(scale, Math.sqrt(maxPixels/(w*h)));
    w = Math.max(1, Math.round(w*scale));
    h = Math.max(1, Math.round(h*scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  }finally{ URL.revokeObjectURL(url); }
}

async function handleFiles(files){
  const preset = imagePreset();
  for(const file of files){
    if(file.type.startsWith("image/")){
      let dataUrl;
      try{ dataUrl = await compressImage(file, preset); }
      catch{ dataUrl = await fileToDataUrl(file); }
      pendingAttachments.push({kind:"image", name:file.name, mime:"image/jpeg", dataUrl, detail:preset.detail});
    }else{
      let text = "";
      try{
        if(file.type==="application/pdf" || /\.pdf$/i.test(file.name)){
          text = await extractPdf(file);
        }else if(/\.docx$/i.test(file.name)){
          const buf = await file.arrayBuffer();
          const r = await mammoth.extractRawText({arrayBuffer:buf}); text = r.value;
        }else{
          text = await file.text();
        }
      }catch(e){ text = "[Failed to read file: "+e.message+"]"; }
      pendingAttachments.push({kind:"file", name:file.name, mime:file.type||"text/plain", text});
    }
  }
  renderAttachStrip();
}
function fileToDataUrl(file){
  return new Promise((res,rej)=>{
    const r = new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file);
  });
}
async function extractPdf(file){
  const buf = await file.arrayBuffer();
  const pdf = await window.__pdfjsLib.getDocument({data:buf}).promise;
  let out = "";
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    out += c.items.map(x=>x.str).join(" ")+"\n\n";
  }
  return out;
}

