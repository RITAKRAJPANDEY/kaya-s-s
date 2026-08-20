"use client";

import React from "react";
import Link from "next/link";
import { 
  ArrowRight, 
  Map, 
  Video, 
  Activity, 
  ShieldCheck, 
  Radio, 
  Smartphone, 
  Cpu, 
  CheckCircle2, 
  Zap, 
  Globe, 
  Layers 
} from "lucide-react";

export default function LandingPage() {
  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#ffffff",
      color: "#0f172a",
      fontFamily: "'Inter', sans-serif",
      display: "flex",
      flexDirection: "column"
    }}>
      {/* Top Navigation */}
      <header style={{
        height: "70px",
        borderBottom: "1px solid var(--border-light)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 32px",
        backgroundColor: "rgba(255, 255, 255, 0.9)",
        backdropFilter: "blur(12px)",
        position: "sticky",
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "34px",
            height: "34px",
            borderRadius: "10px",
            background: "linear-gradient(135deg, #059669 0%, #0d9488 100%)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(5, 150, 105, 0.3)"
          }}>
            <Layers size={20} />
          </div>
          <span style={{ fontSize: "18px", fontWeight: 900, letterSpacing: "0.05em", color: "#0f172a" }}>
            KAYA<span style={{ color: "var(--emerald-primary)" }}>·AI</span>
          </span>
        </div>

        <nav style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <Link href="/geofence" style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none" }}>
            Command Center
          </Link>
          <Link href="/vision" style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none" }}>
            Live Vision
          </Link>
          <Link href="/slam" style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none" }}>
            SLAM Tracking
          </Link>
          <Link href="/reports" style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)", textDecoration: "none" }}>
            Safety Reports
          </Link>
          <Link 
            href="/geofence" 
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#0f172a",
              color: "#ffffff",
              padding: "8px 18px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 2px 8px rgba(15, 23, 42, 0.2)",
              transition: "all 0.15s ease"
            }}
          >
            <span>Launch Platform</span>
            <ArrowRight size={14} />
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <main style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
        textAlign: "center",
        background: "radial-gradient(ellipse at top, #f0fdf4 0%, #ffffff 70%)"
      }}>
        {/* Hackathon Badge */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: "#ecfdf5",
          border: "1px solid #a7f3d0",
          color: "#065f46",
          padding: "6px 14px",
          borderRadius: "9999px",
          fontSize: "12px",
          fontWeight: 800,
          marginBottom: "24px",
          boxShadow: "0 2px 8px rgba(5, 150, 105, 0.12)"
        }}>
          <Zap size={14} style={{ color: "#059669" }} />
          <span>REAL-TIME PHYSICAL AI · KINEMATIC KALMAN FILTER · DPDP COMPLIANT</span>
        </div>

        {/* Hero Title */}
        <h1 style={{
          fontSize: "56px",
          fontWeight: 900,
          letterSpacing: "-0.03em",
          lineHeight: 1.1,
          color: "#0f172a",
          maxWidth: "840px",
          marginBottom: "20px"
        }}>
          Real-Time Physical AI & <br />
          <span style={{
            background: "linear-gradient(135deg, #059669 0%, #0284c7 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>
            Automated Safety Compliance
          </span>
        </h1>

        {/* Hero Subtitle */}
        <p style={{
          fontSize: "18px",
          color: "#64748b",
          maxWidth: "680px",
          lineHeight: 1.6,
          marginBottom: "36px",
          fontWeight: 500
        }}>
          Next-generation telemetry command center combining multi-waypoint polygon geofencing, sub-second hardware sensor fusion, SLAM odometry, and privacy-first computer vision.
        </p>

        {/* Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", justifyContent: "center" }}>
          <Link 
            href="/geofence" 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: "#0f172a",
              color: "#ffffff",
              padding: "14px 28px",
              borderRadius: "10px",
              fontSize: "15px",
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 10px 25px rgba(15, 23, 42, 0.2)",
              transition: "transform 0.15s ease"
            }}
          >
            <span>Launch Command Center</span>
            <ArrowRight size={18} />
          </Link>

          <Link 
            href="/vision" 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: "#ffffff",
              color: "#0f172a",
              border: "1.5px solid var(--border-light)",
              padding: "14px 24px",
              borderRadius: "10px",
              fontSize: "15px",
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "0 2px 10px rgba(0, 0, 0, 0.05)"
            }}
          >
            <Video size={18} style={{ color: "#059669" }} />
            <span>Live Vision Feed</span>
          </Link>

          <Link 
            href="/phone" 
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: "#f0fdf4",
              color: "#065f46",
              border: "1.5px solid #bbf7d0",
              padding: "14px 24px",
              borderRadius: "10px",
              fontSize: "15px",
              fontWeight: 700,
              textDecoration: "none"
            }}
          >
            <Smartphone size={18} style={{ color: "#059669" }} />
            <span>Connect Smartphone</span>
          </Link>
        </div>

        {/* Feature Cards Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "20px",
          width: "100%",
          maxWidth: "1100px",
          marginTop: "70px",
          textAlign: "left"
        }}>
          {/* Feature 1 */}
          <div style={{
            padding: "24px",
            backgroundColor: "#ffffff",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 4px 15px rgba(0, 0, 0, 0.03)"
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "#f0fdf4",
              color: "#059669",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px"
            }}>
              <Map size={20} />
            </div>
            <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", marginBottom: "8px" }}>
              Waypoint Polygon Geofencing
            </h3>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>
              Ray-Casting spatial algorithm with interactive map drawing, surface area estimation, and real-time perimeter breach alerts.
            </p>
          </div>

          {/* Feature 2 */}
          <div style={{
            padding: "24px",
            backgroundColor: "#ffffff",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 4px 15px rgba(0, 0, 0, 0.03)"
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "#eff6ff",
              color: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px"
            }}>
              <Radio size={20} />
            </div>
            <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", marginBottom: "8px" }}>
              2D Kinematic Kalman Filter
            </h3>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>
              Optimal state estimation removing GPS noise and computing real-time ground velocity vectors with high precision.
            </p>
          </div>

          {/* Feature 3 */}
          <div style={{
            padding: "24px",
            backgroundColor: "#ffffff",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 4px 15px rgba(0, 0, 0, 0.03)"
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "#fdf4ff",
              color: "#a855f7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px"
            }}>
              <Video size={20} />
            </div>
            <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", marginBottom: "8px" }}>
              Vision & Threat Detection
            </h3>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>
              Automated PPE compliance, proximity hazards, and DPDP privacy face blurring over multi-camera sensor feeds.
            </p>
          </div>

          {/* Feature 4 */}
          <div style={{
            padding: "24px",
            backgroundColor: "#ffffff",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 4px 15px rgba(0, 0, 0, 0.03)"
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "#fff7ed",
              color: "#ea580c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px"
            }}>
              <Activity size={20} />
            </div>
            <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", marginBottom: "8px" }}>
              SLAM Robot Odometry
            </h3>
            <p style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>
              Live LiDAR point cloud metrics, true heading compass, and localized robotic trajectory visualization.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        padding: "24px 32px",
        borderTop: "1px solid var(--border-light)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: "13px",
        color: "var(--text-muted)",
        backgroundColor: "#ffffff"
      }}>
        <span>© 2026 KAYA-AI Platform · Next-Gen Physical AI & Spatial Command</span>
        <div style={{ display: "flex", gap: "16px" }}>
          <Link href="/geofence" style={{ color: "var(--text-secondary)", textDecoration: "none", fontWeight: 600 }}>Command Center</Link>
          <Link href="/phone" style={{ color: "var(--text-secondary)", textDecoration: "none", fontWeight: 600 }}>Broadcaster</Link>
        </div>
      </footer>
    </div>
  );
}
