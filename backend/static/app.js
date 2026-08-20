/**
 * Kaya — Job Site Safety Copilot & Voice+Vision+RAG Assistant
 * Frontend Controller: Real-time Multi-mode Video Stream, 3D Pose Mesh, Depth Colormap & RAG Chatbot
 */

// ── DOM References ────────────────────────────────────────────────

const videoFeed          = document.getElementById('videoFeed');
const poseCanvas         = document.getElementById('poseCanvas');
const poseControls       = document.getElementById('poseControls');
const btnPoseStream      = document.getElementById('btnPoseStream');
const btnPose3D          = document.getElementById('btnPose3D');

const telObjects         = document.getElementById('telObjects');
const telHazards         = document.getElementById('telHazards');
const telFps             = document.getElementById('telFps');
const telDepthStats      = document.getElementById('telDepthStats');
const btnReconnect       = document.getElementById('btnReconnect');

const btnModeTemporal    = document.getElementById('btnModeTemporal');
const btnModeSingle      = document.getElementById('btnModeSingle');
const pillVisionLabel    = document.getElementById('pillVisionLabel');
const pillSTTLabel       = document.getElementById('pillSTTLabel');
const pillTTSLabel       = document.getElementById('pillTTSLabel');
const pillRAGLabel       = document.getElementById('pillRAGLabel');
const btnReset           = document.getElementById('btnReset');

const convFeed           = document.getElementById('convFeed');
const welcomeCard        = document.getElementById('welcomeCard');
const msgCount           = document.getElementById('msgCount');

const btnPTT             = document.getElementById('btnPTT');
const pttLabel           = document.getElementById('pttLabel');
const textForm           = document.getElementById('textForm');
const textInput          = document.getElementById('textInput');
const btnSend            = document.getElementById('btnSend');

const hudListening       = document.getElementById('hudListening');
const hudThinking        = document.getElementById('hudThinking');
const hudSpeaking        = document.getElementById('hudSpeaking');
const toastContainer     = document.getElementById('toastContainer');

// ── State ─────────────────────────────────────────────────────────

let activeViewMode  = 'all';
let poseSubMode     = 'stream'; // 'stream' or '3d'
let frameMode       = 'TEMPORAL_FRAMES';
let msgTotal        = 0;
let isRecording     = false;
let isProcessing    = false;
let mediaRecorder   = null;
let audioChunks     = [];
let audioStream     = null;

// Three.js 3D Pose State
let threeScene      = null;
let threeCamera     = null;
let threeRenderer   = null;
let threeControls   = null;
let poseLoopId      = null;
let poseMeshGroup   = null;
let noPoseTextMesh  = null;

// ── 17 COCO Skeleton Bones Pairs ──────────────────────────────────
const SKELETON_BONES = [
  [0, 1], [0, 2],         // Nose to eyes
  [1, 3], [2, 4],         // Eyes to ears
  [5, 6],                 // Shoulder to shoulder
  [5, 7], [7, 9],         // Left arm
  [6, 8], [8, 10],        // Right arm
  [5, 11], [6, 12],       // Left / right torso
  [11, 12],               // Hip to hip
  [11, 13], [13, 15],     // Left leg
  [12, 14], [14, 16]      // Right leg
];

// ── HUD Overlays ──────────────────────────────────────────────────

function showHUD(type) {
  hideHUD();
  if (type === 'listening') hudListening.classList.remove('hidden');
  else if (type === 'thinking') hudThinking.classList.remove('hidden');
  else if (type === 'speaking') hudSpeaking.classList.remove('hidden');
}

function hideHUD() {
  hudListening.classList.add('hidden');
  hudThinking.classList.add('hidden');
  hudSpeaking.classList.add('hidden');
}

// ── Telemetry & Provider Status ───────────────────────────────────

