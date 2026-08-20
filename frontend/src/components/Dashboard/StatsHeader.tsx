"use client";

import React from "react";
import { DeviceTelemetry } from "@/lib/types";
import { Activity, Radio, Target, ShieldCheck, Wifi } from "lucide-react";

interface StatsHeaderProps {
  devices: DeviceTelemetry[];
  isSimulating: boolean;
  geofenceCount?: number;
}

export default function StatsHeader({ devices, isSimulating, geofenceCount = 0 }: StatsHeaderProps) {
  const onlineDevices = devices.filter((d) => d.online);
  const avgAccuracy = devices.length > 0 
    ? Math.round(devices.reduce((acc, d) => acc + (d.accuracy_m || 3), 0) / devices.length)
    : 3;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "12px",
      marginBottom: "16px"
    }}>
      {/* Metric 1: Active Nodes */}
      <div style={{
        backgroundColor: "#ffffff",
        border: "1px solid var(--border-light)",
        borderRadius: "var(--radius-lg)",
        padding: "14px 18px",
        boxShadow: "var(--shadow-sm)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Fleet Nodes
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--emerald-dark)", marginTop: "4px" }}>
            {devices.length} <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-muted)" }}>connected</span>
          </div>
        </div>
        <div style={{
          width: "38px",
          height: "38px",
          borderRadius: "10px",
          backgroundColor: "var(--bg-green-tint)",
          color: "var(--emerald-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          <Radio size={18} />
        </div>
      </div>

      {/* Metric 2: Live Streams */}
      <div style={{
        backgroundColor: "#ffffff",
        border: "1px solid var(--border-light)",
        borderRadius: "var(--radius-lg)",
        padding: "14px 18px",
        boxShadow: "var(--shadow-sm)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Live Feeds
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--emerald-dark)", marginTop: "4px" }}>
            {onlineDevices.length} <span style={{ fontSize: "12px", fontWeight: 500, color: "#10b981" }}>streaming</span>
          </div>
        </div>
        <div style={{
          width: "38px",
          height: "38px",
          borderRadius: "10px",
          backgroundColor: "#f0fdf4",
          color: "#059669",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          <Activity size={18} />
        </div>
      </div>

      {/* Metric 3: Active Geofences */}
      <div style={{
        backgroundColor: "#ffffff",
        border: "1px solid var(--border-light)",
        borderRadius: "var(--radius-lg)",
        padding: "14px 18px",
        boxShadow: "var(--shadow-sm)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Geofence Zones
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--emerald-dark)", marginTop: "4px" }}>
            {geofenceCount} <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-muted)" }}>active</span>
          </div>
        </div>
        <div style={{
          width: "38px",
          height: "38px",
          borderRadius: "10px",
          backgroundColor: "var(--bg-green-tint)",
          color: "var(--emerald-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          <ShieldCheck size={18} />
        </div>
      </div>

      {/* Metric 4: GPS Precision */}
      <div style={{
        backgroundColor: "#ffffff",
        border: "1px solid var(--border-light)",
        borderRadius: "var(--radius-lg)",
        padding: "14px 18px",
        boxShadow: "var(--shadow-sm)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Avg Precision
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--emerald-dark)", marginTop: "4px" }}>
            ±{avgAccuracy}m <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text-muted)" }}>radius</span>
          </div>
        </div>
        <div style={{
          width: "38px",
          height: "38px",
          borderRadius: "10px",
          backgroundColor: "var(--bg-green-tint)",
          color: "var(--emerald-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          <Target size={18} />
        </div>
      </div>
    </div>
  );
}
