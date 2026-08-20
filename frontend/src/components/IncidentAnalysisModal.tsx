"use client";

import React, { useState, useRef, useEffect } from "react";
import { 
  AlertTriangle, 
  ShieldAlert, 
  Play, 
  Pause, 
  RotateCcw, 
  Eye, 
  EyeOff, 
  Zap, 
  X, 
  Clock, 
  Maximize2,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Layers,
  Compass
} from "lucide-react";

interface IncidentAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function IncidentAnalysisModal({ isOpen, onClose }: IncidentAnalysisModalProps) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeTab, setActiveTab] = useState<"analysis" | "geometry" | "solution">("analysis");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (isOpen && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  }, [isOpen]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      setDuration(videoRef.current.duration || 10);
    }
  };

  const restartVideo = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      backgroundColor: "rgba(15, 23, 42, 0.85)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      fontFamily: "'Inter', sans-serif"
    }}>
      <div style={{
        backgroundColor: "#ffffff",
        borderRadius: "16px",
        width: "100%",
        maxWidth: "1100px",
        maxHeight: "92vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        border: "1px solid rgba(255, 255, 255, 0.2)",
        animation: "fadeIn 0.25s ease-out"
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 24px",
          backgroundColor: "#0f172a",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #1e293b"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              backgroundColor: "#ef4444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              boxShadow: "0 0 15px rgba(239, 68, 68, 0.5)"
            }}>
              <ShieldAlert size={20} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 800, letterSpacing: "0.02em", margin: 0 }}>
                  Case Study: Student-Vehicle Blind-Spot Collision Analysis
                </h2>
                <span style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  backgroundColor: "#fee2e2",
                  color: "#dc2626",
                  padding: "2px 6px",
                  borderRadius: "4px"
                }}>
                  CRITICAL INCIDENT
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: "2px 0 0 0" }}>
                Autonomous Perception & FOV Blind-Spot Spatial Reconstruction
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              borderRadius: "8px",
              padding: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s"
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body - 2 Columns */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1.25fr 1fr",
          overflowY: "auto",
          flex: 1
        }}>
          {/* Left Column: Video Player */}
          <div style={{
            backgroundColor: "#020617",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            borderRight: "1px solid #1e293b"
          }}>
            {/* Video Container */}
            <div style={{
              position: "relative",
              borderRadius: "12px",
              overflow: "hidden",
              backgroundColor: "#000000",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.6)",
              aspectRatio: "16/9",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <video
                ref={videoRef}
                src="/incident_recording.mp4"
                onTimeUpdate={handleTimeUpdate}
                playsInline
                loop
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain"
                }}
              />

              {/* Dynamic Video Overlays */}
              <div style={{
                position: "absolute",
                top: "12px",
                left: "12px",
                backgroundColor: "rgba(15, 23, 42, 0.85)",
                backdropFilter: "blur(6px)",
                border: "1px solid rgba(239, 68, 68, 0.6)",
                padding: "4px 10px",
                borderRadius: "6px",
                color: "#fca5a5",
                fontSize: "11px",
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#ef4444" }} className="pulse-danger" />
                <span>AI INCIDENT RECONSTRUCTION</span>
              </div>

              {/* Real-time timestamp tag */}
              <div style={{
                position: "absolute",
                bottom: "12px",
                right: "12px",
                backgroundColor: "rgba(0,0,0,0.75)",
                color: "#ffffff",
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "4px"
              }}>
                T+ {currentTime.toFixed(1)}s
              </div>
            </div>

            {/* Video Controls Bar */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              backgroundColor: "#0f172a",
              padding: "10px 14px",
              borderRadius: "10px",
              border: "1px solid #1e293b"
            }}>
              <button
                onClick={togglePlay}
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "8px",
                  backgroundColor: "#059669",
                  color: "#ffffff",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>

              <button
                onClick={restartVideo}
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "8px",
                  backgroundColor: "rgba(255, 255, 255, 0.08)",
                  color: "#94a3b8",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <RotateCcw size={16} />
              </button>

              {/* Scrubber */}
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="range"
                  min={0}
                  max={duration || 10}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => {
                    const t = parseFloat(e.target.value);
                    if (videoRef.current) {
                      videoRef.current.currentTime = t;
                      setCurrentTime(t);
                    }
                  }}
                  style={{
                    width: "100%",
                    accentColor: "#ef4444",
                    cursor: "pointer"
                  }}
                />
              </div>

              <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "#94a3b8", fontWeight: 700 }}>
                {currentTime.toFixed(1)}s / {duration ? duration.toFixed(1) : "0.0"}s
              </span>
            </div>

            {/* Quick Threat Severity Tag */}
            <div style={{
              backgroundColor: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              borderRadius: "10px",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: "10px"
            }}>
              <span style={{ fontSize: "20px" }}>🚨</span>
              <div style={{ fontSize: "12px", color: "#fca5a5", lineHeight: 1.4 }}>
                <b style={{ color: "#f87171" }}>Root Cause Identified:</b> Student field of view (0° forward) completely excluded the vehicle approaching from behind/flank (158° angle offset).
              </div>
            </div>
          </div>

          {/* Right Column: AI Analysis & Spatial Breakdown */}
          <div style={{
            padding: "20px",
            backgroundColor: "#ffffff",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            overflowY: "auto"
          }}>
            {/* Tabs */}
            <div style={{
              display: "flex",
              gap: "6px",
              backgroundColor: "#f1f5f9",
              padding: "4px",
              borderRadius: "10px"
            }}>
              <button
                onClick={() => setActiveTab("analysis")}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: activeTab === "analysis" ? "#ffffff" : "transparent",
                  color: activeTab === "analysis" ? "#0f172a" : "#64748b",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: "pointer",
                  boxShadow: activeTab === "analysis" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                }}
              >
                AI Threat Breakdown
              </button>
              <button
                onClick={() => setActiveTab("geometry")}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: activeTab === "geometry" ? "#ffffff" : "transparent",
                  color: activeTab === "geometry" ? "#0f172a" : "#64748b",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: "pointer",
                  boxShadow: activeTab === "geometry" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                }}
              >
                FOV & Geometry
              </button>
              <button
                onClick={() => setActiveTab("solution")}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: activeTab === "solution" ? "#ffffff" : "transparent",
                  color: activeTab === "solution" ? "#0f172a" : "#64748b",
                  fontWeight: 700,
                  fontSize: "12px",
                  cursor: "pointer",
                  boxShadow: activeTab === "solution" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                }}
              >
                Shared Perception Fix
              </button>
            </div>

            {/* Tab 1: AI Threat Breakdown */}
            {activeTab === "analysis" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid #fee2e2",
                  backgroundColor: "#fff5f5"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#991b1b", fontWeight: 800, fontSize: "12px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#ef4444" }} />
                    PHASE 1: PEDESTRIAN ADVANCE
                  </div>
                  <p style={{ fontSize: "12px", color: "#7f1d1d", margin: "4px 0 0 0", lineHeight: 1.4 }}>
                    • Student is moving forward toward the roadway corridor.<br/>
                    • Attention is focused directly ahead (Heading: <b>0° North</b>).
                  </p>
                </div>

                <div style={{
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid #fed7aa",
                  backgroundColor: "#fffbf5"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#9a3412", fontWeight: 800, fontSize: "12px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#f97316" }} />
                    PHASE 2: VEHICLE BLIND-SPOT APPROACH
                  </div>
                  <p style={{ fontSize: "12px", color: "#7c2d12", margin: "4px 0 0 0", lineHeight: 1.4 }}>
                    • Vehicle approaches at high velocity from beyond the POV of the student.<br/>
                    • Approach Vector: <b>158° relative flank/rear</b> (Strictly outside student FOV).
                  </p>
                </div>

                <div style={{
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid #fecaca",
                  backgroundColor: "#fff5f5"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#991b1b", fontWeight: 800, fontSize: "12px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#dc2626" }} />
                    PHASE 3: ZERO LINE-OF-SIGHT & IMPACT
                  </div>
                  <p style={{ fontSize: "12px", color: "#7f1d1d", margin: "4px 0 0 0", lineHeight: 1.4 }}>
                    • Angle difference = <b>158° &gt; 35°</b> (Exceeds 70° natural human/phone FOV).<br/>
                    • The student cannot see the vehicle and is hit upon entering the road plane.
                  </p>
                </div>
              </div>
            )}

            {/* Tab 2: FOV & Geometry Calculations */}
            {activeTab === "geometry" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid var(--border-light)",
                  borderRadius: "10px",
                  padding: "14px"
                }}>
                  <span style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>
                    Spatial Angle Metrics
                  </span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "8px" }}>
                    <div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>Student Heading:</div>
                      <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a", fontFamily: "'JetBrains Mono', monospace" }}>0.0° (Ahead)</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>Vehicle Approach:</div>
                      <div style={{ fontSize: "15px", fontWeight: 800, color: "#ef4444", fontFamily: "'JetBrains Mono', monospace" }}>158.4° (Flank)</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>Human / Phone FOV:</div>
                      <div style={{ fontSize: "15px", fontWeight: 800, color: "#059669", fontFamily: "'JetBrains Mono', monospace" }}>70.0° Cone</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>Angle Delta:</div>
                      <div style={{ fontSize: "15px", fontWeight: 800, color: "#dc2626", fontFamily: "'JetBrains Mono', monospace" }}>158.4° (&gt;35°)</div>
                    </div>
                  </div>
                </div>

                <div style={{
                  backgroundColor: "#0f172a",
                  color: "#e2e8f0",
                  padding: "12px",
                  borderRadius: "8px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "11px",
                  lineHeight: 1.5
                }}>
                  <div style={{ color: "#38bdf8" }}>// Server FOV Blind-Spot Condition</div>
                  <div>angle_diff = abs(normalize_angle(158.4° - 0°)) = 158.4°</div>
                  <div>is_outside_fov = 158.4° &gt; (70° / 2) <span style={{ color: "#4ade80" }}>==&gt; TRUE</span></div>
                  <div>distance = 11.8m &lt;= 40m <span style={{ color: "#4ade80" }}>==&gt; IN RANGE</span></div>
                  <div style={{ color: "#f87171", marginTop: "4px" }}>=&gt; TARGETED BLIND-SPOT ALERT TRIGGERED</div>
                </div>
              </div>
            )}

            {/* Tab 3: Shared Perception Fix */}
            {activeTab === "solution" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{
                  backgroundColor: "#ecfdf5",
                  border: "1px solid #a7f3d0",
                  borderRadius: "10px",
                  padding: "14px"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#065f46", fontWeight: 800, fontSize: "13px" }}>
                    <CheckCircle2 size={16} style={{ color: "#059669" }} />
                    HOW SHARED PERCEPTION PREVENTS THIS:
                  </div>
                  <ol style={{ margin: "8px 0 0 0", paddingLeft: "18px", fontSize: "12px", color: "#047857", lineHeight: 1.6 }}>
                    <li><b>Peer Camera Node</b> (or Approaching Vehicle Camera) spots the incoming threat vector.</li>
                    <li>Server evaluates the student's current heading (0°) and recognizes the vehicle is <b>outside the student's vision cone</b>.</li>
                    <li>Targeted WebSocket audio alarm + vibration is pushed to the student's phone <b>4.2 seconds before collision</b>.</li>
                    <li>Student halts before stepping into the traffic lane.</li>
                  </ol>
                </div>

                <div style={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid var(--border-light)",
                  borderRadius: "8px",
                  padding: "12px",
                  fontSize: "12px",
                  color: "#334155"
                }}>
                  💡 <b>Latency Budget:</b> YOLO Detection (12ms) + Geodesy Trig (0.4ms) + WebSocket Push (8ms) = <b>Total Reaction Lead Time: ~20.4ms</b>.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 24px",
          backgroundColor: "#f8fafc",
          borderTop: "1px solid var(--border-light)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <span style={{ fontSize: "12px", color: "#64748b" }}>
            Real Incident Footage · <b>Recording 2026-08-20 214608.mp4</b>
          </span>

          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              backgroundColor: "#0f172a",
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: 700,
              border: "none",
              cursor: "pointer"
            }}
          >
            Close Analysis
          </button>
        </div>
      </div>
    </div>
  );
}
