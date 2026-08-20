const startBtn = document.getElementById("startBtn");
const nameInput = document.getElementById("nameInput");
const preview = document.getElementById("preview");
const previewTag = document.getElementById("previewTag");
const captureCanvas = document.getElementById("capture");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const siteAlertBanner = document.getElementById("siteAlertBanner");
const bannerIcon = document.getElementById("bannerIcon");
const bannerTitle = document.getElementById("bannerTitle");
const bannerMsg = document.getElementById("bannerMsg");
const bannerDismissBtn = document.getElementById("bannerDismissBtn");

const soundToggleBtn = document.getElementById("soundToggleBtn");
const soundIcon = document.getElementById("soundIcon");
const soundText = document.getElementById("soundText");

const siteStatusBadge = document.getElementById("siteStatusBadge");
const statCameras = document.getElementById("statCameras");
const statPeople = document.getElementById("statPeople");
const statVehicles = document.getElementById("statVehicles");
const statHazards = document.getElementById("statHazards");
const peerCamerasList = document.getElementById("peerCamerasList");
const clientAlertsList = document.getElementById("clientAlertsList");

const TARGET_FPS = 15;
const MAX_BUFFERED_BYTES = 120_000;
const CAPTURE_WIDTH = 480;

let ws = null;
let stream = null;
let sending = false;
let currentClientId = "";
let soundEnabled = localStorage.getItem("worksite_sound_enabled") !== "false";
let audioCtx = null;
let bannerTimeout = null;

// Sound toggle initialization
function updateSoundUI() {
  if (soundEnabled) {
    soundIcon.textContent = "🔊";
    soundText.textContent = "Sound ON";
    soundToggleBtn.classList.remove("muted");
  } else {
    soundIcon.textContent = "🔇";
    soundText.textContent = "Muted";
    soundToggleBtn.classList.add("muted");
  }
}
updateSoundUI();

soundToggleBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("worksite_sound_enabled", soundEnabled ? "true" : "false");
  updateSoundUI();
  if (soundEnabled && !audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
});

