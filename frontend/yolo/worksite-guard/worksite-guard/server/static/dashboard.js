const grid = document.getElementById("feedGrid");
const emptyState = document.getElementById("emptyState");
const clientCountEl = document.getElementById("clientCount");
const workerCountEl = document.getElementById("workerCount");
const hazardCountEl = document.getElementById("hazardCount");
const activeThreatCountBadge = document.getElementById("activeThreatCountBadge");
const alertsList = document.getElementById("alertsList");
const clockEl = document.getElementById("clock");
const tileTemplate = document.getElementById("tileTemplate");

const globalHazardBanner = document.getElementById("globalHazardBanner");
const globalHazardIcon = document.getElementById("globalHazardIcon");
const globalHazardTitle = document.getElementById("globalHazardTitle");
const globalHazardMsg = document.getElementById("globalHazardMsg");
const dismissHazardBtn = document.getElementById("dismissHazardBtn");
const dashSoundBtn = document.getElementById("dashSoundBtn");

const tiles = new Map();              // client_id -> {el, img, canvas, ctx, nameEl, detEl, badgeEl}
const activeDangerKeys = new Map();   // client_id -> Set of "label:message" currently active
let bannerHideTimer = null;
let soundEnabled = localStorage.getItem("worksite_dash_sound") !== "false";
let audioCtx = null;

function tick() {
  clockEl.textContent = new Date().toLocaleTimeString();
}
setInterval(tick, 1000);
tick();

// Sound toggle
function updateSoundUI() {
  if (dashSoundBtn) {
    dashSoundBtn.textContent = soundEnabled ? "🔊 Sound ON" : "🔇 Muted";
    dashSoundBtn.classList.toggle("muted", !soundEnabled);
  }
}
updateSoundUI();

if (dashSoundBtn) {
  dashSoundBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem("worksite_dash_sound", soundEnabled ? "true" : "false");
    updateSoundUI();
    if (soundEnabled && !audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  });
}

function playAlarmSound(isDanger) {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (isDanger) {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(587, now + 0.18);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523, now);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (e) {
    console.debug("Audio play error:", e);
  }
}

function triggerGlobalBanner(alert) {
  const isDanger = alert.level === "danger";
  globalHazardBanner.className = `global-hazard-banner ${alert.level || "danger"}`;
  globalHazardIcon.textContent = isDanger ? "🚨" : "⚠️";
  globalHazardTitle.textContent = `SITE ${alert.level.toUpperCase()} [${alert.source_client_id}]`;
  globalHazardMsg.textContent = `${alert.label}: ${alert.message}`;
  globalHazardBanner.classList.remove("hidden");

  playAlarmSound(isDanger);

  if (bannerHideTimer) clearTimeout(bannerHideTimer);
  bannerHideTimer = setTimeout(() => {
    globalHazardBanner.classList.add("hidden");
  }, isDanger ? 9000 : 5000);
}

if (dismissHazardBtn) {
  dismissHazardBtn.addEventListener("click", () => {
    globalHazardBanner.classList.add("hidden");
    if (bannerHideTimer) clearTimeout(bannerHideTimer);
  });
}

function wsUrl(path) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

function ensureTile(clientId) {
  if (tiles.has(clientId)) return tiles.get(clientId);
  emptyState.style.display = "none";
  const node = tileTemplate.content.cloneNode(true);
  const el = node.querySelector(".tile");
  const img = node.querySelector(".tile-img");
  const canvas = node.querySelector(".tile-canvas");
  const nameEl = node.querySelector(".tile-name");
  const detEl = node.querySelector(".tile-detections");
  const badgeEl = node.querySelector(".tile-threat-badge");
  nameEl.textContent = clientId;
  badgeEl.textContent = "SAFE";
  badgeEl.classList.add("safe");
  grid.appendChild(node);
  const record = { el, img, canvas, ctx: canvas.getContext("2d"), nameEl, detEl, badgeEl };
  tiles.set(clientId, record);
  updateCount();
  return record;
}

function removeTile(clientId) {
  const record = tiles.get(clientId);
  if (!record) return;
  record.el.remove();
  tiles.delete(clientId);
  activeDangerKeys.delete(clientId);
  updateCount();
  if (tiles.size === 0) emptyState.style.display = "block";
}

function updateCount() {
  if (clientCountEl) clientCountEl.childNodes[0].textContent = `${tiles.size} `;
}

