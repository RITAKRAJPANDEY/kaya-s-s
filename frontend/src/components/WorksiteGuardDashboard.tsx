"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import IncidentAnalysisModal from "@/components/IncidentAnalysisModal";
import { 
  ShieldAlert, 
  Download, 
  Volume2, 
  VolumeX, 
  Camera, 
  Eye, 
  EyeOff, 
  AlertTriangle,
  Clock,
  Video,
  ShieldCheck
} from "lucide-react";

export interface YoloDetection {
  label: string;
  confidence: number;
  box: [number, number, number, number]; // [x1, y1, x2, y2]
}

export interface YoloThreat {
  level: "safe" | "caution" | "danger";
  label: string;
  message: string;
  box?: [number, number, number, number];
}

export interface LiveCameraTile {
  clientId: string;
  name: string;
  imageSrc?: string; // base64 jpeg from server
  detections: YoloDetection[];
  threats: YoloThreat[];
  threatLevel: "safe" | "caution" | "danger";
  lastFrameTime: number;
  frameWidth: number;
  frameHeight: number;
}

export interface ThreatLogItem {
  id: string;
  timeString: string;
  clientId: string;
  level: "danger" | "caution" | "safe";
  label: string;
  message: string;
}

export default function WorksiteGuardDashboard() {
  const [mounted, setMounted] = useState<boolean>(false);
  const [clock, setClock] = useState<string>("");
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState<boolean>(false);

  // Real Camera & Backend state
  const [isWebcamActive, setIsWebcamActive] = useState<boolean>(false);
  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [activeTiles, setActiveTiles] = useState<Map<string, LiveCameraTile>>(new Map());
  const [logs, setLogs] = useState<ThreatLogItem[]>([]);
  const [summary, setSummary] = useState<{
    camerasCount: number;
    peopleCount: number;
    dangerCount: number;
    threatsCount: number;
  }>({
    camerasCount: 0,
    peopleCount: 0,
    dangerCount: 0,
    threatsCount: 0,
  });

  // Global hazard banner
  const [activeBanner, setActiveBanner] = useState<{
    level: "danger" | "caution";
    title: string;
    message: string;
    clientId: string;
  } | null>(null);

  // References
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const webcamOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tileCanvasRefs = useRef<{ [key: string]: HTMLCanvasElement | null }>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bannerTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wsDashRef = useRef<WebSocket | null>(null);
  const wsClientRef = useRef<WebSocket | null>(null);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clock tick & Mount
  useEffect(() => {
    setMounted(true);
    const updateTime = () => setClock(new Date().toLocaleTimeString());
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Alarm Sound Synthesis (dual tone alarm)
  const playAlarmSound = useCallback((isDanger: boolean) => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;

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
    } catch {
      // Audio context policy
    }
  }, [soundEnabled]);

  // Trigger site hazard banner
  const triggerGlobalBanner = useCallback((level: "danger" | "caution", title: string, message: string, clientId: string) => {
    setActiveBanner({ level, title, message, clientId });
    playAlarmSound(level === "danger");

    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => {
      setActiveBanner(null);
    }, level === "danger" ? 9000 : 5000);
  }, [playAlarmSound]);

  // Draw real YOLO bounding boxes on a canvas
  const drawDetections = useCallback((
    canvas: HTMLCanvasElement | null, 
    detections: YoloDetection[], 
    threats: YoloThreat[], 
    frameW: number, 
    frameH: number
  ) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== frameW || canvas.height !== frameH) {
      canvas.width = frameW || 640;
      canvas.height = frameH || 480;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const threatBoxes = threats?.filter(t => t.box).map(t => t.box) || [];
    const lineWidth = Math.max(2, Math.round(canvas.width / 240));
    const fontSize = Math.max(12, Math.round(canvas.width / 40));
    ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
    ctx.textBaseline = "bottom";

    for (const d of detections || []) {
      const [x1, y1, x2, y2] = d.box;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const isThreat = threatBoxes.some(b => b && cx >= b[0] && cx <= b[2] && cy >= b[1] && cy <= b[3]);
      const color = isThreat ? "#c53838" : "#2fa860";

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      const label = `${d.label} ${(d.confidence || 0).toFixed(2)}`;
      const textY = Math.max(y1 - 4, fontSize + 2);
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(11, 18, 14, 0.85)";
      ctx.fillRect(x1, textY - fontSize - 2, textWidth + 6, fontSize + 6);
      ctx.fillStyle = color;
      ctx.fillText(label, x1 + 3, textY + 2);
    }
  }, []);

  // Connect to WorksiteGuard FastAPI WebSocket Hub (`/ws/dashboard`)
  useEffect(() => {
    let isMounted = true;
    let ws: WebSocket | null = null;

    const connectDashboardWs = () => {
      try {
        const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
        const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${host}:8000/ws/dashboard`;

        ws = new WebSocket(wsUrl);
        wsDashRef.current = ws;

        ws.onopen = () => {
          if (isMounted) setBackendConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "video_frame") {
              setActiveTiles(prev => {
                const next = new Map(prev);
                const existing: LiveCameraTile = next.get(msg.client_id) || {
                  clientId: msg.client_id,
                  name: msg.client_id,
                  detections: [],
                  threats: [],
                  threatLevel: "safe",
                  lastFrameTime: Date.now(),
                  frameWidth: 640,
                  frameHeight: 480,
                };
                existing.imageSrc = `data:image/jpeg;base64,${msg.image}`;
                existing.lastFrameTime = Date.now();
                next.set(msg.client_id, existing);
                return next;
              });
            } else if (msg.type === "detections") {
              setActiveTiles(prev => {
                const next = new Map(prev);
                const existing: LiveCameraTile = next.get(msg.client_id) || {
                  clientId: msg.client_id,
                  name: msg.client_id,
                  detections: [],
                  threats: [],
                  threatLevel: "safe",
                  lastFrameTime: Date.now(),
                  frameWidth: msg.frame_w || 640,
                  frameHeight: msg.frame_h || 480,
                };
                existing.detections = msg.detections || [];
                existing.threats = msg.threats || [];
                existing.frameWidth = msg.frame_w || existing.frameWidth;
                existing.frameHeight = msg.frame_h || existing.frameHeight;

                if (existing.threats.some(t => t.level === "danger")) {
                  existing.threatLevel = "danger";
                } else if (existing.threats.some(t => t.level === "caution")) {
                  existing.threatLevel = "caution";
                } else {
                  existing.threatLevel = "safe";
                }

                next.set(msg.client_id, existing);

                // Draw overlay
                drawDetections(
                  tileCanvasRefs.current[msg.client_id] || null,
                  existing.detections,
                  existing.threats,
                  existing.frameWidth,
                  existing.frameHeight
                );

                return next;
              });
            } else if (msg.type === "site_alert") {
              triggerGlobalBanner(
                msg.level || "danger",
                `SITE ${msg.level.toUpperCase()} [${msg.source_client_id}]`,
                `${msg.label}: ${msg.message}`,
                msg.source_client_id
              );
              setLogs(prev => [
                {
                  id: `log-${Date.now()}-${Math.random()}`,
                  timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
                  clientId: msg.source_client_id,
                  level: msg.level || "danger",
                  label: msg.label || "Threat",
                  message: msg.message,
                },
                ...prev.slice(0, 80)
              ]);
            } else if (msg.type === "site_perception") {
              const sum = msg.summary || {};
              setSummary({
                camerasCount: sum.cameras_count ?? 0,
                peopleCount: sum.people_count ?? 0,
                dangerCount: sum.danger_count ?? 0,
                threatsCount: sum.threats_count ?? 0,
              });
            } else if (msg.type === "client_offline") {
              setActiveTiles(prev => {
                const next = new Map(prev);
                next.delete(msg.client_id);
                return next;
              });
            } else if (msg.type === "roster") {
              if (msg.summary) {
                setSummary({
                  camerasCount: msg.summary.cameras_count ?? 0,
                  peopleCount: msg.summary.people_count ?? 0,
                  dangerCount: msg.summary.danger_count ?? 0,
                  threatsCount: msg.summary.threats_count ?? 0,
                });
              }
            }
          } catch {
            // handle parse error
          }
        };

        ws.onclose = () => {
          if (isMounted) setBackendConnected(false);
          setTimeout(connectDashboardWs, 3000);
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        // ws unsupported or offline
      }
    };

    connectDashboardWs();

    return () => {
      isMounted = false;
      if (wsDashRef.current) wsDashRef.current.close();
    };
  }, [drawDetections, triggerGlobalBanner]);

  // Real Camera Feed toggler
  const toggleLocalWebcam = async () => {
    if (isWebcamActive) {
      // Stop webcam
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
      if (wsClientRef.current) wsClientRef.current.close();
      if (webcamVideoRef.current && webcamVideoRef.current.srcObject) {
        const stream = webcamVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        webcamVideoRef.current.srcObject = null;
      }
      setIsWebcamActive(false);
    } else {
      // Start real webcam
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false
        });

        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = mediaStream;
          webcamVideoRef.current.play();
        }

        setIsWebcamActive(true);

        // Attempt WebSocket streaming of local webcam frames to YOLO server if server is running
        try {
          const host = window.location.hostname;
          const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          const clientWs = new WebSocket(`${protocol}//${host}:8000/ws/client/laptop-cam`);
          wsClientRef.current = clientWs;

          clientWs.onopen = () => {
            // Stream frames at 10 FPS to backend YOLO detector
            streamIntervalRef.current = setInterval(() => {
              if (!webcamVideoRef.current || !captureCanvasRef.current || clientWs.readyState !== WebSocket.OPEN) return;
              const video = webcamVideoRef.current;
              const canvas = captureCanvasRef.current;
              if (video.videoWidth === 0) return;

              canvas.width = 480;
              canvas.height = Math.round(480 * (video.videoHeight / video.videoWidth)) || 360;
              const ctx = canvas.getContext("2d");
              if (!ctx) return;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

              const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
              const b64 = dataUrl.split(",")[1];
              clientWs.send(JSON.stringify({ type: "frame", image: b64, ts: Date.now() / 1000 }));
            }, 100);
          };

          clientWs.onmessage = (e) => {
            try {
              const msg = JSON.parse(e.data);
              if (msg.type === "detections" && webcamOverlayCanvasRef.current) {
                drawDetections(
                  webcamOverlayCanvasRef.current,
                  msg.detections || [],
                  msg.threats || [],
                  msg.frame_w || 480,
                  msg.frame_h || 360
                );
              }
            } catch {
              // ignore
            }
          };
        } catch {
          // local stream works standalone
        }

      } catch (err) {
        alert("Failed to access camera: " + (err as Error).message);
      }
    }
  };

  // Export audit CSV
  const exportAuditLog = () => {
    if (logs.length === 0) {
      alert("No incidents currently in the audit trail.");
      return;
    }
    const headers = "Time,Camera ID,Threat Level,Category,Incident Description\n";
    const rows = logs.map(l => `"${l.timeString}","${l.clientId}","${l.level}","${l.label}","${l.message}"`).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `worksite_guard_audit_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tileList = Array.from(activeTiles.values());
  const effectiveCameraCount = (isWebcamActive ? 1 : 0) + tileList.length;
  const filteredLogs = logs.filter(l => filterLevel === "all" || l.level === filterLevel);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "20px",
      width: "100%",
      fontFamily: "'Inter', sans-serif"
    }}>
      {/* Global Hazard Warning Banner */}
      {activeBanner && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          backgroundColor: activeBanner.level === "danger" ? "#c53838" : "#b8791b",
          color: "#ffffff",
          borderRadius: "10px",
          boxShadow: "0 6px 20px rgba(197, 56, 56, 0.35)",
          animation: "pulse 2s infinite"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "22px" }}>{activeBanner.level === "danger" ? "🚨" : "⚠️"}</span>
            <div>
              <strong style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase", marginRight: "8px" }}>
                {activeBanner.title}
              </strong>
              <span style={{ fontSize: "13px", fontWeight: 500 }}>{activeBanner.message}</span>
            </div>
          </div>
          <button
            onClick={() => setActiveBanner(null)}
            style={{
              background: "rgba(255, 255, 255, 0.25)",
              border: "none",
              color: "#fff",
              fontSize: "18px",
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Top Header Strip */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "#ffffff",
        padding: "16px 24px",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-light)",
        boxShadow: "var(--shadow-sm)",
        flexWrap: "wrap",
        gap: "16px"
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "36px",
            height: "36px",
            borderRadius: "9px",
            background: "linear-gradient(135deg, #059669 0%, #047857 100%)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 8px rgba(5, 150, 105, 0.3)"
          }}>
            <ShieldAlert size={20} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h1 style={{ fontSize: "17px", fontWeight: 900, color: "#0f172a", margin: 0, letterSpacing: "-0.01em" }}>
                WORKSITE<span style={{ color: "#059669" }}>GUARD</span>
              </h1>
              <span style={{
                fontSize: "10px",
                fontWeight: 800,
                padding: "2px 7px",
                borderRadius: "4px",
                backgroundColor: "#ecfdf5",
                color: "#065f46",
                border: "1px solid #a7f3d0",
                letterSpacing: "0.05em"
              }}>
                LIVE YOLO HUB
              </span>
              {backendConnected ? (
                <span style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  padding: "2px 7px",
                  borderRadius: "4px",
                  backgroundColor: "#eff6ff",
                  color: "#1d4ed8",
                  border: "1px solid #bfdbfe",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px"
                }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#2563eb" }} />
                  YOLO BACKEND CONNECTED
                </span>
              ) : (
                <span style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  padding: "2px 7px",
                  borderRadius: "4px",
                  backgroundColor: "#f8fafc",
                  color: "#64748b",
                  border: "1px solid #e2e8f0"
                }}>
                  STANDALONE BROWSER FEED
                </span>
              )}
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "2px 0 0 0" }}>
              Live camera streaming, real-time YOLO object detection, and automated spatial threat engine.
            </p>
          </div>
        </div>

        {/* Quick Actions & Status Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {/* Start Real WebCam */}
          <button
            onClick={toggleLocalWebcam}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 14px",
              borderRadius: "8px",
              border: isWebcamActive ? "1.5px solid #059669" : "1px solid var(--border-light)",
              backgroundColor: isWebcamActive ? "#ecfdf5" : "#0f172a",
              color: isWebcamActive ? "#065f46" : "#ffffff",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: isWebcamActive ? "none" : "0 2px 6px rgba(15, 23, 42, 0.2)"
            }}
          >
            <Camera size={15} />
            <span>{isWebcamActive ? "Stop Local Camera" : "Start Local Camera Feed"}</span>
          </button>

          {/* Sound Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 12px",
              borderRadius: "8px",
              border: "1px solid var(--border-light)",
              backgroundColor: soundEnabled ? "#ecfdf5" : "#f8fafc",
              color: soundEnabled ? "#065f46" : "#64748b",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span>{soundEnabled ? "Audio ON" : "Muted"}</span>
          </button>

          {/* Case Study Incident Button */}
          <button
            onClick={() => setIsIncidentModalOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 14px",
              borderRadius: "8px",
              backgroundColor: "#fee2e2",
              color: "#dc2626",
              fontSize: "12px",
              fontWeight: 800,
              border: "1.5px solid #fca5a5",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(239, 68, 68, 0.2)"
            }}
          >
            <ShieldAlert size={14} />
            <span>🚨 Incident Case Study</span>
          </button>

          {/* Export Audit Log Button */}
          <button
            onClick={exportAuditLog}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 12px",
              borderRadius: "8px",
              backgroundColor: "#ffffff",
              color: "#0f172a",
              fontSize: "12px",
              fontWeight: 700,
              border: "1px solid var(--border-light)",
              cursor: "pointer"
            }}
          >
            <Download size={14} />
            <span>Export CSV</span>
          </button>

          {/* Clock */}
          <div 
            suppressHydrationWarning
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--text-secondary)",
              padding: "6px 10px",
              backgroundColor: "var(--bg-card-muted)",
              borderRadius: "6px"
            }}
          >
            <Clock size={13} />
            <span suppressHydrationWarning>{mounted ? clock : "00:00:00"}</span>
          </div>
        </div>
      </div>

      {/* Real Metric Cards Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "12px", border: "1px solid var(--border-light)", boxShadow: "var(--shadow-sm)" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Cameras Streaming</span>
          <div style={{ fontSize: "24px", fontWeight: 900, color: effectiveCameraCount > 0 ? "#059669" : "#64748b", marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>{effectiveCameraCount}</span>
            {effectiveCameraCount > 0 && (
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#10b981" }} className="pulse-active" />
            )}
          </div>
          <span style={{ fontSize: "11px", color: effectiveCameraCount > 0 ? "var(--emerald-primary)" : "var(--text-muted)", fontWeight: 600 }}>
            {effectiveCameraCount > 0 ? "Live video feeds active" : "No camera stream attached"}
          </span>
        </div>

        <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "12px", border: "1px solid var(--border-light)", boxShadow: "var(--shadow-sm)" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Tracked Targets & Objects</span>
          <div style={{ fontSize: "24px", fontWeight: 900, color: "#0f172a", marginTop: "4px" }}>
            {summary.peopleCount}
          </div>
          <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>Real-time YOLO detections</span>
        </div>

        <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "12px", border: "1px solid var(--border-light)", boxShadow: "var(--shadow-sm)" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Active Site Threats</span>
          <div style={{ fontSize: "24px", fontWeight: 900, color: summary.dangerCount > 0 ? "#c53838" : (summary.threatsCount > 0 ? "#b8791b" : "#059669"), marginTop: "4px" }}>
            {summary.threatsCount}
          </div>
          <span style={{ fontSize: "11px", color: summary.dangerCount > 0 ? "#c53838" : "var(--emerald-primary)", fontWeight: 600 }}>
            {summary.dangerCount > 0 ? `${summary.dangerCount} Danger threat active` : "Zero critical violations"}
          </span>
        </div>

        <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "12px", border: "1px solid var(--border-light)", boxShadow: "var(--shadow-sm)" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Threat Perception Matrix</span>
          <div style={{ fontSize: "24px", fontWeight: 900, color: "#059669", marginTop: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span>ACTIVE</span>
          </div>
          <span style={{ fontSize: "11px", color: "var(--emerald-primary)", fontWeight: 600 }}>
            FOV & Blind-Spot Engine Online
          </span>
        </div>
      </div>

      {/* Main Real Feed Grid + Real Incident Log */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "20px", alignItems: "start" }}>
        
        {/* Real Camera Feed Grid */}
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-light)",
          padding: "20px",
          boxShadow: "var(--shadow-sm)",
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Video size={18} style={{ color: "#059669" }} />
              <h2 style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
                Live Worksite Camera Mesh
              </h2>
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
              {effectiveCameraCount} Feed{effectiveCameraCount !== 1 ? "s" : ""} Online
            </span>
          </div>

          {/* Empty State when no real camera is connected */}
          {effectiveCameraCount === 0 && (
            <div style={{
              border: "1.5px dashed var(--border-light)",
              borderRadius: "10px",
              padding: "60px 20px",
              textAlign: "center",
              color: "var(--text-secondary)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "14px"
            }}>
              <div style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                backgroundColor: "#f0fdf4",
                color: "#059669",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <Camera size={24} />
              </div>
              <div>
                <p style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  No cameras currently streaming to the worksite mesh
                </p>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
                  Start your local device camera below, or stream from phones/Raspberry Pis via WorksiteGuard client.
                </p>
              </div>
              <button
                onClick={toggleLocalWebcam}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  backgroundColor: "#059669",
                  color: "#ffffff",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(5, 150, 105, 0.3)"
                }}
              >
                <Camera size={16} />
                <span>Start Local Camera Feed</span>
              </button>
            </div>
          )}

          {/* Local WebCam Feed Tile */}
          {isWebcamActive && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{
                position: "relative",
                aspectRatio: "16/9",
                backgroundColor: "#0b120e",
                borderRadius: "8px",
                overflow: "hidden",
                border: "2px solid #059669",
                boxShadow: "0 4px 15px rgba(5, 150, 105, 0.2)"
              }}>
                {/* Cyberpunk corner brackets */}
                <span style={{ position: "absolute", top: "8px", left: "8px", width: "16px", height: "16px", borderTop: "2px solid #2fa860", borderLeft: "2px solid #2fa860", zIndex: 3 }} />
                <span style={{ position: "absolute", top: "8px", right: "8px", width: "16px", height: "16px", borderTop: "2px solid #2fa860", borderRight: "2px solid #2fa860", zIndex: 3 }} />
                <span style={{ position: "absolute", bottom: "8px", left: "8px", width: "16px", height: "16px", borderBottom: "2px solid #2fa860", borderLeft: "2px solid #2fa860", zIndex: 3 }} />
                <span style={{ position: "absolute", bottom: "8px", right: "8px", width: "16px", height: "16px", borderBottom: "2px solid #2fa860", borderRight: "2px solid #2fa860", zIndex: 3 }} />

                {/* Real HTML Video element */}
                <video 
                  ref={webcamVideoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} 
                />

                {/* Real-time YOLO canvas detection overlay */}
                <canvas
                  ref={webcamOverlayCanvasRef}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 2 }}
                />

                {/* Camera Overlay Badge */}
                <div style={{
                  position: "absolute",
                  left: "12px",
                  bottom: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "12px",
                  color: "#eafaf0",
                  zIndex: 4,
                  backgroundColor: "rgba(11, 18, 14, 0.8)",
                  padding: "4px 8px",
                  borderRadius: "4px"
                }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#10b981" }} className="pulse-active" />
                  <span>LOCAL CAMERA FEED [LIVE]</span>
                </div>
              </div>

              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "11px",
                color: "var(--text-secondary)"
              }}>
                <span>📍 Device Local Feed</span>
                <span style={{ fontWeight: 800, color: "#059669" }}>STREAMING</span>
              </div>
            </div>
          )}

          {/* Remote Connected Camera Feeds from WebSocket Backend */}
          {tileList.length > 0 && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "16px"
            }}>
              {tileList.map((tile) => {
                const isDanger = tile.threatLevel === "danger";
                const isCaution = tile.threatLevel === "caution";

                return (
                  <div key={tile.clientId} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{
                      position: "relative",
                      aspectRatio: "4/3",
                      backgroundColor: "#0b120e",
                      borderRadius: "8px",
                      overflow: "hidden",
                      border: isDanger ? "1.5px solid #c53838" : (isCaution ? "1.5px solid #b8791b" : "1px solid var(--border-light)")
                    }}>
                      {/* Cyberpunk Tactical Brackets */}
                      <span style={{ position: "absolute", top: "6px", left: "6px", width: "12px", height: "12px", borderTop: "2px solid #2fa860", borderLeft: "2px solid #2fa860", zIndex: 3 }} />
                      <span style={{ position: "absolute", top: "6px", right: "6px", width: "12px", height: "12px", borderTop: "2px solid #2fa860", borderRight: "2px solid #2fa860", zIndex: 3 }} />
                      <span style={{ position: "absolute", bottom: "6px", left: "6px", width: "12px", height: "12px", borderBottom: "2px solid #2fa860", borderLeft: "2px solid #2fa860", zIndex: 3 }} />
                      <span style={{ position: "absolute", bottom: "6px", right: "6px", width: "12px", height: "12px", borderBottom: "2px solid #2fa860", borderRight: "2px solid #2fa860", zIndex: 3 }} />

                      {/* Real remote camera image */}
                      {tile.imageSrc ? (
                        <img 
                          src={tile.imageSrc} 
                          alt={tile.clientId} 
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} 
                        />
                      ) : (
                        <div style={{ width: "100%", height: "100%", backgroundColor: "#0b120e" }} />
                      )}

                      {/* Canvas Overlay for YOLO detections */}
                      <canvas
                        ref={(el) => { tileCanvasRefs.current[tile.clientId] = el; }}
                        width={tile.frameWidth || 320}
                        height={tile.frameHeight || 240}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 2 }}
                      />

                      {/* Camera Name & Live Badge */}
                      <div style={{
                        position: "absolute",
                        left: "10px",
                        bottom: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "11px",
                        color: "#eafaf0",
                        zIndex: 4,
                        backgroundColor: "rgba(11, 18, 14, 0.75)",
                        padding: "2px 6px",
                        borderRadius: "4px"
                      }}>
                        <span style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          backgroundColor: isDanger ? "#c53838" : "#2fa860"
                        }} />
                        <span>{tile.name}</span>
                      </div>
                    </div>

                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "11px",
                      color: "var(--text-secondary)"
                    }}>
                      <span>{tile.detections.length} objects detected</span>
                      <span style={{
                        fontWeight: 800,
                        color: isDanger ? "#c53838" : (isCaution ? "#b8791b" : "#059669")
                      }}>
                        {tile.threatLevel.toUpperCase()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Hidden capture canvas for frame extraction */}
          <canvas ref={captureCanvasRef} style={{ display: "none" }} />
        </div>

        {/* Real Site Threat Log / Incident Audit Trail */}
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-light)",
          padding: "20px",
          boxShadow: "var(--shadow-sm)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: "420px"
        }}>
          {/* Threat Log Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertTriangle size={17} style={{ color: logs.length > 0 ? "#c53838" : "#059669" }} />
              <h3 style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a", margin: 0, textTransform: "uppercase" }}>
                Site Threat Log
              </h3>
            </div>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "11px",
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: "4px",
              backgroundColor: summary.threatsCount > 0 ? "#fee2e2" : "#eafaf0",
              color: summary.threatsCount > 0 ? "#c53838" : "#059669"
            }}>
              {summary.threatsCount} active
            </span>
          </div>

          {/* Severity Filter Tabs */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
            {["all", "danger", "caution", "safe"].map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                style={{
                  flex: 1,
                  padding: "4px 0",
                  fontSize: "11px",
                  fontWeight: 700,
                  borderRadius: "6px",
                  border: filterLevel === lvl ? "1px solid #059669" : "1px solid var(--border-light)",
                  backgroundColor: filterLevel === lvl ? "#ecfdf5" : "#ffffff",
                  color: filterLevel === lvl ? "#065f46" : "var(--text-secondary)",
                  cursor: "pointer",
                  textTransform: "capitalize"
                }}
              >
                {lvl}
              </button>
            ))}
          </div>

          {/* Incident List */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            overflowY: "auto",
            flex: 1,
            paddingRight: "2px"
          }}>
            {filteredLogs.length === 0 ? (
              <div style={{
                textAlign: "center",
                padding: "30px 10px",
                color: "var(--text-muted)",
                fontSize: "12px"
              }}>
                <ShieldCheck size={28} style={{ color: "#059669", margin: "0 auto 8px auto", display: "block" }} />
                <p style={{ margin: 0, fontWeight: 600 }}>No threats detected across site</p>
                <span style={{ fontSize: "11px" }}>Audit trail is clear and safe.</span>
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isDanger = log.level === "danger";
                const isCaution = log.level === "caution";

                return (
                  <div
                    key={log.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: "6px",
                      backgroundColor: isDanger ? "#fff1f2" : (isCaution ? "#fffbeb" : "#f8fafc"),
                      borderLeft: `3px solid ${isDanger ? "#c53838" : (isCaution ? "#b8791b" : "#2fa860")}`,
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "11px",
                        fontWeight: 800,
                        color: isDanger ? "#9f1239" : (isCaution ? "#92400e" : "#065f46")
                      }}>
                        {log.clientId}
                      </span>
                      <span 
                        suppressHydrationWarning
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "10px",
                          color: "var(--text-muted)"
                        }}
                      >
                        {log.timeString}
                      </span>
                    </div>

                    <p style={{
                      fontSize: "12px",
                      color: isDanger ? "#881337" : (isCaution ? "#78350f" : "#334155"),
                      margin: 0,
                      lineHeight: 1.35,
                      fontWeight: 500
                    }}>
                      <strong>{log.label}:</strong> {log.message}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Real Incident Analysis Video & Spatial Reconstruction Modal */}
      <IncidentAnalysisModal
        isOpen={isIncidentModalOpen}
        onClose={() => setIsIncidentModalOpen(false)}
      />
    </div>
  );
}
