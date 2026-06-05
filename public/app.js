const SIGNAL_META = {
  is_authority: '権威の名乗り',
  has_threat: '脅し',
  has_secrecy: '秘密指示',
  ask_financial: '資産確認',
  demand_action: '即時行動要求'
};

const MAX_UTTERANCES = 5;
const RECORDING_SLICE_MS = 4500;
const utterances = [];
let mediaRecorder;
let mediaStream;
let recordingActive = false;
let segmentTimer;

const elements = {
  appShell: document.querySelector('#appShell'),
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  recordingStatus: document.querySelector('#recordingStatus'),
  utteranceList: document.querySelector('#utteranceList'),
  manualForm: document.querySelector('#manualForm'),
  manualInput: document.querySelector('#manualInput'),
  scoreValue: document.querySelector('#scoreValue'),
  scoreMeter: document.querySelector('#scoreMeter'),
  riskBadge: document.querySelector('#riskBadge'),
  riskMessage: document.querySelector('#riskMessage'),
  signalGrid: document.querySelector('#signalGrid'),
  alertBanner: document.querySelector('#alertBanner'),
  transcriptionNote: document.querySelector('#transcriptionNote')
};

renderSignals({});

elements.startButton.addEventListener('click', startRecording);
elements.stopButton.addEventListener('click', stopRecording);
elements.manualForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = elements.manualInput.value.trim();
  if (!text) return;
  elements.manualInput.value = '';
  addUtterance(text);
});

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus('このブラウザは録音に対応していません。手入力を使ってください。');
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingActive = true;
    startRecordingSegment();
    elements.startButton.disabled = true;
    elements.stopButton.disabled = false;
    setStatus('録音中');
  } catch (error) {
    setStatus(`録音を開始できません: ${error.message}`);
  }
}

function stopRecording() {
  recordingActive = false;
  clearTimeout(segmentTimer);
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  mediaStream?.getTracks().forEach((track) => track.stop());
  elements.startButton.disabled = false;
  elements.stopButton.disabled = true;
  setStatus('待機中');
}

function startRecordingSegment() {
  const chunks = [];
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: pickMimeType() });
  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  mediaRecorder.addEventListener('stop', () => {
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    if (recordingActive) startRecordingSegment();
    if (blob.size) transcribeAudioBlob(blob);
  }, { once: true });
  mediaRecorder.start();
  segmentTimer = setTimeout(() => {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  }, RECORDING_SLICE_MS);
}

async function transcribeAudioBlob(blob) {
  try {
    setStatus('文字起こし中');
    const audioBase64 = await blobToBase64(blob);
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType: blob.type || 'audio/webm' })
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    if (result.text) await addUtterance(result.text);
    setStatus(mediaRecorder?.state === 'recording' ? '録音中' : '待機中');
  } catch (error) {
    setStatus(`文字起こし失敗: ${error.message}`);
  }
}

async function addUtterance(text) {
  utterances.push(text);
  while (utterances.length > MAX_UTTERANCES) utterances.shift();
  renderUtterances();

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utterances })
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
    updateDashboard(result);
  } catch (error) {
    elements.riskMessage.textContent = `解析に失敗しました: ${error.message}`;
  }
}

function renderUtterances() {
  elements.utteranceList.innerHTML = utterances
    .map((text) => `<li>${escapeHtml(text)}</li>`)
    .join('');
}

function updateDashboard(result) {
  const score = Number(result.score ?? 0);
  const riskKey = result.riskLevel?.key ?? 'safe';
  elements.scoreValue.textContent = score;
  elements.scoreMeter.value = score;
  elements.riskBadge.className = `risk-badge ${riskKey}`;
  elements.riskBadge.textContent = result.riskLevel?.label ?? '低リスク';
  elements.riskMessage.textContent = result.riskLevel?.message ?? '';
  elements.appShell.classList.toggle('danger-mode', score >= 75);
  elements.alertBanner.classList.toggle('hidden', score < 75);
  renderSignals(result);
}

function renderSignals(result) {
  const signalScores = result.signalScores ?? {};
  const evidence = result.evidence ?? {};
  elements.signalGrid.innerHTML = Object.entries(SIGNAL_META).map(([key, label]) => {
    const score = signalScores[key] ?? 0;
    const latestEvidence = evidence[key]?.at(-1)?.text ?? '未検知';
    return `
      <article class="signal-card ${score > 0 ? 'active' : ''}">
        <span>${label}</span>
        <strong>${score}</strong>
        <p>${escapeHtml(latestEvidence)}</p>
      </article>
    `;
  }).join('');
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function setStatus(message) {
  elements.recordingStatus.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
