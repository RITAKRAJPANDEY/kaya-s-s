"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import Must3rViewer, { SceneData } from "@/components/Must3rViewer";
import { 
  Activity, 
  Compass, 
  Cpu, 
  Layers, 
  Sparkles, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertCircle, 
  Sliders, 
  RefreshCw, 
  Maximize2, 
  Terminal,
  Box,
  Film,
  ExternalLink,
  Eye,
  Tv
} from "lucide-react";

interface DatasetItem {
  id: string;
  name: string;
  type: string;
  path?: string;
  frame_count?: number;
  recommended_res?: number;
  fps?: number;
}

interface CheckpointItem {
  id: string;
  filename: string;
  size_mb: number;
  resolution: number;
  is_default: boolean;
}

export default function SlamPage() {
  // Primary View Mode: Native Gradio + Embedded Viser Studio ("gradio" | "viser3d" | "webgl" | "extractor" | "odometry" | "logs")
  const [viewMode, setViewMode] = useState<"gradio" | "viser3d" | "webgl" | "extractor" | "odometry" | "logs">("gradio");

  // Viser & Gradio URLs using explicit 127.0.0.1 IPv4 address to prevent browser localhost/IPv6 iframe refusal
  const [viserUrl, setViserUrl] = useState<string>("http://127.0.0.1:8080/?fixedDpr=1");
  const [gradioUrl, setGradioUrl] = useState<string>("http://127.0.0.1:7860");
  const [isLaunchingViser, setIsLaunchingViser] = useState<boolean>(false);
  const [viserStatus, setViserStatus] = useState<"idle" | "launching" | "ready" | "error">("idle");

  // Data & Scene State
  const [sceneData, setSceneData] = useState<SceneData | null>(null);
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  
  // Controls State
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("frames_active");
  const [customPath, setCustomPath] = useState<string>("WhatsApp Video 2026-08-20 at 23.28.57.mp4");
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string>("MUSt3R_512.pth");
  const [executionMode, setExecutionMode] = useState<string>("linseq");
  const [resolution, setResolution] = useState<number>(512);
  const [subsample, setSubsample] = useState<number>(2);
  const [extractFps, setExtractFps] = useState<number>(5);

  // Extraction State
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [extractedFrameCount, setExtractedFrameCount] = useState<number | null>(null);

  // Job Execution State
  const [isReconstructing, setIsReconstructing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [processedFrames, setProcessedFrames] = useState<number>(0);
  const [totalFrames, setTotalFrames] = useState<number>(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoadingScene, setIsLoadingScene] = useState<boolean>(false);

  // Active Inspection State
  const [selectedFrameIdx, setSelectedFrameIdx] = useState<number | null>(0);

  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // 1. Auto-launch native MUSt3R Viser Studio on mount
  const launchNativeViserStudio = useCallback(async () => {
    setIsLaunchingViser(true);
    setViserStatus("launching");
    setLogs((prev) => [...prev, "[MUSt3R Native] Launching official Viser 3D Studio & Gradio pipeline on CUDA..."]);

    try {
      const res = await fetch("/api/slam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "viser" })
      });
      const data = await res.json();
      
      let vUrl = data.viser_url ? (data.viser_url.includes("?") ? data.viser_url : `${data.viser_url}/?fixedDpr=1`) : "http://127.0.0.1:8080/?fixedDpr=1";
      let gUrl = data.gradio_url || "http://127.0.0.1:7860";

      vUrl = vUrl.replace("localhost", "127.0.0.1");
      gUrl = gUrl.replace("localhost", "127.0.0.1");

      setViserUrl(vUrl);
      setGradioUrl(gUrl);
      setViserStatus("ready");
      setLogs((prev) => [
        ...prev,
        `[MUSt3R Native] Viser 3D Viewer active at ${vUrl}`,
        `[MUSt3R Native] Gradio Controls active at ${gUrl}`
      ]);
    } catch (err: any) {
      console.warn("Failed to launch Viser studio automatically:", err);
      setViserStatus("error");
      setLogs((prev) => [...prev, `[MUSt3R Native Warning] ${err.message}. Click "Relaunch Native Viser Studio" to retry.`]);
    } finally {
      setIsLaunchingViser(false);
    }
  }, []);

  useEffect(() => {
    launchNativeViserStudio();
  }, [launchNativeViserStudio]);

  // 2. Fetch available datasets & checkpoints
  const fetchDatasets = useCallback(() => {
    fetch("/api/slam?action=datasets")
      .then((res) => res.json())
      .then((data) => {
        if (data.datasets) {
          setDatasets(data.datasets);
          const active = data.datasets.find((d: any) => d.id === "frames_active");
          if (active) setSelectedDatasetId("frames_active");
          else if (data.datasets[0]) setSelectedDatasetId(data.datasets[0].id);
        }
        if (data.checkpoints) setCheckpoints(data.checkpoints);
      })
      .catch((err) => console.warn("Failed to load SLAM datasets:", err));
  }, []);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  // 3. Load 3D Point Cloud & Trajectory Scene Data for Inspector
  const loadScene = useCallback((datasetId?: string, customPly?: string) => {
    setIsLoadingScene(true);
    const query = new URLSearchParams({ action: "scene" });
    if (datasetId) query.set("dataset_id", datasetId);
    if (customPly) query.set("custom_ply_path", customPly);

    fetch(`/api/slam?${query.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setSceneData(data);
        if (data.poses && data.poses.length > 0) {
          setSelectedFrameIdx(data.poses[0].frame_idx);
        }
      })
      .catch((err) => console.error("Error loading SLAM scene:", err))
      .finally(() => setIsLoadingScene(false));
  }, []);

  useEffect(() => {
    if (viewMode === "odometry" || viewMode === "webgl") {
      loadScene(selectedDatasetId);
    }
  }, [viewMode, selectedDatasetId, loadScene]);

  // 4. Poll active job status if running
  useEffect(() => {
    if (!isReconstructing) return;

    const interval = setInterval(() => {
      fetch("/api/slam?action=status")
        .then((res) => res.json())
        .then((data) => {
          if (data.status === "running") {
            setProgress(data.progress || 0);
            setProcessedFrames(data.processed_frames || 0);
            setTotalFrames(data.total_frames || 0);
            if (data.logs) setLogs(data.logs);
          } else if (data.status === "completed") {
            setIsReconstructing(false);
            setProgress(1.0);
            if (data.logs) setLogs(data.logs);
            loadScene();
          } else if (data.status === "failed" || data.status === "cancelled") {
            setIsReconstructing(false);
            if (data.logs) setLogs(data.logs);
          }
        })
        .catch(() => {});
    }, 1200);

    return () => clearInterval(interval);
  }, [isReconstructing, loadScene]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Extract Frames via FFmpeg
  const handleExtractFrames = async () => {
    setIsExtracting(true);
    setLogs((prev) => [
      ...prev,
      `[FFmpeg] Extracting frames from "${customPath}" @ ${extractFps} FPS (q:v 2)...`
    ]);

    try {
      const res = await fetch("/api/slam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "extract",
          video_path: customPath,
          fps: extractFps
        })
      });
      const data = await res.json();
      if (data.status === "ok") {
        setExtractedFrameCount(data.frame_count);
        setLogs((prev) => [
          ...prev,
          `[FFmpeg] Successfully extracted ${data.frame_count} frames into "${data.output_dir}"`
        ]);
        fetchDatasets();
        setSelectedDatasetId("frames_active");
      } else {
        setLogs((prev) => [...prev, `[FFmpeg Error] ${data.error || "Extraction failed"}`]);
      }
    } catch (err: any) {
      setLogs((prev) => [...prev, `[FFmpeg Error] ${err.message}`]);
    } finally {
      setIsExtracting(false);
    }
  };

  // Trigger GPU Reconstruction
  const handleStartReconstruction = async () => {
    setIsReconstructing(true);
    setProgress(0.05);
    setLogs([
      `Initializing MUSt3R 3D SLAM Engine on [${selectedDatasetId}]...`,
      `Target Path: ${customPath || "Active frames"}`,
      `Mode: ${executionMode.toUpperCase()} | Resolution: ${resolution}x${resolution} | Subsample: 1/${subsample}`,
      "Loading pre-trained ViT-L asymmetric feature encoder & memory-augmented decoder..."
    ]);

    try {
      const res = await fetch("/api/slam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reconstruct",
          dataset_id: selectedDatasetId,
          custom_path: customPath,
          execution_mode: executionMode,
          resolution,
          subsample,
          checkpoint: selectedCheckpoint
        })
      });
      const data = await res.json();
      if (data.job) {
        setTotalFrames(data.job.total_frames || 50);
      }
    } catch (err: any) {
      setLogs((prev) => [...prev, `Error launching job: ${err.message}`]);
      setIsReconstructing(false);
    }
  };

  const handleCancelReconstruction = async () => {
    try {
      await fetch("/api/slam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" })
      });
      setIsReconstructing(false);
      setLogs((prev) => [...prev, "Reconstruction task cancelled by operator."]);
    } catch (err) {}
  };

  const currentPose = sceneData?.poses?.find((p) => p.frame_idx === selectedFrameIdx) || sceneData?.poses?.[0];

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      width: "100vw",
      backgroundColor: "#0a0f1d",
      overflow: "hidden",
      fontFamily: "'Inter', sans-serif",
      color: "#ffffff"
    }}>
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main SLAM Workspace */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        overflow: "hidden",
        padding: "16px 20px 20px 20px",
        gap: "12px"
      }}>
        {/* Top Header Ribbon */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#111827",
          padding: "10px 18px",
          borderRadius: "var(--radius-lg)",
          border: "1px solid #1f2937",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
          flexShrink: 0
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              backgroundColor: "rgba(16, 185, 129, 0.15)",
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <Box size={20} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h1 style={{ fontSize: "15px", fontWeight: 900, color: "#ffffff", letterSpacing: "0.02em" }}>
                  MUSt3R Native 3D Studio & Multi-View SLAM
                </h1>
                <span style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  backgroundColor: "rgba(56, 189, 248, 0.15)",
                  color: "#38bdf8",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  border: "1px solid rgba(56, 189, 248, 0.3)"
                }}>
                  CVPR 2025 Native Viser Engine
                </span>
              </div>
              <p style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>
                Multi-View Stereo 3D Reconstruction · Online Camera Tracking · Real-Time Viser Viewer
              </p>
            </div>
          </div>

          {/* Top Quick Actions & Viser Launch Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={launchNativeViserStudio}
              disabled={isLaunchingViser}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                borderRadius: "6px",
                backgroundColor: "rgba(56, 189, 248, 0.12)",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                color: "#38bdf8",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              <RefreshCw size={11} className={isLaunchingViser ? "spin-slow" : ""} />
              <span>{isLaunchingViser ? "Launching..." : "Relaunch Viser Server"}</span>
            </button>

            <a
              href={viserUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                borderRadius: "6px",
                backgroundColor: "#10b981",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: 800,
                textDecoration: "none"
              }}
            >
              <ExternalLink size={11} />
              <span>Open Viser Window</span>
            </a>

            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              borderRadius: "6px",
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: 800,
              color: "#10b981"
            }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981" }} className="pulse-active" />
              <span>RTX 5050 (bf16)</span>
            </div>
          </div>
        </div>

        {/* View Mode Navigation Tabs */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#111827",
          padding: "6px 12px",
          borderRadius: "var(--radius-md)",
          border: "1px solid #1f2937"
        }}>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={() => setViewMode("viser3d")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: viewMode === "viser3d" ? "#10b981" : "#1e293b",
                color: viewMode === "viser3d" ? "#ffffff" : "#94a3b8",
                border: "none",
                fontSize: "11px",
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <Eye size={13} />
              <span>🎨 Native Viser 3D Studio (Port 8080)</span>
            </button>

            <button
              onClick={() => setViewMode("gradio")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: viewMode === "gradio" ? "#38bdf8" : "#1e293b",
                color: viewMode === "gradio" ? "#0f172a" : "#94a3b8",
                border: "none",
                fontSize: "11px",
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <Tv size={13} />
              <span>🎛️ MUSt3R Gradio Pipeline (Port 7860)</span>
            </button>

            <button
              onClick={() => setViewMode("extractor")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: viewMode === "extractor" ? "#0284c7" : "#1e293b",
                color: viewMode === "extractor" ? "#ffffff" : "#94a3b8",
                border: "none",
                fontSize: "11px",
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <Film size={13} />
              <span>🎬 Video Frame Extractor</span>
            </button>

            <button
              onClick={() => setViewMode("odometry")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: viewMode === "odometry" ? "#a855f7" : "#1e293b",
                color: viewMode === "odometry" ? "#ffffff" : "#94a3b8",
                border: "none",
                fontSize: "11px",
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <Compass size={13} />
              <span>📊 6-DoF Pose Timeline</span>
            </button>

            <button
              onClick={() => setViewMode("logs")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: viewMode === "logs" ? "#10b981" : "#1e293b",
                color: viewMode === "logs" ? "#ffffff" : "#94a3b8",
                border: "none",
                fontSize: "11px",
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <Terminal size={13} />
              <span>📜 Server Logs {isReconstructing && "⚡"}</span>
            </button>

            <button
              onClick={() => setViewMode("webgl")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: viewMode === "webgl" ? "#64748b" : "#1e293b",
                color: viewMode === "webgl" ? "#ffffff" : "#94a3b8",
                border: "none",
                fontSize: "11px",
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <Box size={13} />
              <span>WebGL Fallback</span>
            </button>
          </div>

          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700 }}>
            {viewMode === "viser3d" && "Showing Native Viser 3D Viewport"}
            {viewMode === "gradio" && "Showing MUSt3R Gradio Pipeline Studio"}
          </div>
        </div>

        {/* Central Main Stage Viewport */}
        <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", gap: "14px" }}>
          {/* VIEW 1: Native Viser 3D Studio */}
          {viewMode === "viser3d" && (
            <div style={{
              width: "100%",
              height: "100%",
              backgroundColor: "#0d131f",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
              border: "1px solid #1f2937",
              display: "flex",
              flexDirection: "column"
            }}>
              <div style={{
                padding: "8px 14px",
                backgroundColor: "#111827",
                borderBottom: "1px solid #1f2937",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 800, color: "#10b981" }}>
                    MUSt3R Official Viser 3D Studio Viewer ({viserUrl})
                  </span>
                  <span style={{ fontSize: "10px", color: "#94a3b8" }}>
                    Includes point size, frustums, confidence threshold, follow cam, and local pointmaps.
                  </span>
                </div>
                <a
                  href={viserUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: "11px", color: "#38bdf8", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", fontWeight: 700 }}
                >
                  <span>Open Full Screen Window</span>
                  <ExternalLink size={11} />
                </a>
              </div>

              <iframe
                src={viserUrl}
                style={{ flex: 1, width: "100%", border: "none", backgroundColor: "#0a0f1d" }}
                title="MUSt3R Native Viser 3D Studio"
              />
            </div>
          )}

          {/* VIEW 2: Native MUSt3R Gradio Controls */}
          {viewMode === "gradio" && (
            <div style={{
              width: "100%",
              height: "100%",
              backgroundColor: "#0d131f",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
              border: "1px solid #1f2937",
              display: "flex",
              flexDirection: "column"
            }}>
              <div style={{
                padding: "8px 14px",
                backgroundColor: "#111827",
                borderBottom: "1px solid #1f2937",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <span style={{ fontSize: "12px", fontWeight: 800, color: "#38bdf8" }}>
                  MUSt3R Official Gradio Controls & Sequence Pipeline ({gradioUrl})
                </span>
                <a
                  href={gradioUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: "11px", color: "#10b981", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", fontWeight: 700 }}
                >
                  <span>Open Gradio Tab</span>
                  <ExternalLink size={11} />
                </a>
              </div>

              <iframe
                src={gradioUrl}
                style={{ flex: 1, width: "100%", border: "none", backgroundColor: "#1e293b" }}
                title="MUSt3R Gradio Pipeline Studio"
              />
            </div>
          )}

          {/* VIEW 3: FFmpeg Video Frame Extractor */}
          {viewMode === "extractor" && (
            <div style={{
              width: "100%",
              height: "100%",
              backgroundColor: "#111827",
              borderRadius: "var(--radius-lg)",
              border: "1px solid #1f2937",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              maxWidth: "700px",
              margin: "0 auto"
            }}>
              <div style={{ fontSize: "16px", fontWeight: 900, color: "#38bdf8", display: "flex", alignItems: "center", gap: "8px" }}>
                <Film size={20} />
                <span>FFmpeg High-Speed Keyframe Extractor</span>
              </div>
              <p style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.5 }}>
                Extract dense, high-quality JPEG keyframes from any recorded video walkthrough (.mp4, .mov, .avi) for 3D SLAM point cloud synthesis.
              </p>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
                  Source Video File Path
                </label>
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder="WhatsApp Video 2026-08-20 at 23.28.57.mp4"
                  style={{
                    width: "100%",
                    backgroundColor: "#0f172a",
                    color: "#38bdf8",
                    border: "1px solid #334155",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    fontSize: "12px",
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: "none"
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 800, color: "#9ca3af", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
                  Extraction Target FPS
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                  {[
                    { fps: 2, label: "2 FPS (Fast)" },
                    { fps: 5, label: "5 FPS (Standard)" },
                    { fps: 10, label: "10 FPS (Dense)" }
                  ].map((item) => (
                    <button
                      key={item.fps}
                      onClick={() => setExtractFps(item.fps)}
                      style={{
                        padding: "10px",
                        borderRadius: "8px",
                        border: extractFps === item.fps ? "2px solid #38bdf8" : "1px solid #334155",
                        backgroundColor: extractFps === item.fps ? "rgba(56, 189, 248, 0.15)" : "#1e293b",
                        color: extractFps === item.fps ? "#38bdf8" : "#cbd5e1",
                        fontSize: "12px",
                        fontWeight: 800,
                        cursor: "pointer"
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleExtractFrames}
                disabled={isExtracting}
                style={{
                  marginTop: "10px",
                  padding: "14px",
                  backgroundColor: isExtracting ? "#334155" : "#0284c7",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 900,
                  cursor: isExtracting ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  boxShadow: "0 4px 16px rgba(2, 132, 199, 0.35)"
                }}
              >
                <Film size={16} />
                <span>{isExtracting ? "Extracting Frames via FFmpeg..." : "Extract Video Keyframes Now"}</span>
              </button>

              {extractedFrameCount !== null && (
                <div style={{
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  fontSize: "12px",
                  color: "#10b981",
                  fontWeight: 700
                }}>
                  ✅ Extracted {extractedFrameCount} frames into <code>slam/must3r/frames/</code>! Ready for 3D SLAM synthesis.
                </div>
              )}
            </div>
          )}

          {/* VIEW 4: 6-DoF Pose Inspector */}
          {viewMode === "odometry" && (
            <div style={{
              width: "100%",
              height: "100%",
              backgroundColor: "#111827",
              borderRadius: "var(--radius-lg)",
              border: "1px solid #1f2937",
              padding: "20px",
              display: "grid",
              gridTemplateColumns: "350px 1fr",
              gap: "20px",
              overflow: "hidden"
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ fontSize: "14px", fontWeight: 800, color: "#38bdf8" }}>
                  Keyframe Odometry Trajectory
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, overflowY: "auto" }}>
                  {(sceneData?.poses || []).map((p) => (
                    <div
                      key={p.frame_idx}
                      onClick={() => setSelectedFrameIdx(p.frame_idx)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        backgroundColor: selectedFrameIdx === p.frame_idx ? "rgba(16, 185, 129, 0.2)" : "#1e293b",
                        border: selectedFrameIdx === p.frame_idx ? "1px solid #10b981" : "1px solid transparent",
                        cursor: "pointer",
                        fontSize: "12px"
                      }}
                    >
                      <span style={{ fontWeight: 700, color: p.is_keyframe ? "#38bdf8" : "#cbd5e1" }}>
                        Frame #{p.frame_idx} {p.is_keyframe && "★ Keyframe"}
                      </span>
                      <span style={{ color: "#64748b", fontFamily: "'JetBrains Mono', monospace" }}>
                        ({p.position[0].toFixed(1)}, {p.position[2].toFixed(1)})m
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {currentPose ? (
                <div style={{
                  backgroundColor: "#0f172a",
                  borderRadius: "12px",
                  padding: "20px",
                  border: "1px solid #1e293b",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px"
                }}>
                  <div style={{ fontSize: "16px", fontWeight: 900, color: "#10b981" }}>
                    Selected 6-DoF Pose Inspector - Frame #{currentPose.frame_idx}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                    <div style={{ backgroundColor: "#1e293b", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 800 }}>POSITION X</div>
                      <div style={{ fontSize: "16px", fontWeight: 900, color: "#ffffff", fontFamily: "'JetBrains Mono', monospace" }}>
                        {currentPose.position[0].toFixed(3)} m
                      </div>
                    </div>
                    <div style={{ backgroundColor: "#1e293b", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 800 }}>POSITION Y</div>
                      <div style={{ fontSize: "16px", fontWeight: 900, color: "#ffffff", fontFamily: "'JetBrains Mono', monospace" }}>
                        {currentPose.position[1].toFixed(3)} m
                      </div>
                    </div>
                    <div style={{ backgroundColor: "#1e293b", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 800 }}>POSITION Z</div>
                      <div style={{ fontSize: "16px", fontWeight: 900, color: "#ffffff", fontFamily: "'JetBrains Mono', monospace" }}>
                        {currentPose.position[2].toFixed(3)} m
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                    <div style={{ backgroundColor: "#1e293b", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 800 }}>PITCH</div>
                      <div style={{ fontSize: "16px", fontWeight: 900, color: "#38bdf8", fontFamily: "'JetBrains Mono', monospace" }}>
                        {currentPose.rotation_euler[0].toFixed(2)}°
                      </div>
                    </div>
                    <div style={{ backgroundColor: "#1e293b", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 800 }}>YAW</div>
                      <div style={{ fontSize: "16px", fontWeight: 900, color: "#38bdf8", fontFamily: "'JetBrains Mono', monospace" }}>
                        {currentPose.rotation_euler[1].toFixed(2)}°
                      </div>
                    </div>
                    <div style={{ backgroundColor: "#1e293b", padding: "12px", borderRadius: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 800 }}>ROLL</div>
                      <div style={{ fontSize: "16px", fontWeight: 900, color: "#38bdf8", fontFamily: "'JetBrains Mono', monospace" }}>
                        {currentPose.rotation_euler[2].toFixed(2)}°
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* VIEW 5: Execution Logs */}
          {viewMode === "logs" && (
            <div
              ref={logContainerRef}
              style={{
                width: "100%",
                height: "100%",
                padding: "20px",
                backgroundColor: "#090d16",
                borderRadius: "var(--radius-lg)",
                border: "1px solid #1f2937",
                color: "#10b981",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "12px",
                lineHeight: 1.6,
                overflowY: "auto",
                whiteSpace: "pre-wrap"
              }}
            >
              {logs.length === 0 ? (
                <div style={{ color: "#64748b" }}>Execution log ready. No active background errors.</div>
              ) : (
                logs.map((l, i) => (
                  <div key={i} style={{ marginBottom: "4px" }}>
                    <span style={{ color: "#64748b" }}>[{i + 1}]</span> {l}
                  </div>
                ))
              )}
            </div>
          )}

          {/* VIEW 6: WebGL Fallback */}
          {viewMode === "webgl" && (
            <div style={{ width: "100%", height: "100%" }}>
              <Must3rViewer
                sceneData={sceneData}
                isLoading={isLoadingScene}
                selectedFrameIdx={selectedFrameIdx}
                onSelectFrame={(idx) => setSelectedFrameIdx(idx)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

