// シグナルの定義元はサーバー(src/signals.js)。見出しをここに複製すると、
// シグナルを増やしたときに画面だけ古いままになるので API から取得する。
let signalDescriptors = [];

const RECORDING_SLICE_MS = 4500;
// 解析が詰まったときに無限にキューを伸ばさないための上限。超えた分のチャンクは捨てる。
const MAX_PENDING_ANALYSES = 2;
const ANALYSIS_TIMEOUT_MS = 20_000;

let utterances = [];
let mediaRecorder;
let mediaStream;
let recordingActive = false;
let segmentTimer;
// 遷移元から ?userId=... で渡ってくる利用者情報。通話履歴の振り分けに使う。
// 無ければ履歴は残さず、検知機能だけが動く。
const caller = readCallerFromUrl();

// 通話ごとの識別子。サーバー側はこれをキーに会話履歴を保持して latch スコアを積む。
// 生成は startRecording まで遅らせる（非セキュアコンテキストでは crypto.randomUUID が無く、
// モジュール読み込み時に落とすとボタンのハンドラすら付かなくなるため）。
let sessionId = null;
let pendingAnalyses = 0;
// 停止後、最後のチャンクの解析が終わってからサーバーの履歴を捨てるためのフラグ
let sessionToRelease = null;

const elements = {
  appShell: document.querySelector('#appShell'),
  startButton: document.querySelector('#startButton'),
  stopButton: document.querySelector('#stopButton'),
  recordingStatus: document.querySelector('#recordingStatus'),
  utteranceList: document.querySelector('#utteranceList'),
  scoreValue: document.querySelector('#scoreValue'),
  scoreMeter: document.querySelector('#scoreMeter'),
  riskBadge: document.querySelector('#riskBadge'),
  riskMessage: document.querySelector('#riskMessage'),
  signalGrid: document.querySelector('#signalGrid'),
  brandImage: document.querySelector('#brandImage'),
  canarySound: document.querySelector('#canarySound')
};

// 危険に「入った瞬間」だけカナリアの鳴き声を鳴らすための前回状態
let wasDanger = false;

// 待機中に出す案内文。通話をまたいで使い回すので初期表示から控えておく。
const IDLE_RISK_MESSAGE = elements.riskMessage.textContent;

elements.startButton.addEventListener('click', startRecording);
elements.stopButton.addEventListener('click', stopRecording);

loadSignalDescriptors();

/** カードの見出しをサーバーから取得して初期表示を描く。 */
async function loadSignalDescriptors() {
  try {
    const response = await fetch('/api/signals');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    signalDescriptors = payload.signals ?? [];
  } catch {
    // 取得できなくても録音自体は動かせるようにする（カードが空になるだけ）
    setStatus('シグナル定義を取得できませんでした');
  }
  renderSignals({});
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus('このブラウザは録音に対応していません。');
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // 通話ごとにセッションを切り直し、前の通話のシグナルを持ち越さない
    sessionId = createSessionId();
    sessionToRelease = null;
    resetDashboard();
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
  // stop() は最後のチャンクの解析を非同期に走らせる。その結果を取りこぼさないよう、
  // 破棄の予約だけ立てて実際の削除は解析完了後に行う。
  sessionToRelease = sessionId;
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  mediaStream?.getTracks().forEach((track) => track.stop());
  elements.startButton.disabled = false;
  elements.stopButton.disabled = true;
  setStatus('待機中');
  releaseIfIdle();
}

/** 新しい通話を始める前に、前の通話のログ・スコア・danger mode を消す。 */
function resetDashboard() {
  utterances = [];
  renderUtterances();
  updateDashboard({});
  elements.riskMessage.textContent = IDLE_RISK_MESSAGE;
}

/**
 * 遷移元が付けたクエリパラメータから利用者情報を取り出す。
 *
 * 読み取ったあとは history.replaceState で URL から消す。ブックマークや共有で
 * 利用者IDが意図せず出回るのを防ぐためで、値自体はメモリに保持して使い続ける。
 */
function readCallerFromUrl() {
  const params = new URLSearchParams(location.search);
  const userId = params.get('userId') ?? '';
  const displayName = params.get('displayName') ?? '';

  if (userId && (params.has('userId') || params.has('displayName'))) {
    params.delete('userId');
    params.delete('displayName');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
  }

  return { userId, displayName };
}

/** 利用者情報が渡っていればリクエストに載せる。無ければキー自体を送らない。 */
function withCaller(payload) {
  if (!caller.userId) return payload;
  return {
    ...payload,
    userId: caller.userId,
    ...(caller.displayName ? { displayName: caller.displayName } : {})
  };
}

