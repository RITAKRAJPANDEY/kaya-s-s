"use client";

import React from "react";
import Sidebar from "@/components/Sidebar";
import SlamTelemetry from "@/components/SlamTelemetry";
import { Activity, Compass, Cpu, Layers, Sparkles, Navigation } from "lucide-react";

export default function SlamPage() {
  return (
    <div style={{
      display: "flex",
      height: "100vh",
      width: "100vw",
      backgroundColor: "#f8fafc",
      overflow: "hidden",
      fontFamily: "'Inter', sans-serif"
    }}>
      {/* Sidebar */}
      <Sidebar />

      {/* Main SLAM Workspace */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        overflowY: "auto",
        padding: "20px",
        gap: "20px"
      }}>
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#ffffff",
          padding: "16px 20px",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-light)",
          boxShadow: "var(--shadow-sm)"
        }}>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a" }}>
              SLAM Robot Odometry & Spatial Mapping
            </h1>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
              Real-time LiDAR point cloud synthesis, 6-DoF heading tracking, and obstacle vector mapping.
            </p>
          </div>

          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "6px",
            padding: "4px 10px",
            fontSize: "11px",
            fontWeight: 800,
            color: "#166534"
          }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#16a34a" }} className="pulse-active" />
            <span>LOCALIZATION ACTIVE</span>
          </div>
        </div>

        {/* Content Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20px",
          flex: 1
        }}>
          {/* SLAM Telemetry Component */}
          <SlamTelemetry />

          {/* 3D Point Cloud Representation */}
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border-light)",
            padding: "20px",
            boxShadow: "var(--shadow-sm)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Layers size={18} style={{ color: "var(--emerald-primary)" }} />
                <h3 style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
                  LiDAR Point Cloud Map Visualizer
                </h3>
              </div>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)" }}>
                48,500 pts/s
              </span>
            </div>

            {/* Visualizer Canvas Area */}
            <div style={{
              flex: 1,
              backgroundColor: "#090d16",
              borderRadius: "10px",
              border: "1px solid #1e293b",
              position: "relative",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              {/* Grid overlay */}
              <div style={{
                position: "absolute",
                inset: 0,
                backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)",
                backgroundSize: "24px 24px"
              }} />

              {/* Concentric scan radar circles */}
              <div style={{ position: "absolute", width: "160px", height: "160px", borderRadius: "50%", border: "1px dashed rgba(16, 185, 129, 0.3)" }} />
              <div style={{ position: "absolute", width: "260px", height: "260px", borderRadius: "50%", border: "1px solid rgba(16, 185, 129, 0.15)" }} />

              {/* Robot Center Node */}
              <div style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                backgroundColor: "#2563eb",
                border: "3px solid #ffffff",
                boxShadow: "0 0 20px rgba(37, 99, 235, 0.6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10
              }}>
                <Navigation size={14} style={{ color: "#ffffff", transform: "rotate(68deg)" }} />
              </div>

              {/* Status Pill */}
              <div style={{
                position: "absolute",
                bottom: "12px",
                left: "12px",
                backgroundColor: "rgba(0, 0, 0, 0.6)",
                backdropFilter: "blur(6px)",
                padding: "4px 10px",
                borderRadius: "6px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: 700
              }}>
                Scan Radius: 25.0m · Resolution: 0.05m
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
