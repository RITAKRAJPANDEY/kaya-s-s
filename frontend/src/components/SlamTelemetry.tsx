"use client";

import React, { useState, useEffect } from "react";
import { Activity, Compass, Crosshair, Navigation, Cpu, Wifi, Radio, Zap } from "lucide-react";

export interface SlamData {
  robotId: string;
  status: "ONLINE" | "OFFLINE" | "MAPPING" | "LOCALIZING";
  coordinates: { lat: number; lng: number };
  orientation: number; // Degrees 0-360
  speed: number; // m/s
  activeGeofence: string;
  lidarPoints: number;
  confidence: number;
}

export default function SlamTelemetry() {
  const [slamData, setSlamData] = useState<SlamData>({
    robotId: "KAYA-SLAM-01",
    status: "MAPPING",
    coordinates: { lat: 18.52043, lng: 73.85674 },
    orientation: 68,
    speed: 0.85,
    activeGeofence: "Main Perimeter - Zone A",
    lidarPoints: 48500,
    confidence: 98.4
  });

  // Subtle real-time motion pulse simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setSlamData((prev) => ({
        ...prev,
        orientation: (prev.orientation + (Math.random() * 4 - 2) + 360) % 360,
        speed: Math.max(0, +(prev.speed + (Math.random() * 0.2 - 0.1)).toFixed(2)),
        lidarPoints: prev.lidarPoints + Math.floor(Math.random() * 120 - 60),
        confidence: Math.min(99.9, Math.max(92, +(prev.confidence + (Math.random() * 0.4 - 0.2)).toFixed(1)))
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      backgroundColor: "#ffffff",
      border: "1px solid var(--border-light)",
      borderRadius: "var(--radius-lg)",
      padding: "20px",
      boxShadow: "var(--shadow-sm)",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: "350px"
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "16px",
        flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "8px",
            backgroundColor: "#eff6ff",
            color: "#2563eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <Cpu size={18} />
          </div>
          <div>
            <h2 style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
              SLAM Robot Telemetry & Odometry
            </h2>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Simultaneous Localization and LiDAR Point Cloud Mapping
            </span>
          </div>
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          backgroundColor: "#f0fdf4",
          border: "1px solid #bbf7d0",
          borderRadius: "6px",
          padding: "3px 8px",
          fontSize: "11px",
          fontWeight: 800,
          color: "#166534"
        }}>
          <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#16a34a" }} className="pulse-active" />
          <span>{slamData.status}</span>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "12px",
        marginBottom: "16px"
      }}>
        {/* Status Card */}
        <div style={{
          padding: "12px",
          backgroundColor: "#f8fafc",
          border: "1px solid var(--border-light)",
          borderRadius: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
            Robot Node ID
          </span>
          <span style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a", fontFamily: "'JetBrains Mono', monospace" }}>
            {slamData.robotId}
          </span>
        </div>

        {/* Orientation / Heading */}
        <div style={{
          padding: "12px",
          backgroundColor: "#f8fafc",
          border: "1px solid var(--border-light)",
          borderRadius: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
            LiDAR Heading
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Compass size={16} style={{ color: "#4f46e5", transform: `rotate(${slamData.orientation}deg)`, transition: "transform 0.3s ease" }} />
            <span style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a", fontFamily: "'JetBrains Mono', monospace" }}>
              {Math.round(slamData.orientation)}° True
            </span>
          </div>
        </div>

        {/* Point Cloud Density */}
        <div style={{
          padding: "12px",
          backgroundColor: "#f8fafc",
          border: "1px solid var(--border-light)",
          borderRadius: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
            Point Cloud Density
          </span>
          <span style={{ fontSize: "14px", fontWeight: 800, color: "#059669", fontFamily: "'JetBrains Mono', monospace" }}>
            {slamData.lidarPoints.toLocaleString()} pts/s
          </span>
        </div>

        {/* Confidence Score */}
        <div style={{
          padding: "12px",
          backgroundColor: "#f8fafc",
          border: "1px solid var(--border-light)",
          borderRadius: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}>
          <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
            Map Confidence
          </span>
          <span style={{ fontSize: "14px", fontWeight: 800, color: "#2563eb", fontFamily: "'JetBrains Mono', monospace" }}>
            {slamData.confidence}%
          </span>
        </div>
      </div>

      {/* Spatial Coordinates List */}
      <div style={{
        marginTop: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        paddingTop: "12px",
        borderTop: "1px solid var(--border-light)",
        fontSize: "12px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
            <Crosshair size={14} style={{ color: "#2563eb" }} /> Geographic Anchor
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#0f172a" }}>
            {slamData.coordinates.lat.toFixed(5)}°, {slamData.coordinates.lng.toFixed(5)}°
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
            <Navigation size={14} style={{ color: "#059669" }} /> Linear Velocity
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#059669" }}>
            {slamData.speed} m/s ({(slamData.speed * 3.6).toFixed(1)} km/h)
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px" }}>
            <Zap size={14} style={{ color: "#d97706" }} /> Enclosed Geofence
          </span>
          <span style={{ fontWeight: 700, color: "#0f172a" }}>
            {slamData.activeGeofence}
          </span>
        </div>
      </div>
    </div>
  );
}
