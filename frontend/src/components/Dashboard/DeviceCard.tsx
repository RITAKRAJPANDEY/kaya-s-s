"use client";

import React from "react";
import { DeviceTelemetry, GeofenceZone } from "@/lib/types";
import { calculateDistanceMeters } from "@/lib/geo";
import { 
  Smartphone, 
  Cpu, 
  Car, 
  Send, 
  MapPin, 
  Gauge, 
  Battery, 
  Target, 
  Copy, 
  Check, 
  Footprints, 
  Download,
  ShieldCheck,
  Mountain,
  Compass,
  Laptop,
  Trash2
} from "lucide-react";

interface DeviceCardProps {
  device: DeviceTelemetry;
  isSelected: boolean;
  onSelect: (device: DeviceTelemetry) => void;
  onFocus: (device: DeviceTelemetry) => void;
  showTrail: boolean;
  onToggleTrail: (deviceId: string) => void;
  geofences?: GeofenceZone[];
  onRemove?: (deviceId: string) => void;
}

export default function DeviceCard({
  device,
  isSelected,
  onSelect,
  onFocus,
  showTrail,
  onToggleTrail,
  geofences = [],
  onRemove
}: DeviceCardProps) {
  const [copied, setCopied] = React.useState(false);

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case "station":
        return <Laptop size={18} />;
      case "raspberry-pi":
        return <Cpu size={18} />;
      case "vehicle":
        return <Car size={18} />;
      case "drone":
        return <Send size={18} />;
      case "phone":
      default:
        return <Smartphone size={18} />;
    }
  };

  const copyCoordinates = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`${device.lat.toFixed(6)}, ${device.lon.toFixed(6)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportGpx = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!device.history || device.history.length === 0) {
      alert("No tracking history points recorded yet for this device.");
      return;
    }
    const pointsXml = device.history.map(p => 
      `      <trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.timestamp * 1000).toISOString()}</time></trkpt>`
    ).join("\n");

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Kaya GPS Tracker">
  <trk>
    <name>${device.name || device.device_id}</name>
    <trkseg>
${pointsXml}
    </trkseg>
  </trk>
</gpx>`;
    
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${device.device_id}-track.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const speedKmh = device.speed_mps != null ? (device.speed_mps * 3.6).toFixed(1) : "0.0";

  // Calculate Geofence status
  const activeGeofences = geofences.filter(g => g.enabled);
  const insideZones = activeGeofences.filter(g => {
    const dist = calculateDistanceMeters(device.lat, device.lon, g.center[0], g.center[1]);
    return dist <= g.radiusMeters;
  });

  return (
    <div
      onClick={() => onSelect(device)}
      style={{
        backgroundColor: isSelected ? "var(--bg-green-tint)" : "#ffffff",
        border: isSelected ? "1.5px solid var(--emerald-primary)" : "1px solid var(--border-light)",
        borderRadius: "var(--radius-lg)",
        padding: "16px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        boxShadow: isSelected ? "0 4px 16px rgba(5, 150, 105, 0.12)" : "var(--shadow-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        position: "relative"
      }}
    >
      {/* Header Row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            backgroundColor: device.online ? "var(--bg-green-pill)" : "#f1f5f9",
            color: device.online ? "var(--emerald-primary)" : "#64748b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}>
            {getDeviceIcon(device.type)}
          </div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>{device.name || device.device_id}</span>
              {device.online && (
                <span 
                  style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#10b981" }} 
                  className="pulse-active" 
                />
              )}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "capitalize" }}>
              {device.type.replace("-", " ")}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {device.battery != null && (
            <span style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 600,
              color: device.battery > 20 ? "var(--emerald-primary)" : "#ef4444",
              backgroundColor: "#f8fafc",
              border: "1px solid var(--border-light)",
              padding: "3px 7px",
              borderRadius: "6px"
            }}>
              <Battery size={12} />
              {Math.round(device.battery)}%
            </span>
          )}
          <span style={{
            fontSize: "11px",
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: "var(--radius-full)",
            backgroundColor: device.online ? "var(--bg-green-pill)" : "#f1f5f9",
            color: device.online ? "var(--emerald-dark)" : "#64748b"
          }}>
            {device.online ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* Geofence Status Badge (if zones configured) */}
      {activeGeofences.length > 0 && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "5px 10px",
          borderRadius: "6px",
          fontSize: "11px",
          fontWeight: 700,
          backgroundColor: insideZones.length > 0 ? "var(--bg-green-tint)" : "#fef2f2",
          border: insideZones.length > 0 ? "1px solid var(--border-green)" : "1px solid #fecaca",
          color: insideZones.length > 0 ? "var(--emerald-dark)" : "#dc2626"
        }}>
          <ShieldCheck size={13} />
          {insideZones.length > 0 ? (
            <span>Inside {insideZones.map(z => z.name).join(", ")}</span>
          ) : (
            <span>Outside Active Geofence</span>
          )}
        </div>
      )}

      {/* Lat/Lon coordinates chip */}
      <div 
        onClick={copyCoordinates}
        title="Click to copy coordinates"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#f8faf9",
          border: "1px solid var(--border-light)",
          borderRadius: "8px",
          padding: "6px 10px",
          fontSize: "12px",
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-secondary)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <MapPin size={13} style={{ color: "var(--emerald-primary)" }} />
          <span>{device.lat.toFixed(5)}, {device.lon.toFixed(5)}</span>
        </div>
        <button 
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
        >
          {copied ? <Check size={14} style={{ color: "#10b981" }} /> : <Copy size={13} />}
        </button>
      </div>

      {/* Telemetry Metrics Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: device.heading != null ? "repeat(4, 1fr)" : "repeat(3, 1fr)",
        gap: "6px",
        backgroundColor: "#ffffff",
        borderRadius: "8px"
      }}>
        {/* Speed */}
        <div style={{
          backgroundColor: "#fcfdfc",
          border: "1px solid var(--border-light)",
          borderRadius: "8px",
          padding: "8px",
          textAlign: "center"
        }}>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "3px" }}>
            <Gauge size={11} /> SPEED
          </div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--emerald-dark)", marginTop: "2px" }}>
            {speedKmh} <span style={{ fontSize: "10px", fontWeight: 500, color: "var(--text-muted)" }}>km/h</span>
          </div>
        </div>

        {/* Heading (if available) */}
        {device.heading != null && (
          <div style={{
            backgroundColor: "#fcfdfc",
            border: "1px solid var(--border-light)",
            borderRadius: "8px",
            padding: "8px",
            textAlign: "center"
          }}>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "3px" }}>
              <Compass size={11} /> HDG
            </div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--emerald-dark)", marginTop: "2px" }}>
              {device.heading}°
            </div>
          </div>
        )}

        {/* Altitude */}
        <div style={{
          backgroundColor: "#fcfdfc",
          border: "1px solid var(--border-light)",
          borderRadius: "8px",
          padding: "8px",
          textAlign: "center"
        }}>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "3px" }}>
            <Mountain size={11} /> ALT
          </div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--emerald-dark)", marginTop: "2px" }}>
            {device.altitude_m ? `${Math.round(device.altitude_m)}m` : "--"}
          </div>
        </div>

        {/* GPS Accuracy */}
        <div style={{
          backgroundColor: "#fcfdfc",
          border: "1px solid var(--border-light)",
          borderRadius: "8px",
          padding: "8px",
          textAlign: "center"
        }}>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: "3px" }}>
            <Target size={11} /> ACC
          </div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--emerald-dark)", marginTop: "2px" }}>
            {device.accuracy_m ? `±${Math.round(device.accuracy_m)}m` : "±3m"}
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleTrail(device.device_id);
            }}
            title="Toggle trail polyline"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 600,
              padding: "5px 9px",
              borderRadius: "6px",
              border: showTrail ? "1px solid var(--border-green)" : "1px solid var(--border-light)",
              backgroundColor: showTrail ? "var(--bg-green-tint)" : "#ffffff",
              color: showTrail ? "var(--emerald-primary)" : "var(--text-secondary)",
              cursor: "pointer"
            }}
          >
            <Footprints size={13} />
            <span>Trail</span>
          </button>

          <button
            onClick={exportGpx}
            title="Export as GPX file"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 600,
              padding: "5px 9px",
              borderRadius: "6px",
              border: "1px solid var(--border-light)",
              backgroundColor: "#ffffff",
              color: "var(--text-secondary)",
              cursor: "pointer"
            }}
          >
            <Download size={13} />
            <span>GPX</span>
          </button>

          {onRemove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(device.device_id);
              }}
              title="Remove / Disconnect Device"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
                fontWeight: 600,
                padding: "5px 8px",
                borderRadius: "6px",
                border: "1px solid #fee2e2",
                backgroundColor: "#fff5f5",
                color: "#ef4444",
                cursor: "pointer"
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocus(device);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "12px",
            fontWeight: 700,
            padding: "5px 12px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "var(--emerald-primary)",
            color: "#ffffff",
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(5, 150, 105, 0.25)"
          }}
        >
          <Target size={13} />
          <span>Locate</span>
        </button>
      </div>
    </div>
  );
}