function updateSitePerception(data) {
  const summary = data.summary || {};
  if (clientCountEl) clientCountEl.childNodes[0].textContent = `${summary.cameras_count ?? tiles.size} `;
  if (workerCountEl) workerCountEl.childNodes[0].textContent = `${summary.people_count ?? 0} `;
  if (hazardCountEl) {
    const dangerCount = summary.danger_count ?? 0;
    const totalThreats = summary.threats_count ?? 0;
    hazardCountEl.childNodes[0].textContent = `${totalThreats} `;
    hazardCountEl.style.color = dangerCount > 0 ? "var(--danger)" : (totalThreats > 0 ? "var(--caution)" : "var(--green-700)");
  }

  if (activeThreatCountBadge) {
    const threats = summary.threats_count ?? (data.active_threats ? data.active_threats.length : 0);
    activeThreatCountBadge.textContent = `${threats} active`;
    activeThreatCountBadge.className = `threat-badge ${threats > 0 ? "danger" : "safe"}`;
  }
}

function setThreatBadge(record, threats) {
  record.badgeEl.classList.remove("safe", "caution", "danger");
  if (threats.some((t) => t.level === "danger")) {
    record.badgeEl.textContent = "DANGER";
    record.badgeEl.classList.add("danger");
  } else if (threats.some((t) => t.level === "caution")) {
    record.badgeEl.textContent = "CAUTION";
    record.badgeEl.classList.add("caution");
  } else {
    record.badgeEl.textContent = "SAFE";
    record.badgeEl.classList.add("safe");
  }
}

function pushAlert(clientId, threat, ts) {
  const empty = alertsList.querySelector(".alerts-empty");
  if (empty) empty.remove();
  const item = document.createElement("div");
  item.className = `alert-item ${threat.level || "caution"}`;
  const time = new Date((ts || Date.now() / 1000) * 1000).toLocaleTimeString();
  item.innerHTML = `<strong>${clientId}</strong> — ${threat.message}<span class="alert-time">${time}</span>`;
  alertsList.prepend(item);
  while (alertsList.children.length > 60) {
    alertsList.removeChild(alertsList.lastChild);
  }
}

function handleVideoFrame(msg) {
  const record = ensureTile(msg.client_id);
  record.img.src = `data:image/jpeg;base64,${msg.image}`;
}

function handleDetections(msg) {
  const record = ensureTile(msg.client_id);
  record.detEl.textContent = `${msg.detections.length} objects`;
  setThreatBadge(record, msg.threats);
  drawOverlay(record, msg);

  const prevKeys = activeDangerKeys.get(msg.client_id) || new Set();
  const currentKeys = new Set();
  for (const t of msg.threats) {
    if (t.level !== "danger") continue;
    const key = `${t.label}:${t.message}`;
    currentKeys.add(key);
    if (!prevKeys.has(key)) pushAlert(msg.client_id, t, msg.ts);
  }
  activeDangerKeys.set(msg.client_id, currentKeys);
}

function drawOverlay(record, msg) {
  const { canvas, ctx } = record;
  if (canvas.width !== msg.frame_w || canvas.height !== msg.frame_h) {
    canvas.width = msg.frame_w;
    canvas.height = msg.frame_h;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const threatBoxes = msg.threats.filter((t) => t.box).map((t) => t.box);
  const lineWidth = Math.max(2, Math.round(canvas.width / 240));
  const fontSize = Math.max(12, Math.round(canvas.width / 40));
  ctx.font = `${fontSize}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "bottom";
  for (const d of msg.detections) {
    const [x1, y1, x2, y2] = d.box;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const isThreat = threatBoxes.some((b) => cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]);
    const color = isThreat ? "#c53838" : "#2fa860";
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    const label = `${d.label} ${d.confidence.toFixed(2)}`;
    const textY = Math.max(y1 - 4, fontSize + 2);
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(11,18,14,0.75)";
    ctx.fillRect(x1, textY - fontSize - 2, textWidth + 6, fontSize + 6);
    ctx.fillStyle = color;
    ctx.fillText(label, x1 + 3, textY + 2);
  }
}

function connect() {
  const ws = new WebSocket(wsUrl("/ws/dashboard"));
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "video_frame") handleVideoFrame(msg);
    else if (msg.type === "detections") handleDetections(msg);
    else if (msg.type === "site_alert") {
      triggerGlobalBanner(msg);
      pushAlert(msg.source_client_id, msg, msg.ts);
    } else if (msg.type === "site_perception") {
      updateSitePerception(msg);
    } else if (msg.type === "client_offline") {
      removeTile(msg.client_id);
    } else if (msg.type === "roster") {
      msg.clients.forEach(ensureTile);
      updateSitePerception(msg);
    }
  };
  ws.onclose = () => setTimeout(connect, 1500);
  ws.onerror = () => ws.close();
}
connect();