function playHazardTone(level) {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const isDanger = level === "danger";
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (isDanger) {
      // Danger: high-pitched alarm pulse
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(660, now + 0.15);
      osc.frequency.setValueAtTime(880, now + 0.30);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } else {
      // Caution: two-tone chime
      osc.type = "sine";
      osc.frequency.setValueAtTime(587, now);
      osc.frequency.setValueAtTime(440, now + 0.12);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch (e) {
    console.debug("Audio play error:", e);
  }
}

function triggerVibration(level) {
  if ("vibrate" in navigator) {
    try {
      if (level === "danger") {
        navigator.vibrate([250, 100, 250, 100, 350]);
      } else {
        navigator.vibrate([150, 80, 150]);
      }
    } catch (e) {
      // Ignore vibration error if blocked
    }
  }
}

function showSiteAlertBanner(alert) {
  const isDanger = alert.level === "danger";
  siteAlertBanner.className = `site-alert-banner ${alert.level || "danger"}`;
  bannerIcon.textContent = isDanger ? "🚨" : "⚠️";
  
  const src = alert.source_client_id === currentClientId ? "YOUR CAMERA" : alert.source_client_id;
  bannerTitle.textContent = `SITE ${alert.level.toUpperCase()} [${src}]`;
  bannerMsg.textContent = `${alert.label}: ${alert.message}`;
  siteAlertBanner.classList.remove("hidden");

  playHazardTone(alert.level);
  triggerVibration(alert.level);

  if (bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => {
    siteAlertBanner.classList.add("hidden");
  }, isDanger ? 8000 : 5000);
}

bannerDismissBtn.addEventListener("click", () => {
  siteAlertBanner.classList.add("hidden");
  if (bannerTimeout) clearTimeout(bannerTimeout);
});

function addAlertToLog(alert) {
  const emptyEl = clientAlertsList.querySelector(".empty-alerts");
  if (emptyEl) emptyEl.remove();

  const row = document.createElement("div");
  row.className = `client-alert-row ${alert.level || "caution"}`;
  const time = new Date((alert.ts || Date.now() / 1000) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const src = alert.source_client_id === currentClientId ? "You" : alert.source_client_id;

  row.innerHTML = `
    <span><span class="alert-source">[${src}]</span>${alert.message}</span>
    <span class="alert-ts">${time}</span>
  `;

  clientAlertsList.prepend(row);
  while (clientAlertsList.children.length > 20) {
    clientAlertsList.removeChild(clientAlertsList.lastChild);
  }
}

function updateSharedPerception(data) {
  const summary = data.summary || {};
  statCameras.textContent = summary.cameras_count ?? (data.clients ? data.clients.length : 0);
  statPeople.textContent = summary.people_count ?? 0;
  statVehicles.textContent = summary.vehicles_count ?? 0;
  statHazards.textContent = summary.threats_count ?? (data.active_threats ? data.active_threats.length : 0);

  // Update Status Badge
  siteStatusBadge.classList.remove("safe", "caution", "danger");
  if (summary.danger_count > 0) {
    siteStatusBadge.textContent = "DANGER";
    siteStatusBadge.classList.add("danger");
  } else if (summary.threats_count > 0) {
    siteStatusBadge.textContent = "CAUTION";
    siteStatusBadge.classList.add("caution");
  } else {
    siteStatusBadge.textContent = "SAFE";
    siteStatusBadge.classList.add("safe");
  }

  // Update Peer Cameras
  if (data.clients && Array.isArray(data.clients)) {
    peerCamerasList.innerHTML = "";
    if (data.clients.length === 0) {
      peerCamerasList.innerHTML = '<span class="no-peers">No peer cameras connected</span>';
    } else {
      data.clients.forEach((cid) => {
        const chip = document.createElement("span");
        const isYou = cid === currentClientId;
        chip.className = `peer-chip${isYou ? " you" : ""}`;
        chip.innerHTML = `<span class="peer-dot"></span>${cid}${isYou ? " (You)" : ""}`;
        peerCamerasList.appendChild(chip);
      });
    }
  }
}

function setStatus(text, cls) {
  statusText.textContent = text;
  statusDot.className = "status-dot" + (cls ? ` ${cls}` : "");
}

function wsUrl(path) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

function openSocket(clientId) {
  const socket = new WebSocket(wsUrl(`/ws/stream/${encodeURIComponent(clientId)}`));
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    setStatus(`Live — Connected to Worksite Mesh (${clientId})`, "live");
    previewTag.textContent = `Broadcasting: ${clientId}`;
    sending = true;
    sendLoop();
  };

  socket.onmessage = (event) => {
    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "blind_spot_alert") {
          // TARGETED BLIND-SPOT HAZARD ALERT
          showSiteAlertBanner({
            level: msg.level || "danger",
            source_client_id: msg.source_client_id,
            label: "🚨 BLIND-SPOT HAZARD",
            message: msg.message || `Threat detected in your blind spot (${msg.distance_m}m away) by ${msg.source_client_id}!`
          });
          addAlertToLog({
            level: "danger",
            source_client_id: msg.source_client_id,
            message: `🚨 BLIND-SPOT HAZARD: ${msg.message || 'Approaching from behind/flank'}`
          });
        } else if (msg.type === "site_alert") {
          showSiteAlertBanner(msg);
          addAlertToLog(msg);
        } else if (msg.type === "site_perception") {
          updateSharedPerception(msg);
        }
      } catch (err) {
        console.debug("Error parsing WebSocket text message:", err);
      }
    }
  };

  socket.onclose = () => {
    setStatus("Disconnected from worksite mesh — retrying…");
    previewTag.textContent = "Camera standby";
    sending = false;
    if (stream) setTimeout(() => { ws = openSocket(clientId); }, 1500);
  };

  socket.onerror = () => socket.close();
  return socket;
}

async function start() {
  currentClientId = (nameInput.value || `cam-${Math.floor(Math.random() * 1000)}`).trim();
  startBtn.disabled = true;
  nameInput.disabled = true;
  setStatus("Requesting camera permissions…");

  // Initialize Web Audio on user gesture
  if (soundEnabled && !audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: TARGET_FPS, max: 30 }
      },
      audio: false,
    });
  } catch (err) {
    setStatus(`Camera error: ${err.message}. Camera access needs HTTPS — see README.`, "error");
    startBtn.disabled = false;
    nameInput.disabled = false;
    return;
  }

  preview.srcObject = stream;
  await preview.play();
  ws = openSocket(currentClientId);
}

function sendLoop() {
  const ctx = captureCanvas.getContext("2d", { willReadFrequently: false });
  const interval = 1000 / TARGET_FPS;

  function tick() {
    if (!sending || !ws || ws.readyState !== WebSocket.OPEN) return;

    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      setTimeout(tick, interval);
      return;
    }

    const vw = preview.videoWidth;
    const vh = preview.videoHeight;

    if (vw && vh) {
      const w = CAPTURE_WIDTH;
      const h = Math.round((w * vh) / vw);

      if (captureCanvas.width !== w || captureCanvas.height !== h) {
        captureCanvas.width = w;
        captureCanvas.height = h;
      }

      ctx.drawImage(preview, 0, 0, w, h);
      captureCanvas.toBlob(
        (blob) => {
          if (blob && ws && ws.readyState === WebSocket.OPEN) {
            blob.arrayBuffer().then((buf) => {
              ws.send(buf);
            });
          }
        },
        "image/jpeg",
        0.6
      );
    }

    setTimeout(tick, interval);
  }

  tick();
}

startBtn.addEventListener("click", start);