async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    // Providers
    if (data.providers) {
      if (data.providers.vision) pillVisionLabel.textContent = `Vision: ${data.providers.vision.split(':')[0]}`;
      if (data.providers.stt) pillSTTLabel.textContent = `STT: ${data.providers.stt.split('/')[0]}`;
      if (data.providers.tts) pillTTSLabel.textContent = `TTS: ${data.providers.tts.split('/')[0]}`;
      if (data.providers.rag) pillRAGLabel.textContent = `RAG: ${data.providers.rag.split('_')[0]}`;
    }

    // Copilot CV telemetry
    if (data.copilot) {
      telObjects.textContent = `${data.copilot.tracked_count || 0} objects`;
      telHazards.textContent = `${data.copilot.hazards_count || 0} hazards`;
      if (data.copilot.fps != null) telFps.textContent = `${Math.round(data.copilot.fps)} fps`;
    }
  } catch (err) {
    console.debug('Status poll error:', err);
  }
}

setInterval(pollStatus, 2500);
pollStatus();

// ── View Mode Switching ───────────────────────────────────────────

function updateViewDisplay() {
  stopPoseLoop();
  poseControls.classList.add('hidden');

  if (activeViewMode === 'pose') {
    poseControls.classList.remove('hidden');
    if (poseSubMode === '3d') {
      videoFeed.classList.add('hidden');
      poseCanvas.classList.remove('hidden');
      startPoseLoop();
      return;
    } else {
      poseCanvas.classList.add('hidden');
      videoFeed.classList.remove('hidden');
      videoFeed.src = `/api/video_feed?mode=pose&t=${Date.now()}`;
      return;
    }
  }

  // All standard stream modes: 'all', 'raw', 'depth', 'ppe', 'objects'
  poseCanvas.classList.add('hidden');
  videoFeed.classList.remove('hidden');
  videoFeed.src = `/api/video_feed?mode=${activeViewMode}&t=${Date.now()}`;
}

document.querySelectorAll('.view-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeViewMode = btn.dataset.mode;
    updateViewDisplay();
  });
});

btnPoseStream.addEventListener('click', () => {
  poseSubMode = 'stream';
  btnPoseStream.classList.add('active');
  btnPose3D.classList.remove('active');
  updateViewDisplay();
});

btnPose3D.addEventListener('click', () => {
  poseSubMode = '3d';
  btnPose3D.classList.add('active');
  btnPoseStream.classList.remove('active');
  updateViewDisplay();
});

btnReconnect.addEventListener('click', () => {
  videoFeed.src = `/api/video_feed?mode=${activeViewMode}&t=${Date.now()}`;
  toast('Reconnected video stream');
});

// ── Three.js 3D Interactive Pose Viewer ───────────────────────────

function initThreeJS() {
  if (threeRenderer) return;

  const container = poseCanvas.parentElement;
  const w = container.clientWidth || 640;
  const h = container.clientHeight || 480;

  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x0a0f1d);

  threeCamera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  threeCamera.position.set(0, 0, 3.8);

  threeRenderer = new THREE.WebGLRenderer({ canvas: poseCanvas, antialias: true });
  threeRenderer.setSize(w, h);
  threeRenderer.setPixelRatio(window.devicePixelRatio || 1);

  if (typeof THREE.OrbitControls !== 'undefined') {
    threeControls = new THREE.OrbitControls(threeCamera, poseCanvas);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.05;
  }

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  threeScene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0x6366f1, 1.2);
  dirLight.position.set(2, 4, 3);
  threeScene.add(dirLight);

  // 3D Spatial Grid Floor
  const grid = new THREE.GridHelper(8, 16, 0x4f46e5, 0x1e293b);
  grid.position.y = -1.6;
  threeScene.add(grid);

  poseMeshGroup = new THREE.Group();
  threeScene.add(poseMeshGroup);

  window.addEventListener('resize', () => {
    if (activeViewMode === 'pose' && poseSubMode === '3d' && threeRenderer) {
      const nw = container.clientWidth || 640;
      const nh = container.clientHeight || 480;
      threeCamera.aspect = nw / nh;
      threeCamera.updateProjectionMatrix();
      threeRenderer.setSize(nw, nh);
    }
  });
}

