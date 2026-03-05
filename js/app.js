const apiKeyInput  = document.getElementById('apiKeyInput');
const apiKeyStatus = document.getElementById('apiKeyStatus');
const startBtn     = document.getElementById('startBtn');
const stopBtn      = document.getElementById('stopBtn');
const clearBtn     = document.getElementById('clearBtn');
const copyBtn      = document.getElementById('copyBtn');
const langSelect   = document.getElementById('langSelect');
const statusPill   = document.getElementById('statusPill');
const statusText   = document.getElementById('statusText');
const transcriptBox= document.getElementById('transcriptBox');
const placeholder  = document.getElementById('placeholder');
const errorBanner  = document.getElementById('errorBanner');
const errorMsg     = document.getElementById('errorMsg');
const wordCountEl  = document.getElementById('wordCount');
const charCountEl  = document.getElementById('charCount');
const durationEl   = document.getElementById('duration');
const confidenceEl = document.getElementById('confidence');
const waveform     = document.getElementById('waveform');
const toast        = document.getElementById('toast');
const wrap         = document.getElementById('transcriptWrap');

// Load API key from localStorage (never hardcode in source)
const savedKey = localStorage.getItem('dg_api_key');
if (savedKey) {
  apiKeyInput.value = savedKey;
  apiKeyStatus.classList.add('visible');
}

let socket = null;
let mediaStream = null;
let mediaRecorder = null;
let finalTranscript = '';
let startTime = null;
let timerInterval = null;
let lastConfidence = null;

apiKeyInput.addEventListener('input', () => {
  const key = apiKeyInput.value.trim();
  apiKeyStatus.classList.toggle('visible', key.length > 10);
  if (key.length > 10) localStorage.setItem('dg_api_key', key);
  else localStorage.removeItem('dg_api_key');
});

function setStatus(state, label) {
  statusPill.className = 'status-pill ' + state;
  statusText.textContent = label;
  waveform.classList.toggle('active', state === 'live');
}

function showError(msg) {
  errorMsg.innerHTML = msg;
  errorBanner.classList.add('visible');
}
function hideError() { errorBanner.classList.remove('visible'); }

function updateStats() {
  const text = finalTranscript.trim();
  wordCountEl.textContent = text ? text.split(/\s+/).length : 0;
  charCountEl.textContent = text.length;
  if (lastConfidence !== null) {
    confidenceEl.textContent = Math.round(lastConfidence * 100) + '%';
  }
}

function renderTranscript(interim = '') {
  const hasContent = finalTranscript || interim;
  placeholder.style.opacity = hasContent ? '0' : '1';
  transcriptBox.innerHTML =
    (finalTranscript ? escapeHtml(finalTranscript) : '') +
    (interim ? `<span class="interim-text">${escapeHtml(interim)}</span>` : '');
  wrap.scrollTop = wrap.scrollHeight;
  updateStats();
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const secs = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
    durationEl.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
  }, 500);
}

function stopTimer() { clearInterval(timerInterval); }

async function startTranscription() {
  hideError();
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showError('<b>API key required.</b> Paste your Deepgram API key above.'); return; }

  setStatus('connecting', 'Connecting…');
  startBtn.disabled = true;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    showError('<b>Microphone access denied.</b> Please allow microphone permissions and try again.');
    setStatus('idle', 'Idle');
    startBtn.disabled = false;
    return;
  }

  const lang = langSelect.value;
  const wsUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=${lang}&punctuate=true&interim_results=true&smart_format=true&utterance_end_ms=1000`;

  socket = new WebSocket(wsUrl, ['token', apiKey]);

  socket.onopen = () => {
    setStatus('live', 'Live');
    stopBtn.disabled = false;
    startTimer();

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: getSupportedMimeType() });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0 && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(e.data);
      }
    };
    mediaRecorder.start(200);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type !== 'Results') return;

      const alt = data.channel?.alternatives?.[0];
      if (!alt) return;

      const text = alt.transcript;
      if (!text) return;

      if (typeof alt.confidence === 'number') lastConfidence = alt.confidence;

      if (data.is_final) {
        finalTranscript += text + ' ';
        renderTranscript('');
      } else {
        renderTranscript(text);
      }
    } catch(e) {}
  };

  socket.onerror = () => {
    showError('<b>WebSocket error.</b> Check your API key and internet connection.');
    stopTranscription();
  };

  socket.onclose = (e) => {
    if (e.code === 1008 || e.code === 4000) {
      showError('<b>Invalid API key.</b> Please check your Deepgram API key.');
    }
    if (stopBtn.disabled === false) stopTranscription();
  };
}

function stopTranscription() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (socket) {
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'CloseStream' }));
      socket.close();
    }
    socket = null;
  }
  stopTimer();
  renderTranscript('');
  setStatus('stopped', 'Stopped');
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

function getSupportedMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
  return '';
}

startBtn.addEventListener('click', startTranscription);
stopBtn.addEventListener('click', stopTranscription);

clearBtn.addEventListener('click', () => {
  finalTranscript = '';
  lastConfidence = null;
  renderTranscript('');
  durationEl.textContent = '0s';
  confidenceEl.textContent = '—';
  setStatus('idle', 'Idle');
});

copyBtn.addEventListener('click', () => {
  if (!finalTranscript.trim()) return;
  navigator.clipboard.writeText(finalTranscript.trim()).then(() => {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  });
});
