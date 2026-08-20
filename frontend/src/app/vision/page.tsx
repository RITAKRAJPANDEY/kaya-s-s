"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import * as THREE from "three";
import { 
  Camera, 
  Video, 
  User, 
  Box, 
  ScanLine, 
  ShieldCheck, 
  Layers, 
  RotateCcw, 
  Mic, 
  Send, 
  Play, 
  Volume2, 
  Sparkles, 
  BookOpen, 
  Clock, 
  SlidersHorizontal,
  ChevronRight,
  Activity
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────

interface Timings {
  rag_retrieval_ms?: number;
  vision_ms?: number;
  tts_ms?: number;
  total_turn_ms?: number;
}

interface RAGSource {
  title?: string;
  document_name?: string;
  page?: number;
  score?: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "kaya";
  text: string;
  timeString: string;
  timings?: Timings;
  ragUsed?: boolean;
  ragSources?: (string | RAGSource)[];
  audioBase64?: string;
}

interface SystemStatus {
  providers?: {
    stt?: string;
    vision?: string;
    tts?: string;
    rag?: string;
  };
  copilot?: {
    active?: boolean;
    fps?: number;
    tracked_count?: number;
    hazards_count?: number;
  };
}

const SKELETON_BONES: [number, number][] = [
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

export default function VisionPage() {
  const BACKEND_URL = "http://localhost:8001";

  // ── States ────────────────────────────────────────────────────────
  const [activeViewMode, setActiveViewMode] = useState<string>("all");
  const [poseSubMode, setPoseSubMode] = useState<"stream" | "3d">("stream");
  const [frameMode, setFrameMode] = useState<"TEMPORAL_FRAMES" | "SINGLE_FRAME">("TEMPORAL_FRAMES");
  
  const [status, setStatus] = useState<SystemStatus>({});
  const [hudState, setHudState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [streamCacheBuster, setStreamCacheBuster] = useState<number>(Date.now());
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: "default" | "success" | "error" }[]>([]);

  // ── References ───────────────────────────────────────────────────
  const convFeedRef = useRef<HTMLDivElement | null>(null);
  const poseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const spacePressedRef = useRef<boolean>(false);

  // Three.js State Refs
  const threeSceneRef = useRef<THREE.Scene | null>(null);
  const threeCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const threeRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const poseMeshGroupRef = useRef<THREE.Group | null>(null);
  const poseAnimIdRef = useRef<number | null>(null);

  // ── Toast Notification Helper ─────────────────────────────────────
  const addToast = useCallback((msg: string, type: "default" | "success" | "error" = "default") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // ── Scroll to bottom of chat ──────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    if (convFeedRef.current) {
      convFeedRef.current.scrollTop = convFeedRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── Status Polling ────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/status`);
        if (res.ok && isMounted) {
          const data = await res.json();
          setStatus(data);
        }
      } catch {
        // Backend offline / connecting
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [BACKEND_URL]);

  // ── Three.js 3D Pose Viewer Init ──────────────────────────────────
  const initThree = useCallback(() => {
    if (!poseCanvasRef.current || threeRendererRef.current) return;

    const canvas = poseCanvasRef.current;
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || 640;
    const h = parent?.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1d);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(0, 0, 3.8);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio || 1);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x6366f1, 1.4);
    dirLight.position.set(2, 4, 3);
    scene.add(dirLight);

    const grid = new THREE.GridHelper(8, 16, 0x4f46e5, 0x1e293b);
    grid.position.y = -1.6;
    scene.add(grid);

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);

    threeSceneRef.current = scene;
    threeCameraRef.current = camera;
    threeRendererRef.current = renderer;
    poseMeshGroupRef.current = meshGroup;
  }, []);

  const render3DPoseData = useCallback((data: any) => {
    const meshGroup = poseMeshGroupRef.current;
    if (!meshGroup) return;

    while (meshGroup.children.length > 0) {
      const obj = meshGroup.children[0] as any;
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
        else obj.material.dispose();
      }
      meshGroup.remove(obj);
    }

    const poses = data.poses || [];
    const fw = data.frame_width || 1280;
    const fh = data.frame_height || 720;
    if (poses.length === 0) return;

    const jointGeo = new THREE.SphereGeometry(0.045, 12, 12);
    const headGeo = new THREE.SphereGeometry(0.09, 16, 16);

    poses.forEach((pose: any) => {
      const kps = pose.keypoints || [];
      if (kps.length < 17) return;

      const jointVectors: { vec: THREE.Vector3; conf: number }[] = [];
      kps.forEach((kp: any, idx: number) => {
        const normX = (kp.x / fw - 0.5) * 3.2;
        const normY = -(kp.y / fh - 0.5) * 2.4;
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
          meshGroup.add(mesh);
        }
      });

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
          meshGroup.add(line);
        }
      });

      if (jointVectors[0] && jointVectors[0].conf > 0.3 && pose.head_yaw != null) {
        const yawRad = (pose.head_yaw * Math.PI) / 180;
        const gazeDir = new THREE.Vector3(Math.cos(yawRad) * 0.4, 0, Math.sin(yawRad) * 0.4);
        const gazeEnd = jointVectors[0].vec.clone().add(gazeDir);
        const gazeMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, linewidth: 2 });
        const gazeGeo = new THREE.BufferGeometry().setFromPoints([jointVectors[0].vec, gazeEnd]);
        meshGroup.add(new THREE.Line(gazeGeo, gazeMat));
      }
    });
  }, []);

  // 3D Pose Animation Loop
  useEffect(() => {
    let isRunning = true;

    if (activeViewMode === "pose" && poseSubMode === "3d") {
      initThree();

      const animate = async () => {
        if (!isRunning || activeViewMode !== "pose" || poseSubMode !== "3d") return;

        try {
          const res = await fetch(`${BACKEND_URL}/api/pose`);
          if (res.ok) {
            const data = await res.json();
            render3DPoseData(data);
          }
        } catch {
          // Polling catch
        }

        if (threeRendererRef.current && threeSceneRef.current && threeCameraRef.current) {
          threeRendererRef.current.render(threeSceneRef.current, threeCameraRef.current);
        }
        poseAnimIdRef.current = requestAnimationFrame(animate);
      };

      poseAnimIdRef.current = requestAnimationFrame(animate);
    } else {
      if (poseAnimIdRef.current) {
        cancelAnimationFrame(poseAnimIdRef.current);
        poseAnimIdRef.current = null;
      }
    }

    return () => {
      isRunning = false;
      if (poseAnimIdRef.current) {
        cancelAnimationFrame(poseAnimIdRef.current);
        poseAnimIdRef.current = null;
      }
    };
  }, [activeViewMode, poseSubMode, BACKEND_URL, initThree, render3DPoseData]);

  // ── Audio Playback Helper ─────────────────────────────────────────
  const playAudioResponse = (audioBase64?: string) => {
    if (!audioBase64) return;
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
      const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
      currentAudioRef.current = audio;
      setHudState("speaking");
      audio.onended = () => setHudState("idle");
      audio.onerror = () => setHudState("idle");
      audio.play().catch(() => setHudState("idle"));
    } catch {
      setHudState("idle");
    }
  };

  // ── Ask Text Turn ─────────────────────────────────────────────────
  const handleSendText = async (questionText: string) => {
    const q = questionText.trim();
    if (!q || isProcessing) return;

    setInputText("");
    setIsProcessing(true);
    setHudState("thinking");

    const userMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      role: "user",
      text: q,
      timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const fd = new FormData();
      fd.append("question", q);
      fd.append("frame_mode", frameMode);

      const res = await fetch(`${BACKEND_URL}/api/ask-text`, {
        method: "POST",
        body: fd
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server error: ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: Math.random().toString(36).substring(2, 9),
        role: "kaya",
        text: data.response || data.answer || data.text || "No visual hazards detected.",
        timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        timings: data.timings,
        ragUsed: data.rag_used,
        ragSources: data.rag_sources || data.sources || [],
        audioBase64: data.audio_base64
      };

      setMessages((prev) => [...prev, assistantMsg]);
      playAudioResponse(data.audio_base64);
    } catch (err: any) {
      addToast(err.message || "Failed to get AI response", "error");
      setHudState("idle");
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Audio Recording & Push-to-Talk ────────────────────────────────
  const startRecording = async () => {
    if (isRecording || isProcessing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        await submitVoiceTurn(audioBlob);
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start();
      setIsRecording(true);
      setHudState("listening");
    } catch {
      addToast("Microphone access was denied or not found", "error");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const submitVoiceTurn = async (blob: Blob) => {
    setIsProcessing(true);
    setHudState("thinking");

    const tempUserMsgId = Math.random().toString(36).substring(2, 9);
    setMessages((prev) => [
      ...prev,
      {
        id: tempUserMsgId,
        role: "user",
        text: "🎙️ Spoken question...",
        timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      }
    ]);

    try {
      const fd = new FormData();
      fd.append("audio", blob, "recording.wav");
      fd.append("frame_mode", frameMode);

      const res = await fetch(`${BACKEND_URL}/api/ask`, {
        method: "POST",
        body: fd
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server error: ${res.status}`);
      }

      const data = await res.json();

      // Update spoken user transcript
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempUserMsgId
            ? { ...m, text: data.transcript ? `🎙️ "${data.transcript}"` : "🎙️ Spoken Query" }
            : m
        )
      );

      const assistantMsg: ChatMessage = {
        id: Math.random().toString(36).substring(2, 9),
        role: "kaya",
        text: data.response || data.answer || data.text || "Analyzed camera view.",
        timeString: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        timings: data.timings,
        ragUsed: data.rag_used,
        ragSources: data.rag_sources || data.sources || [],
        audioBase64: data.audio_base64
      };

      setMessages((prev) => [...prev, assistantMsg]);
      playAudioResponse(data.audio_base64);
    } catch (err: any) {
      addToast(err.message || "Failed to process audio query", "error");
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsgId));
      setHudState("idle");
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Keyboard Push-to-Talk (<Space>) ───────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space" && !spacePressedRef.current && !isProcessing) {
        e.preventDefault();
        spacePressedRef.current = true;
        startRecording();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && spacePressedRef.current) {
        e.preventDefault();
        spacePressedRef.current = false;
        stopRecording();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isProcessing]);

  // ── Reset Conversation ────────────────────────────────────────────
  const handleResetContext = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/reset`, { method: "POST" });
      setMessages([]);
      setHudState("idle");
      addToast("Conversation context cleared", "success");
    } catch {
      addToast("Failed to reset conversation", "error");
    }
  };

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      width: "100vw",
      backgroundColor: "#f8fafc",
      overflow: "hidden",
      fontFamily: "'Inter', sans-serif"
    }}>
      {/* Navigation Sidebar */}
      <Sidebar />

      {/* Main Workspace */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        height: "100%",
        overflow: "hidden"
      }}>
        {/* Top Header Bar */}
        <header style={{
          height: "64px",
          backgroundColor: "#ffffff",
          borderBottom: "1px solid var(--border-light)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          flexShrink: 0,
          zIndex: 20
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #059669 0%, #0d9488 100%)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(5, 150, 105, 0.25)"
            }}>
              <Camera size={18} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                  Kaya Copilot <span style={{ color: "var(--emerald-primary)" }}>Vision</span>
                </span>
                <span style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: "#10b981",
                  boxShadow: "0 0 8px #10b981"
                }} />
              </div>
              <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 500 }}>
                Real-Time Job Site Safety AI & Multi-Modal Copilot
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* Temporal / Single Frame Mode Toggle */}
            <div style={{
              display: "flex",
              backgroundColor: "#f1f5f9",
              border: "1px solid var(--border-light)",
              borderRadius: "8px",
              padding: "2px",
              gap: "2px"
            }}>
              <button
                onClick={() => {
                  setFrameMode("TEMPORAL_FRAMES");
                  addToast("Mode: Temporal Sequence (6s buffer @ 1 FPS)", "default");
                }}
                style={{
                  padding: "5px 10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: frameMode === "TEMPORAL_FRAMES" ? "#ffffff" : "transparent",
                  color: frameMode === "TEMPORAL_FRAMES" ? "#065f46" : "#64748b",
                  boxShadow: frameMode === "TEMPORAL_FRAMES" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                }}
              >
                🎞️ Temporal
              </button>
              <button
                onClick={() => {
                  setFrameMode("SINGLE_FRAME");
                  addToast("Mode: Single Frame (Instant)", "default");
                }}
                style={{
                  padding: "5px 10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: frameMode === "SINGLE_FRAME" ? "#ffffff" : "transparent",
                  color: frameMode === "SINGLE_FRAME" ? "#065f46" : "#64748b",
                  boxShadow: frameMode === "SINGLE_FRAME" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                }}
              >
                🖼️ Single Frame
              </button>
            </div>

            {/* Provider Badges */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "4px 8px",
                borderRadius: "6px",
                backgroundColor: "#eff6ff",
                color: "#1d4ed8",
                border: "1px solid #bfdbfe"
              }}>
                Vision: {status?.providers?.vision ? status.providers.vision.split(":")[0] : "Gemini"}
              </div>
              <div style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "4px 8px",
                borderRadius: "6px",
                backgroundColor: "#ecfdf5",
                color: "#047857",
                border: "1px solid #a7f3d0"
              }}>
                STT: {status?.providers?.stt ? status.providers.stt.split("/")[0] : "Sarvam"}
              </div>
              <div style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "4px 8px",
                borderRadius: "6px",
                backgroundColor: "#faf5ff",
                color: "#7e22ce",
                border: "1px solid #e9d5ff"
              }}>
                RAG: {status?.providers?.rag ? status.providers.rag.split("_")[0] : "Docling"}
              </div>
            </div>

            {/* Reset Context Button */}
            <button
              onClick={handleResetContext}
              title="Reset Conversation Context"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "6px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border-light)",
                backgroundColor: "#ffffff",
                fontSize: "12px",
                fontWeight: 700,
                color: "#64748b",
                cursor: "pointer",
                transition: "all 0.15s ease"
              }}
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          </div>
        </header>

        {/* Main Content Layout: Side-by-Side Panels */}
        <main style={{
          flex: 1,
          padding: "16px 20px",
          display: "grid",
          gridTemplateColumns: "1.1fr 0.9fr",
          gap: "20px",
          overflow: "hidden"
        }}>
          {/* LEFT: Video Feed & Computer Vision Viewports */}
          <section style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid var(--border-light)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)"
          }}>
            {/* Panel Header & Telemetry Pills */}
            <div style={{
              padding: "12px 18px",
              borderBottom: "1px solid var(--border-light)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0
            }}>
              <span style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Live Safety Vision Stream
              </span>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{
                  padding: "3px 8px",
                  borderRadius: "6px",
                  backgroundColor: "#eff6ff",
                  color: "#1d4ed8",
                  fontSize: "11px",
                  fontWeight: 700,
                  border: "1px solid #bfdbfe"
                }}>
                  ● {status.copilot?.tracked_count ?? 0} objects
                </span>
                <span style={{
                  padding: "3px 8px",
                  borderRadius: "6px",
                  backgroundColor: (status.copilot?.hazards_count || 0) > 0 ? "#fef2f2" : "#ecfdf5",
                  color: (status.copilot?.hazards_count || 0) > 0 ? "#b91c1c" : "#047857",
                  fontSize: "11px",
                  fontWeight: 700,
                  border: (status.copilot?.hazards_count || 0) > 0 ? "1px solid #fecaca" : "1px solid #a7f3d0"
                }}>
                  ● {status.copilot?.hazards_count ?? 0} hazards
                </span>
                <span style={{
                  padding: "3px 8px",
                  borderRadius: "6px",
                  backgroundColor: "#f8fafc",
                  color: "#475569",
                  fontSize: "11px",
                  fontWeight: 700,
                  border: "1px solid #e2e8f0"
                }}>
                  {status.copilot?.fps ? Math.round(status.copilot.fps) : 30} FPS
                </span>
                <span style={{
                  padding: "3px 8px",
                  borderRadius: "6px",
                  backgroundColor: "#faf5ff",
                  color: "#7e22ce",
                  fontSize: "11px",
                  fontWeight: 700,
                  border: "1px solid #e9d5ff"
                }}>
                  Depth V2
                </span>
              </div>
            </div>

            {/* View Mode Switcher Tabs */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "10px 18px",
              backgroundColor: "#f8fafc",
              borderBottom: "1px solid var(--border-light)",
              flexWrap: "wrap",
              flexShrink: 0
            }}>
              {[
                { id: "all", label: "Combined", icon: Layers },
                { id: "raw", label: "Normal", icon: Video },
                { id: "pose", label: "3D Pose", icon: User },
                { id: "depth", label: "Depth Map", icon: Box },
                { id: "ppe", label: "PPE Safety", icon: ShieldCheck },
                { id: "objects", label: "Objects", icon: ScanLine }
              ].map((tab) => {
                const Icon = tab.icon;
                const active = activeViewMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveViewMode(tab.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      border: active ? "1px solid var(--emerald-primary)" : "1px solid var(--border-light)",
                      backgroundColor: active ? "#ecfdf5" : "#ffffff",
                      color: active ? "#065f46" : "#475569",
                      boxShadow: active ? "0 1px 4px rgba(5,150,105,0.15)" : "none",
                      transition: "all 0.15s ease"
                    }}
                  >
                    <Icon size={14} style={{ color: active ? "var(--emerald-primary)" : "#64748b" }} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Video Viewport Stage */}
            <div style={{
              flex: 1,
              backgroundColor: "#0a0f1d",
              position: "relative",
              overflow: "hidden",
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              {/* Primary MJPEG Stream */}
              {!(activeViewMode === "pose" && poseSubMode === "3d") && (
                <img
                  src={`${BACKEND_URL}/api/video_feed?mode=${activeViewMode}&t=${streamCacheBuster}`}
                  alt="Live Copilot Video Feed"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block"
                  }}
                  onError={(e) => {
                    e.currentTarget.style.opacity = "0.3";
                  }}
                  onLoad={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                />
              )}

              {/* 3D Spatial Canvas for Three.js Pose Visualizer */}
              <canvas
                ref={poseCanvasRef}
                style={{
                  width: "100%",
                  height: "100%",
                  display: activeViewMode === "pose" && poseSubMode === "3d" ? "block" : "none"
                }}
              />

              {/* Pose Sub-mode Toggle (shown only in pose mode) */}
              {activeViewMode === "pose" && (
                <div style={{
                  position: "absolute",
                  bottom: "16px",
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  gap: "6px",
                  backgroundColor: "rgba(15, 23, 42, 0.85)",
                  backdropFilter: "blur(8px)",
                  padding: "4px 6px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  zIndex: 10
                }}>
                  <button
                    onClick={() => setPoseSubMode("stream")}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "6px",
                      fontSize: "11px",
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                      backgroundColor: poseSubMode === "stream" ? "var(--emerald-primary)" : "transparent",
                      color: "#ffffff"
                    }}
                  >
                    📹 Stream Overlay
                  </button>
                  <button
                    onClick={() => setPoseSubMode("3d")}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "6px",
                      fontSize: "11px",
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                      backgroundColor: poseSubMode === "3d" ? "var(--emerald-primary)" : "transparent",
                      color: "#ffffff"
                    }}
                  >
                    🌐 3D Spatial Canvas
                  </button>
                </div>
              )}

              {/* Live Status HUD Indicators */}
              <div style={{
                position: "absolute",
                top: "16px",
                left: "16px",
                display: "flex",
                gap: "8px",
                zIndex: 10
              }}>
                {hudState === "listening" && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    backgroundColor: "rgba(239, 68, 68, 0.9)",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 800,
                    backdropFilter: "blur(6px)",
                    boxShadow: "0 2px 10px rgba(239, 68, 68, 0.4)"
                  }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#ffffff" }} />
                    Listening...
                  </div>
                )}
                {hudState === "thinking" && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    backgroundColor: "rgba(79, 70, 229, 0.9)",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 800,
                    backdropFilter: "blur(6px)",
                    boxShadow: "0 2px 10px rgba(79, 70, 229, 0.4)"
                  }}>
                    <Sparkles size={14} />
                    Reasoning...
                  </div>
                )}
                {hudState === "speaking" && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    backgroundColor: "rgba(16, 185, 129, 0.9)",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 800,
                    backdropFilter: "blur(6px)",
                    boxShadow: "0 2px 10px rgba(16, 185, 129, 0.4)"
                  }}>
                    <Volume2 size={14} />
                    Speaking...
                  </div>
                )}
              </div>
            </div>

            {/* Video Footer */}
            <div style={{
              padding: "10px 18px",
              borderTop: "1px solid var(--border-light)",
              backgroundColor: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "11px",
              color: "#64748b",
              fontWeight: 600,
              flexShrink: 0
            }}>
              <span>YOLO26 · Depth Anything V2 · Docling RAG · Google Gemini Multimodal</span>
              <button
                onClick={() => {
                  setStreamCacheBuster(Date.now());
                  addToast("Stream reconnected", "success");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-light)",
                  backgroundColor: "#f8fafc",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#475569",
                  cursor: "pointer"
                }}
              >
                <RotateCcw size={11} />
                Reconnect
              </button>
            </div>
          </section>

          {/* RIGHT: Copilot Chat & Knowledge Base Assistance */}
          <section style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid var(--border-light)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)"
          }}>
            {/* Chat Header */}
            <div style={{
              padding: "12px 18px",
              borderBottom: "1px solid var(--border-light)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Sparkles size={16} style={{ color: "var(--emerald-primary)" }} />
                <span style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Kaya Safety Copilot
                </span>
              </div>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>
                {messages.length} message{messages.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Quick Suggestion Chips */}
            <div style={{
              display: "flex",
              gap: "6px",
              padding: "8px 18px",
              backgroundColor: "#f8fafc",
              borderBottom: "1px solid var(--border-light)",
              overflowX: "auto",
              flexShrink: 0
            }}>
              {[
                { label: "🦺 Check PPE", query: "Are all workers wearing hardhats and safety vests?" },
                { label: "🪜 Ladder SOP", query: "What are the ladder setup rules according to our safety manual?" },
                { label: "⚠️ Hazard Scan", query: "Are there any hazards, tripping risks, or missing gear in view?" },
                { label: "🏗️ Crane Rules", query: "What does the documentation say about mobile crane operation?" }
              ].map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendText(chip.query)}
                  disabled={isProcessing}
                  style={{
                    whiteSpace: "nowrap",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-light)",
                    backgroundColor: "#ffffff",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#334155",
                    cursor: isProcessing ? "not-allowed" : "pointer",
                    transition: "all 0.15s ease"
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Conversational Feed */}
            <div
              ref={convFeedRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                minHeight: 0
              }}
            >
              {messages.length === 0 ? (
                <div style={{
                  padding: "24px 20px",
                  borderRadius: "12px",
                  backgroundColor: "#f8fafc",
                  border: "1px solid var(--border-light)",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "10px",
                  margin: "auto 0"
                }}>
                  <div style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "12px",
                    backgroundColor: "#ecfdf5",
                    color: "var(--emerald-primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    <ShieldCheck size={24} />
                  </div>
                  <h3 style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
                    Kaya Safety Copilot Active
                  </h3>
                  <p style={{ fontSize: "12px", color: "#64748b", maxWidth: "340px", lineHeight: 1.5 }}>
                    Ask real-time questions about the camera feed or site safety manuals using voice or text.
                  </p>
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    textAlign: "left",
                    width: "100%",
                    maxWidth: "340px",
                    marginTop: "6px",
                    fontSize: "11px",
                    color: "#475569"
                  }}>
                    <div style={{ padding: "6px 10px", backgroundColor: "#ffffff", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                      🎙️ Hold <kbd style={{ padding: "2px 4px", borderRadius: "4px", backgroundColor: "#f1f5f9", border: "1px solid #cbd5e1" }}>Space</kbd> or click Push to Talk to speak
                    </div>
                    <div style={{ padding: "6px 10px", backgroundColor: "#ffffff", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                      📖 Knowledge Base queries auto-retrieve Docling SOP chunks
                    </div>
                    <div style={{ padding: "6px 10px", backgroundColor: "#ffffff", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                      🌊 Depth Map tab renders 3D metric distance gradients
                    </div>
                  </div>
                </div>
              ) : (
                messages.map((m) => {
                  const isUser = m.role === "user";
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: isUser ? "flex-end" : "flex-start",
                        gap: "4px",
                        maxWidth: "92%",
                        alignSelf: isUser ? "flex-end" : "flex-start"
                      }}
                    >
                      {/* Bubble */}
                      <div style={{
                        padding: "10px 14px",
                        borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                        backgroundColor: isUser ? "var(--emerald-primary)" : "#f1f5f9",
                        color: isUser ? "#ffffff" : "#0f172a",
                        fontSize: "13px",
                        lineHeight: 1.5,
                        boxShadow: isUser ? "0 2px 8px rgba(5,150,105,0.2)" : "none"
                      }}>
                        {m.text}
                      </div>

                      {/* RAG Citations Box (if returned) */}
                      {!isUser && m.ragUsed && m.ragSources && m.ragSources.length > 0 && (
                        <div style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "8px",
                          backgroundColor: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          fontSize: "11px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px"
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "5px", fontWeight: 800, color: "#166534" }}>
                            <BookOpen size={12} />
                            <span>Knowledge Base Grounding ({m.ragSources.length} sources)</span>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {m.ragSources.map((src, sIdx) => {
                              const title = typeof src === "string" ? src : src.title || src.document_name || "Safety SOP";
                              const page = typeof src === "object" && src.page ? ` (p.${src.page})` : "";
                              return (
                                <span
                                  key={sIdx}
                                  style={{
                                    padding: "2px 6px",
                                    borderRadius: "4px",
                                    backgroundColor: "#ffffff",
                                    border: "1px solid #86efac",
                                    color: "#15803d",
                                    fontWeight: 700
                                  }}
                                >
                                  {title}{page}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Message Meta & Latency breakdown tags */}
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "10px",
                        color: "#94a3b8",
                        fontWeight: 600
                      }}>
                        <span>{m.timeString}</span>

                        {!isUser && m.timings && (
                          <>
                            {m.timings.rag_retrieval_ms != null && m.timings.rag_retrieval_ms > 0 && (
                              <span style={{ padding: "1px 5px", borderRadius: "4px", backgroundColor: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>
                                RAG: {Math.round(m.timings.rag_retrieval_ms)}ms
                              </span>
                            )}
                            {m.timings.vision_ms != null && (
                              <span style={{ padding: "1px 5px", borderRadius: "4px", backgroundColor: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0" }}>
                                VLM: {Math.round(m.timings.vision_ms)}ms
                              </span>
                            )}
                            {m.timings.tts_ms != null && (
                              <span style={{ padding: "1px 5px", borderRadius: "4px", backgroundColor: "#faf5ff", color: "#7e22ce", border: "1px solid #e9d5ff" }}>
                                TTS: {Math.round(m.timings.tts_ms)}ms
                              </span>
                            )}
                            {m.timings.total_turn_ms != null && (
                              <span style={{ padding: "1px 5px", borderRadius: "4px", backgroundColor: "#f1f5f9", color: "#0f172a", fontWeight: 800 }}>
                                Total: {Math.round(m.timings.total_turn_ms)}ms
                              </span>
                            )}
                          </>
                        )}

                        {/* Replay Audio Button */}
                        {!isUser && m.audioBase64 && (
                          <button
                            onClick={() => playAudioResponse(m.audioBase64)}
                            style={{
                              border: "none",
                              background: "none",
                              cursor: "pointer",
                              color: "var(--emerald-primary)",
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              gap: "2px",
                              padding: "0 4px"
                            }}
                          >
                            <Play size={10} />
                            Replay
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Toolbar: Push to Talk & Text Bar */}
            <div style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--border-light)",
              backgroundColor: "#ffffff",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              flexShrink: 0
            }}>
              {/* Push to Talk Bar */}
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  startRecording();
                }}
                onMouseUp={() => {
                  if (isRecording) stopRecording();
                }}
                onMouseLeave={() => {
                  if (isRecording) stopRecording();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startRecording();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  if (isRecording) stopRecording();
                }}
                disabled={isProcessing}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: isRecording ? "1px solid #ef4444" : "1px solid var(--border-light)",
                  backgroundColor: isRecording ? "#fef2f2" : "#f8fafc",
                  color: isRecording ? "#dc2626" : "#334155",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: isProcessing ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  transition: "all 0.15s ease"
                }}
              >
                <Mic size={16} style={{ color: isRecording ? "#ef4444" : "var(--emerald-primary)" }} />
                <span>{isRecording ? "Listening... (Release to send)" : "Push to Talk"}</span>
                <kbd style={{
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #cbd5e1",
                  fontSize: "10px",
                  color: "#64748b"
                }}>
                  Space
                </kbd>
              </button>

              {/* Text Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendText(inputText);
                }}
                style={{
                  display: "flex",
                  gap: "8px"
                }}
              >
                <input
                  type="text"
                  placeholder="Ask about the job site or safety rules..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={isProcessing}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: "1px solid var(--border-light)",
                    backgroundColor: "#f8fafc",
                    fontSize: "13px",
                    color: "#0f172a",
                    outline: "none"
                  }}
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || isProcessing}
                  style={{
                    padding: "0 16px",
                    borderRadius: "10px",
                    border: "none",
                    backgroundColor: !inputText.trim() || isProcessing ? "#cbd5e1" : "var(--emerald-primary)",
                    color: "#ffffff",
                    cursor: !inputText.trim() || isProcessing ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.15s ease"
                  }}
                >
                  <Send size={15} />
                </button>
              </form>
            </div>
          </section>
        </main>
      </div>

      {/* Floating Toast Notification Container */}
      <div style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        zIndex: 9999
      }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: "10px 16px",
              borderRadius: "8px",
              backgroundColor: t.type === "error" ? "#ef4444" : t.type === "success" ? "#10b981" : "#1e293b",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 700,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              animation: "fadeIn 0.2s ease"
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