async function startPoseLoop() {
  initThreeJS();
  let isRunning = true;

  const animate = async () => {
    if (!isRunning || activeViewMode !== 'pose' || poseSubMode !== '3d') return;

    try {
      const res = await fetch('/api/pose');
      if (res.ok) {
        const data = await res.json();
        render3DPoseData(data);
      }
    } catch (err) {
      console.debug('Pose polling error:', err);
    }

    if (threeControls) threeControls.update();
    threeRenderer.render(threeScene, threeCamera);
    poseLoopId = requestAnimationFrame(animate);
  };

  poseLoopId = requestAnimationFrame(animate);
}

function stopPoseLoop() {
  if (poseLoopId) {
    cancelAnimationFrame(poseLoopId);
    poseLoopId = null;
  }
}

function render3DPoseData(data) {
  // Clear previous frame meshes
  while (poseMeshGroup.children.length > 0) {
    const obj = poseMeshGroup.children[0];
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
    poseMeshGroup.remove(obj);
  }

  const poses = data.poses || [];
  const fw = data.frame_width || 1280;
  const fh = data.frame_height || 720;

  if (poses.length === 0) return;

  const jointGeo = new THREE.SphereGeometry(0.045, 12, 12);
  const headGeo  = new THREE.SphereGeometry(0.09, 16, 16);

  poses.forEach((pose, pIdx) => {
    const kps = pose.keypoints || [];
    if (kps.length < 17) return;

    // Joint positions map
    const jointVectors = [];
    kps.forEach((kp, idx) => {
      // Map pixel coordinates to centered 3D unit space
      const normX = ((kp.x / fw) - 0.5) * 3.2;
      const normY = -((kp.y / fh) - 0.5) * 2.4;
      const normZ = kp.depth ? -(kp.depth - 2.2) * 0.4 : 0.0;
      const vec = new THREE.Vector3(normX, normY, normZ);
      jointVectors.push({ vec, conf: kp.conf });

      if (kp.conf > 0.25) {
        const isHead = idx === 0;
        const color = kp.conf > 0.6 ? 0x10b981 : 0xf59e0b;
        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.3,
          metalness: 0.2,
          emissive: color,
          emissiveIntensity: 0.2
        });
        const mesh = new THREE.Mesh(isHead ? headGeo : jointGeo, mat);
        mesh.position.copy(vec);
        poseMeshGroup.add(mesh);
      }
    });

    // Skeletal Bones (Cylinders or Lines)
    SKELETON_BONES.forEach(([iA, iB]) => {
      const ptA = jointVectors[iA];
      const ptB = jointVectors[iB];
      if (ptA && ptB && ptA.conf > 0.25 && ptB.conf > 0.25) {
        const boneMat = new THREE.LineBasicMaterial({
          color: 0x6366f1,
          linewidth: 3,
          transparent: true,
          opacity: 0.85
        });
        const boneGeo = new THREE.BufferGeometry().setFromPoints([ptA.vec, ptB.vec]);
        const line = new THREE.Line(boneGeo, boneMat);
        poseMeshGroup.add(line);
      }
    });

    // Head Gaze Perspective Vector
    if (jointVectors[0] && jointVectors[0].conf > 0.3 && pose.head_yaw != null) {
      const yawRad = (pose.head_yaw * Math.PI) / 180;
      const gazeDir = new THREE.Vector3(Math.cos(yawRad) * 0.4, 0, Math.sin(yawRad) * 0.4);
      const gazeEnd = jointVectors[0].vec.clone().add(gazeDir);
      const gazeMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, linewidth: 2 });
      const gazeGeo = new THREE.BufferGeometry().setFromPoints([jointVectors[0].vec, gazeEnd]);
      poseMeshGroup.add(new THREE.Line(gazeGeo, gazeMat));
    }
  });
}

// ── Frame Mode Switcher ───────────────────────────────────────────

btnModeTemporal.addEventListener('click', () => {
  frameMode = 'TEMPORAL_FRAMES';
  btnModeTemporal.classList.add('active');
  btnModeSingle.classList.remove('active');
  toast('Benchmarking Mode: Temporal Sequence (Buffer 6s @ 1 FPS)');
});