function createSessionId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  // 非セキュアコンテキスト向けのフォールバック。衝突しなければ十分で、秘匿性は要らない。
  return `safi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 停止が予約されていて、かつ解析待ちが無くなったら通話を確定させる。
 * サーバー側はここで要約を作って履歴に残し、セッションを破棄する。
 * 失敗してもサーバー側の TTL でセッションは消えるので握りつぶす。
 */
function releaseIfIdle() {
  if (!sessionToRelease || pendingAnalyses > 0) return;

  const id = sessionToRelease;
  sessionToRelease = null;
  fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withCaller({ sessionId: id }))
  }).catch(() => {});
}

// 停止を押さずにタブを閉じられると通話が確定せず、履歴が残らない。
// pagehide で確定要求だけ投げておく（keepalive で離脱後も送信される）。
addEventListener('pagehide', () => {
  if (!recordingActive || !sessionId) return;
  fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withCaller({ sessionId })),
    keepalive: true
  }).catch(() => {});
});

function startRecordingSegment() {
  const chunks = [];
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: pickMimeType() });
  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  mediaRecorder.addEventListener('stop', () => {
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    if (recordingActive) startRecordingSegment();
    if (blob.size) analyzeAudioBlob(blob);
  }, { once: true });
  mediaRecorder.start();
  segmentTimer = setTimeout(() => {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  }, RECORDING_SLICE_MS);
}

// 解析リクエストを直列化する。チャンクの到着順と発話ログの順序を一致させるため。
let analysisChain = Promise.resolve();

/**
 * 音声チャンクを1回のリクエストで解析する。
 * サーバー側で Gemini が文字起こしと詐欺判定を同時に行い、会話全体のスコアまで返す。
 */
function analyzeAudioBlob(blob) {
  // 解析(約3秒)が録音スライス(4.5秒)を超えて詰まったら、古い順に捨てて追従を優先する
  if (pendingAnalyses >= MAX_PENDING_ANALYSES) {
    setStatus('解析が混み合っています');
    return;
  }

  pendingAnalyses += 1;
  analysisChain = analysisChain
    .then(() => sendForAnalysis(blob))
    .finally(() => {
      pendingAnalyses -= 1;
      releaseIfIdle();
    });
}

async function sendForAnalysis(blob) {
  // 解析は数秒かかる。応答が返る頃に通話が切り替わっていたら、その結果は捨てる。
  const requestSession = sessionId;

  try {
    setStatus('解析中');
    const audioBase64 = await blobToBase64(blob);
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        withCaller({ sessionId: requestSession, audioBase64, mimeType: blob.type || 'audio/webm' })
      ),
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS)
    });
    const result = await response.json();

    if (requestSession !== sessionId) return;
    if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);

    // latest が null のチャンクは無音・聞き取り不能。ログには積まずスコアだけ更新する。
    if (result.latest?.text) {
      utterances = [...utterances, result.latest.text];
      renderUtterances();
    }
    updateDashboard(result);
    setStatus(recordingActive ? '録音中' : '待機中');
  } catch (error) {
    if (requestSession !== sessionId) return;
    setStatus('解析に失敗しました');
    elements.riskMessage.textContent = `解析に失敗しました: ${error.message}`;
  }
}

function renderUtterances() {
  elements.utteranceList.innerHTML = utterances
    .map((text) => `<li>${escapeHtml(text)}</li>`)
    .join('');
  // 最新発話が見えるよう一番下へ自動スクロール
  elements.utteranceList.scrollTop = elements.utteranceList.scrollHeight;
}

function updateDashboard(result) {
  const score = Number(result.score ?? 0);
  const riskKey = result.riskLevel?.key ?? 'safe';
  // 閾値はサーバーの getRiskLevel が唯一の判断元。ここで再実装するとバッジと danger mode がずれる。
  const isDanger = riskKey === 'danger';
  elements.scoreValue.textContent = score;
  elements.scoreMeter.value = score;
  elements.riskBadge.className = `risk-badge ${riskKey}`;
  elements.riskBadge.textContent = result.riskLevel?.label ?? '低リスク';
  elements.riskMessage.textContent = result.riskLevel?.message ?? '';
  elements.appShell.classList.toggle('danger-mode', isDanger);
  elements.brandImage.src = isDanger ? elements.brandImage.dataset.dangerSrc : elements.brandImage.dataset.safeSrc;
  elements.brandImage.alt = isDanger ? 'SAFi 危険検知' : 'SAFi';

  // 危険に入った瞬間にカナリアの鳴き声でアラート（連続では鳴らさない）
  if (isDanger && !wasDanger) playCanary();
  wasDanger = isDanger;

  renderSignals(result);
}

function renderSignals(result) {
  const signalScores = result.signalScores ?? {};
  const evidence = result.evidence ?? {};
  elements.signalGrid.innerHTML = signalDescriptors.map(({ key, label }) => {
    const score = Number(signalScores[key]) || 0;
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

function playCanary() {
  const audio = elements.canarySound;
  if (!audio) return;
  try {
    audio.currentTime = 0;
    // 録音開始のクリックでユーザー操作済みのため通常は再生可。失敗しても無視。
    audio.play().catch(() => {});
  } catch {
    // noop
  }
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
