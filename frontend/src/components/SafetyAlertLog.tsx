"use client";

import React, { useState } from "react";
import { AlertTriangle, ShieldAlert, Crosshair, Eye, ShieldCheck, Filter, Download, Activity } from "lucide-react";

export interface SafetyEvent {
  id: string;
  timestamp: string;
  type: "THREAT_DETECTED" | "BLIND_SPOT_HAZARD" | "ZONE_BREACH" | "PROXIMITY_HAZARD";
  severity: "low" | "medium" | "critical";
  description: string;
  location?: string;
  sourceAgent?: string;
}

const INITIAL_EVENTS: SafetyEvent[] = [
  {
    id: "evt-001",
    timestamp: new Date(Date.now() - 1000 * 15).toISOString(), 
    type: "BLIND_SPOT_HAZARD",
    severity: "critical",
    description: "Forklift vehicle approaching behind Worker (Phone-104) at 8.2m, spotted by Camera Node 1.",
    location: "Loading Dock 2",
    sourceAgent: "Camera Node 1"
  },
  {
    id: "evt-002",
    timestamp: new Date(Date.now() - 1000 * 120).toISOString(),
    type: "THREAT_DETECTED",
    severity: "critical",
    description: "YOLO detection model identified high-risk heavy equipment in active pedestrian walkway.",
    location: "Main Bay Access Corridor",
    sourceAgent: "Phone-202"
  },
  {
    id: "evt-003",
    timestamp: new Date(Date.now() - 1000 * 340).toISOString(),
    type: "PROXIMITY_HAZARD",
    severity: "medium",
    description: "Vehicle within 1.4m of perimeter boundary in active loading bay.",
    location: "Sector 3 - Outer Perimeter",
    sourceAgent: "Station Base"
  },
  {
    id: "evt-004",
    timestamp: new Date(Date.now() - 1000 * 620).toISOString(),
    type: "ZONE_BREACH",
    severity: "low",
    description: "Target node crossed waypoint perimeter into restricted high-voltage generator bay.",
    location: "Restricted Generator Bay",
    sourceAgent: "Phone-104"
  }
];

export default function SafetyAlertLog() {
  const [events, setEvents] = useState<SafetyEvent[]>(INITIAL_EVENTS);
  const [filterSeverity, setFilterSeverity] = useState<string>("all");

  const filteredEvents = events.filter((e) => {
    if (filterSeverity === "all") return true;
    return e.severity === filterSeverity;
  });

  const getSeverityStyles = (severity: string, type: string) => {
    switch (severity) {
      case "critical":
        return {
          border: "1px solid #fecaca",
          bg: "#fff5f5",
          badgeBg: "#fee2e2",
          badgeText: "#991b1b",
          icon: <ShieldAlert size={14} className="pulse-danger" />,
          titleColor: "#991b1b",
          subText: "#7f1d1d"
        };
      case "medium":
        return {
          border: "1px solid #fed7aa",
          bg: "#fffbf5",
          badgeBg: "#ffedd5",
          badgeText: "#9a3412",
          icon: <AlertTriangle size={14} />,
          titleColor: "#9a3412",
          subText: "#7c2d12"
        };
      default:
        return {
          border: "1px solid var(--border-light)",
          bg: "#ffffff",
          badgeBg: "var(--bg-card-muted)",
          badgeText: "var(--text-secondary)",
          icon: <Activity size={14} />,
          titleColor: "var(--text-main)",
          subText: "var(--text-secondary)"
        };
    }
  };

  const handleExportCSV = () => {
    const headers = "Event ID,Timestamp,Type,Severity,Location,Source Agent,Description\n";
    const rows = events.map(e => 
      `"${e.id}","${e.timestamp}","${e.type}","${e.severity}","${e.location || ''}","${e.sourceAgent || ''}","${e.description.replace(/"/g, '""')}"`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `threat_analysis_log_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{
      backgroundColor: "#ffffff",
      borderRadius: "var(--radius-lg)",
      border: "1px solid var(--border-light)",
      boxShadow: "var(--shadow-md)",
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      gap: "16px"
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ShieldAlert size={18} style={{ color: "var(--emerald-primary)" }} />
          <h2 style={{ fontSize: "14px", fontWeight: 800, color: "var(--emerald-dark)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
            Threat Intelligence & Hazard Log
          </h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Severity Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", backgroundColor: "var(--bg-card-muted)", padding: "2px", borderRadius: "6px", border: "1px solid var(--border-light)" }}>
            <button
              onClick={() => setFilterSeverity("all")}
              style={{
                border: "none",
                background: filterSeverity === "all" ? "#ffffff" : "transparent",
                color: filterSeverity === "all" ? "var(--emerald-dark)" : "var(--text-muted)",
                fontWeight: 700,
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                cursor: "pointer",
                boxShadow: filterSeverity === "all" ? "0 1px 3px rgba(0,0,0,0.08)" : "none"
              }}
            >
              All ({events.length})
            </button>
            <button
              onClick={() => setFilterSeverity("critical")}
              style={{
                border: "none",
                background: filterSeverity === "critical" ? "#fee2e2" : "transparent",
                color: filterSeverity === "critical" ? "#991b1b" : "var(--text-muted)",
                fontWeight: 700,
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                cursor: "pointer"
              }}
            >
              Critical
            </button>
          </div>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              border: "1px solid var(--border-light)",
              backgroundColor: "#ffffff",
              padding: "4px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--text-secondary)",
              cursor: "pointer"
            }}
          >
            <Download size={12} />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Events Stream */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "400px", overflowY: "auto" }}>
        {filteredEvents.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
            No threat incidents match current filter.
          </div>
        ) : filteredEvents.map((event) => {
          const styles = getSeverityStyles(event.severity, event.type);
          return (
            <div
              key={event.id}
              style={{
                padding: "14px",
                borderRadius: "10px",
                border: styles.border,
                backgroundColor: styles.bg,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                transition: "all 0.15s ease"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "11px",
                  fontWeight: 800,
                  color: styles.badgeText,
                  backgroundColor: styles.badgeBg,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  letterSpacing: "0.02em"
                }}>
                  {styles.icon}
                  <span>{event.type.replace(/_/g, " ")}</span>
                </div>
                <div style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--text-muted)", fontWeight: 600 }}>
                  {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </div>
              </div>
              
              <div style={{ fontSize: "12px", color: styles.subText, lineHeight: 1.4, fontWeight: 500 }}>
                {event.description}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
                {event.location && (
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 600 }}>
                    📍 {event.location}
                  </span>
                )}
                {event.sourceAgent && (
                  <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                    Source: {event.sourceAgent}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