btnModeSingle.addEventListener('click', () => {
  frameMode = 'SINGLE_FRAME';
  btnModeSingle.classList.add('active');
  btnModeTemporal.classList.remove('active');
  toast('Benchmarking Mode: Single Snapshot Frame');
});

// ── Push-to-Talk Voice Recording ──────────────────────────────────

function getMimeType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

async function getAudioStream() {
  if (!audioStream || audioStream.getTracks().every(t => t.readyState === 'ended')) {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
  return audioStream;
}

async function startRecording() {
  if (isRecording || isProcessing) return;
  try {
    const stream = await getAudioStream();
    const mime = getMimeType();
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    audioChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(100);
    isRecording = true;
    btnPTT.classList.add('recording');
    pttLabel.textContent = 'Recording — Release to send';
    showHUD('listening');
  } catch (err) {
    toast('Microphone access denied: ' + err.message, 'error');
  }
}

async function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  await new Promise(res => { mediaRecorder.onstop = res; mediaRecorder.stop(); });
  isRecording = false;
}

async function submitVoiceTurn() {
  await stopRecording();
  btnPTT.classList.remove('recording');
  pttLabel.textContent = 'Push to Talk';
  if (!audioChunks.length) { hideHUD(); return; }

  const mime = getMimeType() || 'audio/webm';
  const blob = new Blob(audioChunks, { type: mime });
  audioChunks = [];
  const userRow = addMsg('user', '🎙️ Spoken question...');
  isProcessing = true;
  showHUD('thinking');

  try {
    const fd = new FormData();
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'webm';
    fd.append('audio', blob, `rec.${ext}`);
    fd.append('frame_mode', frameMode);

    const t0 = performance.now();
    const res = await fetch('/api/ask', { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);
    const data = await res.json();

    if (data.transcript) {
      userRow.querySelector('.bubble').textContent = `🎙️ "${data.transcript}"`;
    }
    addAssistantMsg(data, performance.now() - t0);
  } catch (err) {
    toast(err.message, 'error');
    userRow.remove();
  } finally {
    isProcessing = false;
    hideHUD();
  }
}

btnPTT.addEventListener('mousedown', e => { e.preventDefault(); startRecording(); });
btnPTT.addEventListener('mouseup', () => { if (isRecording) submitVoiceTurn(); });
btnPTT.addEventListener('mouseleave', () => { if (isRecording) submitVoiceTurn(); });
btnPTT.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); });
btnPTT.addEventListener('touchend', e => { e.preventDefault(); if (isRecording) submitVoiceTurn(); });

let spaceDown = false;
document.addEventListener('keydown', e => {
  if (e.target === textInput) return;
  if (e.code === 'Space' && !spaceDown && !isProcessing) {
    e.preventDefault();
    spaceDown = true;
    startRecording();
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space' && spaceDown) {
    e.preventDefault();
    spaceDown = false;
    if (isRecording) submitVoiceTurn();
  }
});

// ── Text Input Submission ─────────────────────────────────────────

textForm.addEventListener('submit', async e => {
  e.preventDefault();
  const q = textInput.value.trim();
  if (!q || isProcessing) return;
  textInput.value = '';
  isProcessing = true;
  btnSend.disabled = true;
  addMsg('user', q);
  showHUD('thinking');

  try {
    const fd = new FormData();
    fd.append('question', q);
    fd.append('frame_mode', frameMode);

    const t0 = performance.now();
    const res = await fetch('/api/ask-text', { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);
    const data = await res.json();
    addAssistantMsg(data, performance.now() - t0);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    isProcessing = false;
    hideHUD();
    btnSend.disabled = false;
  }
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (isProcessing) return;
    textInput.value = chip.dataset.query;
    textForm.dispatchEvent(new Event('submit', { cancelable: true }));
  });
});

// ── Conversation Reset ────────────────────────────────────────────

btnReset.addEventListener('click', async () => {
  try {
    await fetch('/api/reset', { method: 'POST' });
    convFeed.innerHTML = '';
    convFeed.appendChild(welcomeCard);
    welcomeCard.classList.remove('hidden');
    msgTotal = 0;
    msgCount.textContent = '0 messages';
    hideHUD();
    toast('Conversation context reset');
  } catch {
    toast('Reset failed', 'error');
  }
});

