/* ------------------------- Voice Input (Web Speech API) ------------------------- */
let _voiceRecognition = null;
let _isVoiceRecording = false;
let _voicePrefixText = "";
let _voiceAccumulatedText = "";

function isVoiceSupported(){
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function getSpeechLang(){
  if(typeof state !== "undefined" && state.lang){
    if(state.lang === "it") return "it-IT";
    if(state.lang === "zh") return "zh-CN";
    if(state.lang === "ja") return "ja-JP";
    if(state.lang === "es") return "es-ES";
    if(state.lang === "fr") return "fr-FR";
    if(state.lang === "de") return "de-DE";
    if(state.lang === "en") return "en-US";
  }
  if(navigator.languages && navigator.languages.length){
    return navigator.languages[0];
  }
  return navigator.language || "it-IT";
}

function toggleVoiceInput(){
  if(_isVoiceRecording){
    stopVoiceInput();
  } else {
    startVoiceInput();
  }
}

function startVoiceInput(){
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRec){
    alert(typeof t === "function" ? t("mic.unsupported") : "Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
    return;
  }

  const ta = document.getElementById("input");
  const micBtn = document.getElementById("micBtn");
  const statusHint = document.getElementById("statusHint");

  _voicePrefixText = (ta?.value || "").trim();
  _voiceAccumulatedText = "";

  try {
    _voiceRecognition = new SpeechRec();
    _voiceRecognition.continuous = true;
    _voiceRecognition.interimResults = true;
    _voiceRecognition.lang = getSpeechLang();

    _voiceRecognition.onstart = () => {
      _isVoiceRecording = true;
      if(micBtn) micBtn.classList.add("recording");
      if(statusHint) statusHint.textContent = typeof t === "function" ? t("mic.listening") : "🎙️ Listening…";
    };

    _voiceRecognition.onresult = (event) => {
      let interimTranscript = "";
      for(let i = event.resultIndex; i < event.results.length; ++i){
        const item = event.results[i];
        if(item.isFinal){
          _voiceAccumulatedText += item[0].transcript + " ";
        } else {
          interimTranscript += item[0].transcript;
        }
      }

      if(ta){
        const full = (_voicePrefixText + " " + _voiceAccumulatedText + interimTranscript).replace(/\s+/g, " ").trim();
        ta.value = full;
        if(typeof autoresize === "function") autoresize(ta);
      }
    };

    _voiceRecognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      if(event.error === "not-allowed" || event.error === "service-not-allowed"){
        alert(typeof t === "function" ? t("mic.denied") : "Microphone access was denied. Please allow microphone permissions in your browser settings.");
      }
      stopVoiceInput();
    };

    _voiceRecognition.onend = () => {
      stopVoiceInput();
    };

    _voiceRecognition.start();
  } catch(err) {
    console.error("Failed to start speech recognition:", err);
    stopVoiceInput();
  }
}

function stopVoiceInput(){
  if(!_isVoiceRecording && !_voiceRecognition) return;
  _isVoiceRecording = false;

  const micBtn = document.getElementById("micBtn");
  const statusHint = document.getElementById("statusHint");
  const ta = document.getElementById("input");

  if(micBtn) micBtn.classList.remove("recording");
  if(statusHint && statusHint.textContent.includes("Listening")) {
    statusHint.textContent = "";
  }

  if(_voiceRecognition){
    try {
      _voiceRecognition.onstart = null;
      _voiceRecognition.onresult = null;
      _voiceRecognition.onerror = null;
      _voiceRecognition.onend = null;
      _voiceRecognition.stop();
    } catch(e){}
    _voiceRecognition = null;
  }

  if(ta){
    const full = (_voicePrefixText + " " + _voiceAccumulatedText).replace(/\s+/g, " ").trim();
    if(full) ta.value = full;
    if(typeof autoresize === "function") autoresize(ta);
    ta.focus();
  }
}