// ── Chat Rendering with RAG Grounding & Latency Pills ─────────────

function addMsg(role, text) {
  welcomeCard.classList.add('hidden');
  const row = document.createElement('div');
  row.className = `msg-row ${role === 'user' ? 'user' : 'kaya'}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';

  const ts = document.createElement('span');
  ts.className = 'meta-time';
  ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.appendChild(ts);

  row.appendChild(meta);
  convFeed.appendChild(row);

  msgTotal++;
  msgCount.textContent = `${msgTotal} message${msgTotal !== 1 ? 's' : ''}`;
  scrollDown();
  return row;
}

function addAssistantMsg(data, elapsed) {
  const text = data.response || data.answer || data.text || 'No response.';
  const row = addMsg('kaya', text);
  const meta = row.querySelector('.msg-meta');

  // Latency breakdown pills
  const t = data.timings || {};
  if (t.rag_retrieval_ms != null && t.rag_retrieval_ms > 0) {
    const p = document.createElement('span');
    p.className = 'lat-pill rag';
    p.textContent = `RAG: ${Math.round(t.rag_retrieval_ms)}ms`;
    meta.appendChild(p);
  }
  if (t.vision_ms != null) {
    const p = document.createElement('span');
    p.className = 'lat-pill';
    p.textContent = `VLM: ${Math.round(t.vision_ms)}ms`;
    meta.appendChild(p);
  }
  if (t.tts_ms != null) {
    const p = document.createElement('span');
    p.className = 'lat-pill';
    p.textContent = `TTS: ${Math.round(t.tts_ms)}ms`;
    meta.appendChild(p);
  }
  if (t.total_turn_ms != null) {
    const p = document.createElement('span');
    p.className = 'lat-pill';
    p.style.fontWeight = '700';
    p.textContent = `Total: ${Math.round(t.total_turn_ms)}ms`;
    meta.appendChild(p);
  }

  // RAG Sources Box if retrieved
  const sources = data.rag_sources || data.sources || [];
  if (data.rag_used && sources.length > 0) {
    const sourcesBox = document.createElement('div');
    sourcesBox.className = 'rag-sources-wrap';
    sourcesBox.innerHTML = `
      <div class="rag-sources-title">
        <span>📖 Knowledge Base Grounding (${sources.length} sources)</span>
      </div>
      <div class="rag-source-list"></div>
    `;
    const listEl = sourcesBox.querySelector('.rag-source-list');
    sources.forEach(src => {
      const tag = document.createElement('span');
      tag.className = 'rag-source-tag';
      const title = typeof src === 'string' ? src : (src.title || src.document_name || 'Document');
      const page = typeof src === 'object' && src.page ? ` (p.${src.page})` : '';
      tag.textContent = `${title}${page}`;
      listEl.appendChild(tag);
    });
    row.insertBefore(sourcesBox, meta);
  }

  // Audio synthesis & auto-playback
  const audiob64 = data.audio_base64;
  if (audiob64) {
    const getAudio = () => new Audio(`data:audio/wav;base64,${audiob64}`);
    const btn = document.createElement('button');
    btn.className = 'btn-replay';
    btn.textContent = '▶ Replay';
    btn.onclick = () => getAudio().play().catch(() => {});
    meta.appendChild(btn);

    showHUD('speaking');
    const audio = getAudio();
    audio.onended = hideHUD;
    audio.onerror = () => { console.warn('TTS error'); hideHUD(); };
    audio.play().catch(err => { console.warn('TTS auto-play blocked:', err); hideHUD(); });
  }

  scrollDown();
  return row;
}

// ── Toasts & Scrolling ────────────────────────────────────────────

function toast(msg, type = 'default', ms = 3000) {
  const el = document.createElement('div');
  el.className = `toast${type === 'success' ? ' success' : type === 'error' ? ' error' : ''}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, ms);
}

function scrollDown() {
  requestAnimationFrame(() => { convFeed.scrollTop = convFeed.scrollHeight; });
}

// ── Init ──────────────────────────────────────────────────────────

updateViewDisplay();
